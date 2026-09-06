import type {
    ActiveListView,
    ColumnGroupNode,
    ConditionalAppearance,
    ConditionalCellDecoration,
    ConditionalFormattingRule,
    DataRow,
    ICell,
    IColumnData,
    IColumnGroupData,
    IData,
    IDataColumn,
    ITableState,
    ITreeRow,
    ListFieldDataType,
    SelectionCondition,
    SelectionNode,
    SortRule,
    TableCol,
} from './types';
import { getActiveGroupFields, isColumnGroup, isSelectionGroup } from './types';

export function formatCellValue(value: unknown): unknown {
    if (value == null) {
        return '';
    }
    if (typeof value === 'boolean') {
        return value ? 'Да' : 'Нет';
    }
    return value;
}

export function resolveCellValue(row: DataRow, field: string, refs: IData['refs']): unknown {
    const raw = formatCellValue(row[field]);
    if (typeof raw === 'string' && refs[field]?.[raw] != null) {
        return refs[field][raw];
    }
    return raw;
}

function applyAppearance(column: IDataColumn, node: ColumnGroupNode): IDataColumn {
    return {
        ...column,
        cellWidth: node.width ?? column.cellWidth,
        cellFlexGrow: node.flexGrow ?? column.cellFlexGrow,
        cellHeight: node.height ?? column.cellHeight,
        cellExpandVertical: node.expandVertical ?? column.cellExpandVertical,
    };
}

function toColumnData(column: IDataColumn): IColumnData {
    return {
        name: column.field,
        label: column.description || column.name,
        cellWidth: column.cellWidth,
        cellFlexGrow: column.cellFlexGrow,
        cellHeight: column.cellHeight,
        cellExpandVertical: column.cellExpandVertical,
    };
}

function collectVisibleColumns(node: ColumnGroupNode, byField: Map<string, IDataColumn>): IDataColumn[] {
    if (node.enabled === false) {
        return [];
    }
    if (node.kind === 'column') {
        if (!node.fieldId) {
            return [];
        }
        const column = byField.get(node.fieldId);
        return column ? [applyAppearance(column, node)] : [];
    }
    const children = node.children ?? [];
    const leaves = children.flatMap((child) => collectVisibleColumns(child, byField));
    if (node.kind === 'group') {
        return leaves.map((column) => applyAppearance(column, node));
    }
    return leaves;
}

function applyNodeAppearanceToCol(col: TableCol, node: ColumnGroupNode): TableCol {
    if (!isColumnGroup(col)) {
        return {
            ...col,
            cellWidth: node.width ?? col.cellWidth,
            cellFlexGrow: node.flexGrow ?? col.cellFlexGrow,
            cellHeight: node.height ?? col.cellHeight,
            cellExpandVertical: node.expandVertical ?? col.cellExpandVertical,
        };
    }
    const next = col.map((child) => applyNodeAppearanceToCol(child as TableCol, node)) as IColumnGroupData;
    next.title = col.title;
    next.orientation = col.orientation;
    return next;
}

function buildGroupCol(node: ColumnGroupNode, byField: Map<string, IDataColumn>): TableCol | null {
    if (node.enabled === false) {
        return null;
    }
    if (node.kind === 'column') {
        if (!node.fieldId) {
            return null;
        }
        const column = byField.get(node.fieldId);
        return column ? toColumnData(applyAppearance(column, node)) : null;
    }

    const parts: TableCol[] = [];
    for (const child of node.children ?? []) {
        const next = buildGroupCol(child, byField);
        if (next) {
            parts.push(applyNodeAppearanceToCol(next, node));
        }
    }
    if (parts.length === 0) {
        return null;
    }
    if (node.kind === 'root') {
        return null;
    }

    const group = parts as IColumnGroupData;
    group.title = node.title ?? '';
    group.orientation = node.orientation ?? 'horizontal';
    return group;
}

export function applyColumnGroupingToCols(cols: IDataColumn[], root: ColumnGroupNode): TableCol[] {
    const visibleMeta = cols.filter((column) => column.show !== false);
    const byField = new Map(visibleMeta.map((column) => [column.field, column]));
    const result: TableCol[] = [];

    for (const child of root.children ?? []) {
        if (child.kind === 'group') {
            const group = buildGroupCol(child, byField);
            if (group) {
                result.push(group);
            }
            continue;
        }
        const leaves = collectVisibleColumns(child, byField);
        for (const leaf of leaves) {
            result.push(toColumnData(leaf));
        }
    }

    return result;
}

function makeCell(row: DataRow, field: string, type: string, rowIndex: number, refs: IData['refs']): ICell {
    const viewed = resolveCellValue(row, field, refs);
    return {
        columnName: field,
        value: { originalData: viewed, viewedData: viewed },
        type,
        rowIndex,
        columnIndex: 0,
        editable: null,
        hierarchy: null,
    };
}

function cellsForCol(row: DataRow, col: TableCol, rowIndex: number, refs: IData['refs'], types: Map<string, string>): ICell | ICell[] {
    if (!isColumnGroup(col)) {
        return makeCell(row, col.name, types.get(col.name) ?? 'string', rowIndex, refs);
    }
    return col.map((child) => cellsForCol(row, child as TableCol, rowIndex, refs, types)) as ICell[];
}

type RowCells = (ICell | ICell[])[] & { sourceId?: string };

export function transformStateForRender(data: IData, cols: TableCol[]): ITableState {
    const types = new Map(data.cols.map((column) => [column.field, column.type]));
    const rows = data.rows.map((row, rowIndex) => {
        const line = cols.map((col) => cellsForCol(row, col, rowIndex, data.refs, types)) as RowCells;
        line.sourceId = String(row.id ?? row.code ?? rowIndex);
        return line;
    });
    return {
        rowCount: rows.length,
        columnsCount: cols.length,
        data: rows,
        cols,
    };
}

export function applySortToRows(
    rows: DataRow[],
    rules: SortRule[],
    fieldTypes: Record<string, ListFieldDataType>,
    originalOrder?: Record<number, string>
): DataRow[] {
    const enabled = rules.filter((rule) => rule.enabled);
    if (enabled.length === 0) {
        return originalOrder ? restoreOriginalOrder(rows, originalOrder) : rows;
    }
    return [...rows].sort((left, right) => {
        for (const rule of enabled) {
            const type = fieldTypes[rule.field] ?? 'string';
            const compared = defaultComparatorForAllTypes(left[rule.field], right[rule.field], type);
            if (compared !== 0) {
                return rule.direction === 'DESC' ? -compared : compared;
            }
        }
        return 0;
    });
}

export function cycleSortRules(rules: SortRule[], field: string): SortRule[] {
    const index = rules.findIndex((rule) => rule.field === field);
    if (index < 0) {
        return [...rules, { field, direction: 'ASC', enabled: true }];
    }
    const current = rules[index];
    if (!current.enabled) {
        return rules.map((rule, itemIndex) => (itemIndex === index ? { ...rule, enabled: true, direction: 'ASC' } : rule));
    }
    if (current.direction === 'ASC') {
        return rules.map((rule, itemIndex) => (itemIndex === index ? { ...rule, direction: 'DESC' } : rule));
    }
    return rules.filter((_, itemIndex) => itemIndex !== index);
}

function restoreOriginalOrder(rows: DataRow[], originalOrder: Record<number, string>): DataRow[] {
    const byId = new Map(rows.map((row) => [String(row.id), row]));
    const restored: DataRow[] = [];
    const indexes = Object.keys(originalOrder)
        .map(Number)
        .sort((a, b) => a - b);
    for (const index of indexes) {
        const row = byId.get(String(originalOrder[index]));
        if (row) {
            restored.push(row);
        }
    }
    return restored;
}

function defaultComparatorForAllTypes(a: unknown, b: unknown, type: ListFieldDataType): number {
    if (a == null && b == null) {
        return 0;
    }
    if (a == null) {
        return 1;
    }
    if (b == null) {
        return -1;
    }
    if (type === 'number') {
        return Number(a) - Number(b);
    }
    if (type === 'date') {
        return Date.parse(String(a)) - Date.parse(String(b));
    }
    if (type === 'boolean') {
        return Number(Boolean(a)) - Number(Boolean(b));
    }
    return String(a).localeCompare(String(b), 'ru', { numeric: true, sensitivity: 'base' });
}

function cellValueForCompare(value: unknown): unknown {
    if (value && typeof value === 'object' && 'originalData' in (value as object)) {
        const packed = value as { originalData: unknown; viewedData: unknown };
        return packed.originalData ?? packed.viewedData;
    }
    return value;
}

function coercePair(left: unknown, right: unknown): { left: unknown; right: unknown; mode: 'number' | 'date' | 'string' } {
    const leftNum = Number(left);
    const rightNum = Number(right);
    if (left !== '' && right !== '' && Number.isFinite(leftNum) && Number.isFinite(rightNum)) {
        return { left: leftNum, right: rightNum, mode: 'number' };
    }
    const leftDate = Date.parse(String(left));
    const rightDate = Date.parse(String(right));
    if (!Number.isNaN(leftDate) && !Number.isNaN(rightDate)) {
        return { left: leftDate, right: rightDate, mode: 'date' };
    }
    return { left: String(left ?? ''), right: String(right ?? ''), mode: 'string' };
}

function compareValues(left: unknown, right: unknown): number {
    const pair = coercePair(left, right);
    if (pair.mode === 'string') {
        return String(pair.left).localeCompare(String(pair.right), 'ru', { numeric: true, sensitivity: 'base' });
    }
    return Number(pair.left) - Number(pair.right);
}

function isEmptyValue(value: unknown): boolean {
    return value == null || value === '';
}

export function evaluateCondition(condition: SelectionCondition, rowData: Record<string, unknown>): boolean {
    if (!condition.enabled) {
        return true;
    }
    const raw = cellValueForCompare(rowData[condition.field]);
    if (condition.comparison === 'filled') {
        return !isEmptyValue(raw);
    }
    if (condition.comparison === 'empty') {
        return isEmptyValue(raw);
    }
    if (condition.comparison === 'between' || condition.useRange) {
        const range = Array.isArray(condition.value) ? condition.value : [condition.value, condition.value];
        return compareValues(raw, range[0]) >= 0 && compareValues(raw, range[1]) <= 0;
    }
    if (isEmptyValue(condition.value)) {
        return true;
    }
    const expected = Array.isArray(condition.value) ? condition.value[0] : condition.value;
    switch (condition.comparison) {
        case 'eq':
            return compareValues(raw, expected) === 0;
        case 'ne':
            return compareValues(raw, expected) !== 0;
        case 'gt':
            return compareValues(raw, expected) > 0;
        case 'gte':
            return compareValues(raw, expected) >= 0;
        case 'lt':
            return compareValues(raw, expected) < 0;
        case 'lte':
            return compareValues(raw, expected) <= 0;
        case 'contains':
            return String(raw ?? '').toLowerCase().includes(String(expected).toLowerCase());
        case 'notContains':
            return !String(raw ?? '').toLowerCase().includes(String(expected).toLowerCase());
        default:
            return true;
    }
}

export function evaluateSelectionNodes(nodes: SelectionNode[], rowData: Record<string, unknown>): boolean {
    const active = nodes.filter((node) => node.enabled !== false);
    if (active.length === 0) {
        return true;
    }
    return active.every((node) => evaluateNode(node, rowData));
}

function evaluateNode(node: SelectionNode, rowData: Record<string, unknown>): boolean {
    if (!node.enabled) {
        return true;
    }
    if (!isSelectionGroup(node)) {
        return evaluateCondition(node, rowData);
    }
    const children = node.children ?? [];
    if (children.length === 0) {
        return true;
    }
    const results = children.map((child) => evaluateNode(child, rowData));
    if (node.logic === 'or') {
        return results.some(Boolean);
    }
    if (node.logic === 'not') {
        return !results.every(Boolean);
    }
    return results.every(Boolean);
}

export function flattenCells(node: ICell | ICell[]): ICell[] {
    if (Array.isArray(node)) {
        return node.flatMap((child) => flattenCells(child as ICell | ICell[]));
    }
    return [node];
}

export function rowDataFromCells(cells: ICell | ICell[]): Record<string, unknown> {
    const rowData: Record<string, unknown> = {};
    for (const cell of flattenCells(cells)) {
        rowData[cell.columnName] = cell.value.viewedData ?? cell.value.originalData;
    }
    return rowData;
}

export function applySelectionToFlatRows(rows: (ICell | ICell[])[][], nodes: SelectionNode[]): (ICell | ICell[])[][] {
    if (nodes.length === 0) {
        return rows;
    }
    return rows.filter((row) => evaluateSelectionNodes(nodes, rowDataFromCells(row as ICell[])));
}

function cellKey(value: unknown): string {
    if (value == null || value === '') {
        return 'пусто';
    }
    return String(value);
}

function findGroupValue(row: ICell[], field: string): unknown {
    const cell = flattenCells(row).find((item) => item.columnName === field);
    return cell?.value.viewedData ?? cell?.value.originalData;
}

export function groupTableRows(rows: (ICell | ICell[])[][], selectedGroupFields: string[]): ITreeRow[] {
    let keyId = 0;

    const walk = (current: (ICell | ICell[])[][], depth: number): ITreeRow[] => {
        if (depth >= selectedGroupFields.length) {
            return current.map((cells) => ({
                cells: cells as ICell[],
                sourceId: (cells as (ICell | ICell[])[] & { sourceId?: string }).sourceId,
            }));
        }
        const field = selectedGroupFields[depth];
        const buckets = new Map<string, { value: unknown; rows: (ICell | ICell[])[][] }>();
        for (const row of current) {
            const value = findGroupValue(row as ICell[], field);
            const key = cellKey(value);
            const bucket = buckets.get(key);
            if (bucket) {
                bucket.rows.push(row);
            } else {
                buckets.set(key, { value, rows: [row] });
            }
        }
        return [...buckets.values()].map((bucket) => ({
            cells: [],
            isGroup: true as const,
            groupField: field,
            groupValue: bucket.value,
            groupKey: `${cellKey(bucket.value)}--${keyId++}`,
            children: walk(bucket.rows, depth + 1),
        }));
    };

    return walk(rows, 0);
}

const HORIZONTAL_JUSTIFY: Record<Exclude<ConditionalAppearance['horizontalAlign'], undefined | 'auto'>, string> = {
    left: 'flex-start',
    center: 'center',
    right: 'flex-end',
    justify: 'flex-start',
};

export function appearanceToStyle(appearance: ConditionalAppearance, rawValue?: unknown): Record<string, string> {
    const style: Record<string, string> = {};
    if (appearance.backgroundColor) {
        style.backgroundColor = appearance.backgroundColor;
    }
    if (appearance.textColor) {
        style.color = appearance.textColor;
    }
    if (appearance.font?.bold) {
        style.fontWeight = '700';
    }
    if (appearance.font?.italic) {
        style.fontStyle = 'italic';
    }
    const decorations: string[] = [];
    if (appearance.font?.underline) {
        decorations.push('underline');
    }
    if (appearance.font?.strikethrough) {
        decorations.push('line-through');
    }
    const empty = rawValue == null || rawValue === '';
    if (appearance.markIncomplete && empty) {
        decorations.push('underline');
    }
    if (decorations.length > 0) {
        style.textDecoration = decorations.join(' ');
    }
    if (appearance.font?.size) {
        style.fontSize = `${appearance.font.size}px`;
    }
    if (appearance.font?.name) {
        style.fontFamily = appearance.font.name;
    }
    if (appearance.horizontalAlign && appearance.horizontalAlign !== 'auto') {
        style.textAlign = appearance.horizontalAlign;
        style.justifyContent = HORIZONTAL_JUSTIFY[appearance.horizontalAlign];
    }
    if (appearance.verticalAlign) {
        style.alignItems =
            appearance.verticalAlign === 'top' ? 'flex-start' : appearance.verticalAlign === 'bottom' ? 'flex-end' : 'center';
    }
    const transforms: string[] = [];
    if (appearance.textOrientation === 'bottomToTop') {
        style.writingMode = 'vertical-rl';
        transforms.push('rotate(180deg)');
    } else if (appearance.textOrientation === 'topToBottom') {
        style.writingMode = 'vertical-rl';
    }
    if (appearance.mirror === 'horizontal') {
        transforms.push('scaleX(-1)');
    } else if (appearance.mirror === 'vertical') {
        transforms.push('scaleY(-1)');
    }
    if (transforms.length > 0) {
        style.transform = transforms.join(' ');
    }
    if (appearance.markNegatives && typeof rawValue === 'number' && rawValue < 0 && !appearance.textColor) {
        style.color = '#f4515d';
    }
    return style;
}

export function chromeAppearanceStyle(style: Record<string, string>): Record<string, string> {
    const { transform: _transform, writingMode: _writingMode, ...chrome } = style;
    return chrome;
}

export function applyOneCFormat(value: unknown, format: string): string {
    let text = String(formatCellValue(value) ?? '');
    const numberFmt = format.match(/Ч=([0#]+(?:[.,][0#]+)?)/i);
    if (numberFmt && value != null && value !== '') {
        const decimals = (numberFmt[1].split(/[.,]/)[1] ?? '').length;
        const numeric = Number(value);
        if (Number.isFinite(numeric)) {
            text = numeric.toFixed(decimals);
        }
    }
    const dateFmt = format.match(/ДФ=([^\s;]+)/i);
    if (dateFmt && value != null && value !== '') {
        const date = new Date(String(value));
        if (!Number.isNaN(date.getTime())) {
            const pad = (part: number) => String(part).padStart(2, '0');
            text = dateFmt[1]
                .replace(/дд/g, pad(date.getDate()))
                .replace(/ММ/g, pad(date.getMonth() + 1))
                .replace(/уууу/g, String(date.getFullYear()))
                .replace(/гггг/g, String(date.getFullYear()));
        }
    }
    if (/СГР=ВЕРХНИЙ/i.test(format)) {
        text = text.toUpperCase();
    } else if (/СГР=НИЖНИЙ/i.test(format)) {
        text = text.toLowerCase();
    }
    return text;
}

export function decorationsForRow(
    rowData: Record<string, unknown>,
    rules: ConditionalFormattingRule[]
): Record<string, ConditionalCellDecoration> {
    const result: Record<string, ConditionalCellDecoration> = {};
    for (const rule of rules) {
        if (!rule.enabled) {
            continue;
        }
        if (!evaluateSelectionNodes(rule.conditionNodes, rowData)) {
            continue;
        }
        const fields = rule.targetFields.length > 0 ? rule.targetFields : Object.keys(rowData);
        for (const field of fields) {
            const raw = rowData[field];
            const previous = result[field];
            result[field] = {
                style: { ...previous?.style, ...appearanceToStyle(rule.appearance, raw) },
                text: rule.appearance.text !== undefined ? rule.appearance.text : previous?.text,
                formattedValue: rule.appearance.format
                    ? applyOneCFormat(raw, rule.appearance.format)
                    : previous?.formattedValue,
            };
        }
    }
    return result;
}

export function matchingFormattingRules(
    rowData: Record<string, unknown>,
    rules: ConditionalFormattingRule[]
): ConditionalFormattingRule[] {
    return rules.filter((rule) => rule.enabled && evaluateSelectionNodes(rule.conditionNodes, rowData));
}

export function ruleMatchesRow(rowData: Record<string, unknown>, rules: ConditionalFormattingRule[]): boolean {
    return rules.some((rule) => rule.enabled && evaluateSelectionNodes(rule.conditionNodes, rowData));
}

export function toDataTableViewModel(
    data: IData,
    view: ActiveListView,
    columnGroupingRoot: ColumnGroupNode,
    fieldTypes: Record<string, ListFieldDataType>,
    originalOrder?: Record<number, string>
): { data: ICell[][] | ITreeRow[]; columns: TableCol[] } {
    const sorted: IData = {
        ...data,
        rows: applySortToRows(data.rows, view.activeSortRules, fieldTypes, originalOrder),
    };
    const columns = applyColumnGroupingToCols(sorted.cols, columnGroupingRoot);
    const table = transformStateForRender(sorted, columns);
    const selected = applySelectionToFlatRows(table.data, view.activeSelectionNodes);
    if (view.activeGroupFields.length === 0) {
        return { data: selected as ICell[][], columns };
    }
    return { data: groupTableRows(selected, view.activeGroupFields), columns };
}

export function getActiveListView(settings: {
    selectionNodes: SelectionNode[];
    grouping: { selectedGroupFields: string[]; disabledGroupFields: string[] };
    sort: { sortRules: SortRule[] };
    conditionalFormattingRules: ConditionalFormattingRule[];
}): ActiveListView {
    return {
        activeSelectionNodes: settings.selectionNodes.filter((node) => node.enabled !== false),
        activeGroupFields: getActiveGroupFields(settings.grouping),
        activeSortRules: settings.sort.sortRules.filter((rule) => rule.enabled),
        activeConditionalFormattingRules: settings.conditionalFormattingRules.filter((rule) => rule.enabled),
    };
}
