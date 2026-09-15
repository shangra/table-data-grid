import { Component, createRef, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import './DataTable.css';
import { isTreeRow, normalizeCells } from '../../groupTableRows';
import { ICell } from '../../types';
import { GroupMarkerDown } from './Icons/groupMarkerDown';
import { GroupMarkerRight } from './Icons/groupMarkerRight';
import { ITreeRow, IColumnData, IReactWindowWrapperCombined } from '../types';
import * as ListSettings from '../../../../../helpers/listSettings';
import {
    getConditionalFormattingSettingsState,
    subscribeListSettingsRevision,
    unsubscribeListSettingsRevision,
    getListSettingsRevision,
} from '../../../../../helpers/listSettings';
import {
    resolveConditionalCellDecoration,
    resolveSubstringAppearance,
    ruleMatchesCondition,
} from '../../../../../helpers/listSettings/facets/conditionalFormatting/apply';

type GroupedColumn = IColumnData | (GroupedColumn[] & { title?: string; orientation?: 'horizontal' | 'vertical' });

type CfRule = {
    enabled: boolean;
    applyToSubstrings?: boolean;
};

function substringGroupStyle(rules: CfRule[]): CSSProperties {
    const apply = resolveSubstringAppearance as unknown as (appearance: object, extra: unknown) => CSSProperties;
    return apply({}, rules) ?? {};
}

type SortDirection = 'ASC' | 'DESC';

interface SortRule {
    field: string;
    direction: SortDirection;
    enabled: boolean;
}

type FilterComparison = 'contains' | 'eq' | 'empty' | 'filled';

interface ColumnFilter {
    comparison: FilterComparison;
    value: string;
}

interface ExtraTableProps {
    onSort?: (payload: { column: string; direction: SortDirection | null }) => void;
    onSortRulesChange?: (rules: SortRule[]) => void;
    onColumnMove?: (fromIndex: number, toIndex: number) => void;
    onColumnResize?: (columnName: string, width: number) => void;
    onRowMove?: (fromId: string, toId: string) => void;
    onCellChange?: (rowId: string, field: string, value: string) => void;
    onSelectionChange?: (ids: string[]) => void;
    onDeleteRows?: (ids: string[]) => void;
    onCopyRows?: (ids: string[]) => void;
    onEditRow?: (rowId: string, field?: string) => void;
    onColumnFilterChange?: (filters: Record<string, ColumnFilter>) => void;
    onLoadMore?: () => void;
    hasMore?: boolean;
    loadingMore?: boolean;
}

interface LeafTrack {
    id: string;
    rootId: string;
    title: string;
    width: number;
    flexGrow: boolean;
    kind: 'field' | 'stack';
    field?: string;
    stackLeaves?: IColumnData[];
}

interface DisplayRow {
    id: string;
    kind: 'group' | 'leaf';
    depth: number;
    cells: ICell[];
    groupField?: string;
    groupValue?: unknown;
    groupKey?: string;
    leafCount?: number;
    expanded?: boolean;
    substringHit?: boolean;
}

interface FilterMenuState {
    field: string;
    left: number;
    top: number;
}

interface ContextMenuState {
    rowId: string;
    field?: string;
    x: number;
    y: number;
}

interface RowGeometry {
    top: number;
    height: number;
}

type DragState =
    | { kind: 'row'; fromId: string; overId: string; x: number; y: number; label: string }
    | { kind: 'col'; fromRootId: string; overRootId: string; x: number; y: number; label: string };

interface DataTableState {
    expandedGroups: Set<string> | 'all';
    listSettingsRevision: number;
    scrollTop: number;
    viewportHeight: number;
    viewportWidth: number;
    scrolling: boolean;
    afterCreated: boolean;
    drag: DragState | null;
    widthOverrides: Record<string, number>;
    rootOrder: string[] | null;
    selectedIds: Set<string>;
    columnFilters: Record<string, ColumnFilter>;
    filterMenu: FilterMenuState | null;
    contextMenu: ContextMenuState | null;
    editing: { rowId: string; field: string } | null;
}

const ROW_BUFFER = 10;
const DRAG_START_PIXELS = 4;
const CHECK_WIDTH = 28;
const LOAD_MORE_PX = 96;

function formatCellValue(value: unknown): string {
    if (value === null || value === undefined) {
        return '';
    }
    if (typeof value === 'boolean') {
        return value ? 'Да' : 'Нет';
    }
    return String(value);
}

function isVerticalGroup(col: GroupedColumn): boolean {
    return Array.isArray(col) && (col as GroupedColumn[] & { orientation?: string }).orientation === 'vertical';
}

function flattenCellList(item: ICell | ICell[]): ICell[] {
    if (Array.isArray(item)) {
        return item.flatMap((child) => flattenCellList(child as ICell | ICell[]));
    }
    return item ? [item] : [];
}

function getLeafCells(item: ICell | ICell[] | ITreeRow | Record<string, unknown>[]): ICell[] | null {
    if (isTreeRow(item)) {
        if (item.isGroup) {
            return null;
        }
        return normalizeCells(item.cells);
    }
    if (Array.isArray(item)) {
        if (item.length === 0) {
            return [];
        }
        const first = item[0] as { columnName?: unknown; cells?: unknown };
        if (first && typeof first === 'object' && 'columnName' in first) {
            return flattenCellList(item as ICell | ICell[]);
        }
        return null;
    }
    return null;
}

function collectLeafColumns(group: GroupedColumn[], target: IColumnData[]): void {
    for (const col of group) {
        if (Array.isArray(col)) {
            collectLeafColumns(col, target);
        } else {
            target.push(col as IColumnData);
        }
    }
}

function collapsedGroupTitle(group: GroupedColumn[], leaves: IColumnData[]): string {
    const { title } = group as GroupedColumn[] & { title?: string };
    if (title && title.trim()) {
        return title.trim();
    }
    return leaves.map((column) => column.label ?? column.name).join(' / ');
}

function buildLeaves(columns: GroupedColumn[]): { leaves: LeafTrack[]; hasGroupHeader: boolean } {
    const leaves: LeafTrack[] = [];
    let hasGroupHeader = false;

    columns.forEach((col, colIndex) => {
        const rootId = Array.isArray(col) ? `group:${colIndex}` : `col:${(col as IColumnData).name}`;
        if (!Array.isArray(col)) {
            leaves.push({
                id: col.name,
                rootId,
                title: col.label ?? col.name,
                width: col.cellWidth ?? 140,
                flexGrow: Boolean(col.cellFlexGrow),
                kind: 'field',
                field: col.name,
            });
            return;
        }
        if (isVerticalGroup(col)) {
            const stacked: IColumnData[] = [];
            collectLeafColumns(col, stacked);
            leaves.push({
                id: `stack:${colIndex}`,
                rootId,
                title: collapsedGroupTitle(col, stacked),
                width: stacked[0]?.cellWidth ?? 180,
                flexGrow: Boolean(stacked[0]?.cellFlexGrow),
                kind: 'stack',
                stackLeaves: stacked,
            });
            hasGroupHeader = true;
            return;
        }
        const title = (col as GroupedColumn[] & { title?: string }).title ?? '';
        if (title.trim()) {
            hasGroupHeader = true;
        }
        for (const child of col) {
            if (Array.isArray(child)) {
                const nested: IColumnData[] = [];
                collectLeafColumns(child as GroupedColumn[], nested);
                nested.forEach((leaf) => {
                    leaves.push({
                        id: leaf.name,
                        rootId,
                        title: leaf.label ?? leaf.name,
                        width: leaf.cellWidth ?? 140,
                        flexGrow: Boolean(leaf.cellFlexGrow),
                        kind: 'field',
                        field: leaf.name,
                    });
                });
            } else {
                const leaf = child as IColumnData;
                leaves.push({
                    id: leaf.name,
                    rootId,
                    title: leaf.label ?? leaf.name,
                    width: leaf.cellWidth ?? 140,
                    flexGrow: Boolean(leaf.cellFlexGrow),
                    kind: 'field',
                    field: leaf.name,
                });
            }
        }
    });

    return { leaves, hasGroupHeader };
}

function bandTitleByRoot(columns: GroupedColumn[]): Map<string, string> {
    const map = new Map<string, string>();
    columns.forEach((col, colIndex) => {
        if (!Array.isArray(col)) {
            return;
        }
        const title = (col as GroupedColumn[] & { title?: string }).title ?? '';
        if (title.trim()) {
            map.set(`group:${colIndex}`, title.trim());
        }
    });
    return map;
}

function prefixOffsets(widths: number[]): number[] {
    const lefts: number[] = [];
    let x = 0;
    for (const width of widths) {
        lefts.push(x);
        x += width;
    }
    return lefts;
}

function allocateColumnWidths(leaves: LeafTrack[], available: number, overrides: Record<string, number>): number[] {
    const min = leaves.map((leaf) => overrides[leaf.id] ?? leaf.width);
    const fixed = min.reduce((sum, width) => sum + width, 0);
    const flexIndexes = leaves.map((leaf, index) => (leaf.flexGrow && overrides[leaf.id] == null ? index : -1)).filter((index) => index >= 0);
    if (flexIndexes.length === 0 || available <= fixed) {
        return min;
    }
    const extra = (available - fixed) / flexIndexes.length;
    return min.map((width, index) => (flexIndexes.includes(index) ? width + extra : width));
}

function buildRowGeometry(heights: number[]): { rows: RowGeometry[]; totalHeight: number } {
    const rows: RowGeometry[] = [];
    let top = 0;
    for (const height of heights) {
        rows.push({ top, height });
        top += height;
    }
    return { rows, totalHeight: top };
}

function isRowInPixel(row: RowGeometry, pixelToMatch: number): boolean {
    return row.top <= pixelToMatch && row.top + row.height > pixelToMatch;
}

function getRowIndexAtPixel(rows: RowGeometry[], pixelToMatch: number): number {
    const len = rows.length;
    if (len === 0) {
        return -1;
    }
    if (pixelToMatch <= 0) {
        return 0;
    }
    const last = rows[len - 1];
    if (last.top <= pixelToMatch) {
        return len - 1;
    }
    let bottom = 0;
    let top = len - 1;
    while (bottom <= top) {
        const mid = Math.floor((bottom + top) / 2);
        const current = rows[mid];
        if (isRowInPixel(current, pixelToMatch)) {
            return mid;
        }
        if (current.top < pixelToMatch) {
            bottom = mid + 1;
        } else {
            top = mid - 1;
        }
    }
    return Math.max(0, Math.min(len - 1, bottom));
}

function firstAndLastRowsToRender(
    rows: RowGeometry[],
    scrollTop: number,
    viewportHeight: number,
    defaultRowHeight: number
): { first: number; last: number } {
    if (rows.length === 0) {
        return { first: 0, last: -1 };
    }
    const bufferPixels = ROW_BUFFER * defaultRowHeight;
    const pageLastPixel = rows[rows.length - 1].top + rows[rows.length - 1].height;
    const firstPixel = Math.max(scrollTop - bufferPixels, 0);
    const lastPixel = Math.min(scrollTop + viewportHeight + bufferPixels, pageLastPixel);
    let first = getRowIndexAtPixel(rows, firstPixel);
    let last = getRowIndexAtPixel(rows, Math.max(0, lastPixel - 1));
    if (first < 0) {
        first = 0;
    }
    if (last < first) {
        last = first;
    }
    return { first, last };
}

function countLeaves(node: ITreeRow): number {
    if (!node.isGroup) {
        return 1;
    }
    return (node.children ?? []).reduce((sum, child) => sum + countLeaves(child as ITreeRow), 0);
}

function getConfigCellHeight(columns: GroupedColumn[]): number {
    let height = 36;
    const collect = (list: GroupedColumn[]): void => {
        for (const col of list) {
            if (Array.isArray(col)) {
                collect(col);
            } else if (col.cellHeight && col.cellHeight > height) {
                height = col.cellHeight;
            }
        }
    };
    collect(columns);
    return height;
}

function rowDataFromCells(cells: ICell[]): Record<string, unknown> {
    const rowData: Record<string, unknown> = {};
    for (const cell of cells) {
        rowData[cell.columnName] = cell.value.viewedData ?? cell.value.originalData;
    }
    return rowData;
}

function rawCellText(row: DisplayRow, field: string): string {
    const cell = row.cells.find((item) => item.columnName === field);
    return formatCellValue(cell?.value.viewedData ?? cell?.value.originalData);
}

function leafMatchesFilters(row: DisplayRow, filters: Record<string, ColumnFilter>): boolean {
    const entries = Object.entries(filters);
    if (entries.length === 0) {
        return true;
    }
    return entries.every(([field, filter]) => {
        const text = rawCellText(row, field).toLowerCase();
        if (filter.comparison === 'empty') {
            return text === '';
        }
        if (filter.comparison === 'filled') {
            return text !== '';
        }
        const needle = filter.value.trim().toLowerCase();
        if (!needle) {
            return true;
        }
        if (filter.comparison === 'eq') {
            return text === needle;
        }
        return text.includes(needle);
    });
}

function applyColumnFilters(rows: DisplayRow[], filters: Record<string, ColumnFilter>): DisplayRow[] {
    const active = Object.fromEntries(
        Object.entries(filters).filter(([, filter]) => filter.comparison === 'empty' || filter.comparison === 'filled' || filter.value.trim() !== '')
    );
    if (Object.keys(active).length === 0) {
        return rows;
    }
    const keep = new Set<string>();
    for (let index = rows.length - 1; index >= 0; index--) {
        const row = rows[index];
        if (row.kind === 'leaf') {
            if (leafMatchesFilters(row, active)) {
                keep.add(row.id);
            }
            continue;
        }
        let child = index + 1;
        let any = false;
        while (child < rows.length && rows[child].depth > row.depth) {
            if (keep.has(rows[child].id)) {
                any = true;
                break;
            }
            child += 1;
        }
        if (any) {
            keep.add(row.id);
        }
    }
    return rows.filter((row) => keep.has(row.id));
}

function collectAncestorGroupKeys(
    children: (ICell | ICell[] | ITreeRow | Record<string, unknown>[])[],
    rules: CfRule[],
    matchedKeys: Set<string>,
    parentPath: string[]
): void {
    for (const child of children) {
        if (isTreeRow(child) && child.isGroup) {
            const childKey = String(child.groupKey ?? 'unknown');
            const newPath = [...parentPath, childKey];
            const childChildren = (child.children ?? []) as typeof children;
            collectAncestorGroupKeys(childChildren, rules, matchedKeys, newPath);

            const childRowData: Record<string, unknown>[] = [];
            for (const gc of childChildren) {
                const leaf = getLeafCells(gc);
                if (leaf) {
                    childRowData.push(rowDataFromCells(leaf));
                }
            }
            for (const rule of rules) {
                if (!rule.enabled || !rule.applyToSubstrings) {
                    continue;
                }
                if (childRowData.some((data) => ruleMatchesCondition(rule as never, data))) {
                    for (const key of newPath) {
                        matchedKeys.add(key);
                    }
                }
            }
        } else {
            const leaf = getLeafCells(child);
            if (!leaf) {
                continue;
            }
            const rowData = rowDataFromCells(leaf);
            for (const parentKeyItem of parentPath) {
                for (const rule of rules) {
                    if (!rule.enabled || !rule.applyToSubstrings) {
                        continue;
                    }
                    if (ruleMatchesCondition(rule as never, rowData)) {
                        matchedKeys.add(parentKeyItem);
                    }
                }
            }
        }
    }
}

function isExpandedKey(expanded: Set<string> | 'all', id: string): boolean {
    return expanded === 'all' || expanded.has(id);
}

function collectGroupKeys(data: (ICell | ICell[] | ITreeRow | Record<string, unknown>[])[]): string[] {
    const keys: string[] = [];
    const walk = (rows: typeof data) => {
        for (const item of rows) {
            if (isTreeRow(item) && item.isGroup) {
                keys.push(String(item.groupKey ?? 'unknown'));
                walk((item.children ?? []) as typeof data);
            }
        }
    };
    walk(data);
    return keys;
}

function flattenRows(
    data: (ICell | ICell[] | ITreeRow | Record<string, unknown>[])[],
    expandedGroups: Set<string> | 'all',
    rules: CfRule[]
): DisplayRow[] {
    const into: DisplayRow[] = [];
    const matchedKeys = new Set<string>();
    for (const item of data) {
        if (isTreeRow(item) && item.isGroup) {
            collectAncestorGroupKeys(
                (item.children ?? []) as (ICell | ICell[] | ITreeRow | Record<string, unknown>[])[],
                rules,
                matchedKeys,
                [String(item.groupKey ?? 'unknown')]
            );
        }
    }

    const walk = (rows: typeof data, depth: number) => {
        rows.forEach((item, index) => {
            if (isTreeRow(item) && item.isGroup) {
                const groupKey = String(item.groupKey ?? `group-${depth}-${index}`);
                const isExpanded = isExpandedKey(expandedGroups, groupKey);
                into.push({
                    id: groupKey,
                    kind: 'group',
                    depth,
                    cells: [],
                    groupField: typeof item.groupField === 'string' ? item.groupField : undefined,
                    groupValue: item.groupValue,
                    groupKey,
                    leafCount: countLeaves(item),
                    expanded: isExpanded,
                    substringHit: matchedKeys.has(groupKey),
                });
                if (isExpanded) {
                    walk((item.children ?? []) as typeof data, depth + 1);
                }
                return;
            }
            const cells = getLeafCells(item) ?? [];
            const sourceId = String((item as { sourceId?: string }).sourceId ?? cells[0]?.rowIndex ?? `row-${depth}-${index}`);
            into.push({
                id: sourceId,
                kind: 'leaf',
                depth,
                cells,
            });
        });
    };

    walk(data, 0);
    return into;
}

function cycleSortRules(rules: SortRule[], field: string): SortRule[] {
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

function readSortRules(): SortRule[] {
    const helpers = ListSettings as typeof ListSettings & {
        getActiveListView?: () => { activeSortRules?: SortRule[] };
        getSortSettingsState?: () => { sortRules?: SortRule[] };
    };
    return helpers.getSortSettingsState?.()?.sortRules ?? helpers.getActiveListView?.()?.activeSortRules ?? [];
}

function commitSortRules(rules: SortRule[]): void {
    const helpers = ListSettings as typeof ListSettings & {
        getSortSettingsState?: () => Record<string, unknown>;
        replaceSortSettingsState?: (state: unknown) => void;
        sortSettingsActions?: { replace?: (state: unknown) => void; commit?: (state: unknown) => void };
    };
    const current = helpers.getSortSettingsState?.() ?? {};
    const next = { ...current, sortRules: rules };
    helpers.replaceSortSettingsState?.(next);
    helpers.sortSettingsActions?.replace?.(next);
    helpers.sortSettingsActions?.commit?.(next);
}

function moveLeavesByRoot(leaves: LeafTrack[], fromRootId: string, toRootId: string): LeafTrack[] {
    if (fromRootId === toRootId) {
        return leaves;
    }
    const block = leaves.filter((leaf) => leaf.rootId === fromRootId);
    const rest = leaves.filter((leaf) => leaf.rootId !== fromRootId);
    const insertAt = rest.findIndex((leaf) => leaf.rootId === toRootId);
    if (block.length === 0 || insertAt < 0) {
        return leaves;
    }
    return [...rest.slice(0, insertAt), ...block, ...rest.slice(insertAt)];
}

function moveRow(rows: DisplayRow[], fromId: string, overId: string): DisplayRow[] {
    if (fromId === overId) {
        return rows;
    }
    const next = [...rows];
    const from = next.findIndex((row) => row.id === fromId);
    const to = next.findIndex((row) => row.id === overId);
    if (from < 0 || to < 0) {
        return rows;
    }
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
}

function leafIdForTarget(rows: DisplayRow[], overId: string, fromId: string): string | null {
    const overIndex = rows.findIndex((row) => row.id === overId);
    if (overIndex < 0) {
        return null;
    }
    if (rows[overIndex].kind === 'leaf') {
        return rows[overIndex].id;
    }
    for (let index = overIndex + 1; index < rows.length; index++) {
        if (rows[index].kind === 'leaf' && rows[index].id !== fromId) {
            return rows[index].id;
        }
    }
    for (let index = overIndex - 1; index >= 0; index--) {
        if (rows[index].kind === 'leaf' && rows[index].id !== fromId) {
            return rows[index].id;
        }
    }
    return null;
}

function reorderColumns(columns: GroupedColumn[], fromRootId: string, toRootId: string): GroupedColumn[] {
    const ids = columns.map((col, index) => (Array.isArray(col) ? `group:${index}` : `col:${(col as IColumnData).name}`));
    const from = ids.indexOf(fromRootId);
    const to = ids.indexOf(toRootId);
    if (from < 0 || to < 0 || from === to) {
        return columns;
    }
    const next = [...columns];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
}

function cellText(row: DisplayRow, field: string, rules: CfRule[]): { text: string; style?: CSSProperties } {
    const cell = row.cells.find((item) => item.columnName === field);
    const raw = cell?.value.viewedData ?? cell?.value.originalData;
    const fallback = formatCellValue(raw);
    const rowData = rowDataFromCells(row.cells);
    const decoration = resolveConditionalCellDecoration(rowData, field, rules as never);
    return {
        text: String(decoration?.text ?? decoration?.formattedValue ?? fallback),
        style: decoration?.style as CSSProperties | undefined,
    };
}

export class DataTable extends Component<IReactWindowWrapperCombined, DataTableState> {
    static SUBSCRIBER = 'DataTable';

    private scrollerRef = createRef<HTMLDivElement>();
    private headerRef = createRef<HTMLDivElement>();
    private resizeObserver: ResizeObserver | null = null;
    private createdTimer = 0;
    private scrollTimer = 0;
    private frame = 0;

    private loadMoreLock = false;
    private pendingScroll: { rowId: string; field?: string } | null = null;
    private dataLength = 0;

    constructor(props: IReactWindowWrapperCombined) {
        super(props);
        this.state = {
            expandedGroups: 'all',
            listSettingsRevision: getListSettingsRevision(),
            scrollTop: 0,
            viewportHeight: 400,
            viewportWidth: 800,
            scrolling: false,
            afterCreated: false,
            drag: null,
            widthOverrides: {},
            rootOrder: null,
            selectedIds: new Set(),
            columnFilters: {},
            filterMenu: null,
            contextMenu: null,
            editing: null,
        };
        subscribeListSettingsRevision(DataTable.SUBSCRIBER, () => {
            this.setState({ listSettingsRevision: getListSettingsRevision() });
        });
    }

    componentDidMount(): void {
        this.createdTimer = window.setTimeout(() => this.setState({ afterCreated: true }), 1000);
        const el = this.scrollerRef.current;
        if (!el) {
            return;
        }
        const onScroll = () => {
            this.setState({ scrolling: true });
            window.clearTimeout(this.scrollTimer);
            this.scrollTimer = window.setTimeout(() => this.setState({ scrolling: false }), 120);
            if (this.frame) {
                return;
            }
            this.frame = window.requestAnimationFrame(() => {
                this.frame = 0;
                const scroller = this.scrollerRef.current;
                if (!scroller) {
                    return;
                }
                if (this.headerRef.current) {
                    this.headerRef.current.scrollLeft = scroller.scrollLeft;
                }
                this.setState({ scrollTop: scroller.scrollTop });
                this.maybeLoadMore(scroller);
            });
        };
        el.addEventListener('scroll', onScroll, { passive: true });
        this.resizeObserver = new ResizeObserver(() => {
            this.setState({ viewportHeight: el.clientHeight, viewportWidth: el.clientWidth });
        });
        this.resizeObserver.observe(el);
        this.setState({ viewportHeight: el.clientHeight, viewportWidth: el.clientWidth });
        (this as unknown as { _onScroll: () => void })._onScroll = onScroll;
        document.addEventListener('mousedown', this.closePopups);
    }

    componentDidUpdate(): void {
        const { data } = this.tableModel();
        if (data.length !== this.dataLength) {
            this.dataLength = data.length;
            this.loadMoreLock = false;
        }
        if (this.pendingScroll) {
            const next = this.pendingScroll;
            this.pendingScroll = null;
            this.applyScrollToCell(next.rowId, next.field);
        }
    }

    componentWillUnmount(): void {
        unsubscribeListSettingsRevision(DataTable.SUBSCRIBER);
        window.clearTimeout(this.createdTimer);
        window.clearTimeout(this.scrollTimer);
        if (this.frame) {
            window.cancelAnimationFrame(this.frame);
        }
        const el = this.scrollerRef.current;
        const onScroll = (this as unknown as { _onScroll?: () => void })._onScroll;
        if (el && onScroll) {
            el.removeEventListener('scroll', onScroll);
        }
        this.resizeObserver?.disconnect();
        document.removeEventListener('mousedown', this.closePopups);
    }

    extra(): ExtraTableProps {
        return this.props as IReactWindowWrapperCombined & ExtraTableProps;
    }

    closePopups = (event: MouseEvent) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest('.data-table__menu') || target?.closest('.data-table__filter-btn')) {
            return;
        }
        if (this.state.filterMenu || this.state.contextMenu) {
            this.setState({ filterMenu: null, contextMenu: null });
        }
    };

    maybeLoadMore = (scroller: HTMLDivElement) => {
        const extra = this.extra();
        if (!extra.onLoadMore || extra.hasMore === false || extra.loadingMore || this.loadMoreLock) {
            return;
        }
        if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - LOAD_MORE_PX) {
            this.loadMoreLock = true;
            extra.onLoadMore();
            window.setTimeout(() => {
                this.loadMoreLock = false;
            }, 500);
        }
    };

    scrollToCell = (rowId: string, field?: string) => {
        this.pendingScroll = { rowId, field };
        this.setState({ expandedGroups: 'all', contextMenu: null });
    };

    scrollToRow = (rowId: string) => {
        this.scrollToCell(rowId);
    };

    applyScrollToCell = (rowId: string, field?: string) => {
        const scroller = this.scrollerRef.current;
        if (!scroller) {
            return;
        }
        const { data, columns } = this.tableModel();
        const rules = (getConditionalFormattingSettingsState().conditionalFormattingRules ?? []) as CfRule[];
        const grouping = data.length > 0 && isTreeRow(data[0]) && Boolean((data[0] as ITreeRow).isGroup);
        const treeWidth = (grouping ? 260 : 32) + CHECK_WIDTH;
        const leafHeight = Math.max(36, getConfigCellHeight(columns));
        const rows = applyColumnFilters(flattenRows(data, 'all', rules), this.state.columnFilters);
        const index = rows.findIndex((row) => row.id === rowId);
        if (index < 0) {
            return;
        }
        const heights = rows.map((row) => (row.kind === 'group' ? 42 : leafHeight));
        const geometry = buildRowGeometry(heights);
        const top = geometry.rows[index]?.top ?? 0;
        const rowH = geometry.rows[index]?.height ?? leafHeight;
        const maxTop = Math.max(0, top - Math.max(0, (scroller.clientHeight - rowH) / 2));
        scroller.scrollTop = maxTop;
        if (field) {
            const leaves = buildLeaves(columns).leaves;
            const leafIndex = leaves.findIndex((leaf) => leaf.field === field || leaf.stackLeaves?.some((item) => item.name === field));
            if (leafIndex >= 0) {
                const widths = allocateColumnWidths(leaves, Math.max(0, scroller.clientWidth - treeWidth), this.state.widthOverrides);
                scroller.scrollLeft = prefixOffsets(widths)[leafIndex] ?? 0;
            }
        }
        this.setState({ scrollTop: scroller.scrollTop });
    };

    emitSelection = (selectedIds: Set<string>) => {
        this.extra().onSelectionChange?.([...selectedIds]);
    };

    toggleRowSelected = (rowId: string, event?: { stopPropagation: () => void }) => {
        event?.stopPropagation();
        this.setState((prev) => {
            const selectedIds = new Set(prev.selectedIds);
            if (selectedIds.has(rowId)) {
                selectedIds.delete(rowId);
            } else {
                selectedIds.add(rowId);
            }
            this.emitSelection(selectedIds);
            return { selectedIds };
        });
    };

    toggleSelectAll = (leafIds: string[]) => {
        this.setState((prev) => {
            const allOn = leafIds.length > 0 && leafIds.every((id) => prev.selectedIds.has(id));
            const selectedIds = allOn ? new Set<string>() : new Set(leafIds);
            this.emitSelection(selectedIds);
            return { selectedIds };
        });
    };

    selectedLeafRows = (rows: DisplayRow[]) => rows.filter((row) => row.kind === 'leaf' && this.state.selectedIds.has(row.id));

    copyRows = (ids: string[], rows: DisplayRow[]) => {
        if (ids.length === 0) {
            return;
        }
        this.extra().onCopyRows?.(ids);
        const lines = ids.map((id) => {
            const row = rows.find((item) => item.id === id);
            if (!row) {
                return '';
            }
            return row.cells.map((cell) => formatCellValue(cell.value.viewedData ?? cell.value.originalData)).join('\t');
        });
        void navigator.clipboard?.writeText(lines.join('\n'));
        this.setState({ contextMenu: null });
    };

    deleteRows = (ids: string[]) => {
        if (ids.length === 0) {
            return;
        }
        this.extra().onDeleteRows?.(ids);
        this.setState((prev) => {
            const selectedIds = new Set(prev.selectedIds);
            ids.forEach((id) => selectedIds.delete(id));
            return { selectedIds, contextMenu: null };
        });
    };

    startEdit = (rowId: string, field?: string) => {
        const nextField = field ?? 'name';
        this.extra().onEditRow?.(rowId, nextField);
        this.setState({ editing: { rowId, field: nextField }, contextMenu: null });
    };

    commitEdit = (rowId: string, field: string, value: string) => {
        this.extra().onCellChange?.(rowId, field, value);
        this.setState({ editing: null });
    };

    openFilterMenu = (event: ReactMouseEvent<HTMLButtonElement>, field: string) => {
        event.preventDefault();
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        this.setState({
            filterMenu: { field, left: rect.left, top: rect.bottom + 4 },
            contextMenu: null,
        });
    };

    setColumnFilter = (field: string, patch: Partial<ColumnFilter>) => {
        this.setState((prev) => {
            const current = prev.columnFilters[field] ?? { comparison: 'contains', value: '' };
            const nextFilter = { ...current, ...patch };
            const columnFilters = { ...prev.columnFilters };
            if (nextFilter.comparison !== 'empty' && nextFilter.comparison !== 'filled' && !nextFilter.value.trim()) {
                delete columnFilters[field];
            } else {
                columnFilters[field] = nextFilter;
            }
            this.extra().onColumnFilterChange?.(columnFilters);
            return { columnFilters };
        });
    };

    openContextMenu = (event: ReactMouseEvent, row: DisplayRow, field?: string) => {
        if (row.kind !== 'leaf') {
            return;
        }
        event.preventDefault();
        this.setState({
            contextMenu: { rowId: row.id, field, x: event.clientX, y: event.clientY },
            filterMenu: null,
        });
    };

    tableModel() {
        const raw = this.props as unknown as {
            data: (ICell | ICell[] | ITreeRow | Record<string, unknown>[])[];
            columns: GroupedColumn[];
        };
        const columns = this.state.rootOrder
            ? reorderByRootOrder(raw.columns ?? [], this.state.rootOrder)
            : (raw.columns ?? []);
        return { data: raw.data ?? [], columns };
    }

    handleToggleGroup = (groupKey: string) => {
        this.setState((prev) => {
            const { data } = this.tableModel();
            const next = new Set(prev.expandedGroups === 'all' ? collectGroupKeys(data) : prev.expandedGroups);
            if (next.has(groupKey)) {
                next.delete(groupKey);
            } else {
                next.add(groupKey);
            }
            return { expandedGroups: next };
        });
    };

    handleColumnSort = (field: string) => {
        const current = readSortRules();
        const next = cycleSortRules(current, field);
        const last = next.find((rule) => rule.field === field);
        commitSortRules(next);
        this.extra().onSortRulesChange?.(next);
        this.extra().onSort?.({ column: field, direction: last && last.enabled ? last.direction : null });
        this.setState({ listSettingsRevision: getListSettingsRevision() });
    };

    handleColumnMove = (fromRootId: string, toRootId: string) => {
        const { columns } = this.tableModel();
        const ids = columns.map((col, index) => (Array.isArray(col) ? `group:${index}` : `col:${(col as IColumnData).name}`));
        const from = ids.indexOf(fromRootId);
        const to = ids.indexOf(toRootId);
        const next = reorderColumns(columns, fromRootId, toRootId);
        const nextIds = next.map((col, index) => (Array.isArray(col) ? `group:${index}` : `col:${(col as IColumnData).name}`));
        this.setState({ rootOrder: nextIds });
        if (from >= 0 && to >= 0) {
            this.extra().onColumnMove?.(from, to);
        }
    };

    handleColumnResize = (leaf: LeafTrack, width: number) => {
        this.setState((prev) => ({
            widthOverrides: { ...prev.widthOverrides, [leaf.id]: width },
        }));
        if (leaf.field) {
            this.extra().onColumnResize?.(leaf.field, width);
        }
    };

    startRowDrag = (event: ReactPointerEvent<HTMLButtonElement>, row: DisplayRow, rows: DisplayRow[], geometry: { rows: RowGeometry[] }) => {
        if (row.kind !== 'leaf') {
            return;
        }
        event.stopPropagation();
        const handle = event.currentTarget;
        handle.setPointerCapture(event.pointerId);
        const origin = { x: event.clientX, y: event.clientY };
        let started = false;
        const label = cellText(row, 'name', []).text || cellText(row, 'code', []).text || row.id;

        const onMove = (move: PointerEvent) => {
            if (!started && Math.hypot(move.clientX - origin.x, move.clientY - origin.y) < DRAG_START_PIXELS) {
                return;
            }
            started = true;
            this.autoScroll(move.clientY);
            const over = this.rowAtClientY(move.clientY, rows, geometry);
            this.setState({
                drag: {
                    kind: 'row',
                    fromId: row.id,
                    overId: over?.id ?? row.id,
                    x: move.clientX,
                    y: move.clientY,
                    label,
                },
            });
        };
        const onUp = (up: PointerEvent) => {
            handle.releasePointerCapture(up.pointerId);
            handle.removeEventListener('pointermove', onMove);
            handle.removeEventListener('pointerup', onUp);
            const over = this.rowAtClientY(up.clientY, rows, geometry);
            const targetId = over ? leafIdForTarget(rows, over.id, row.id) : null;
            this.setState({ drag: null });
            if (started && targetId && targetId !== row.id) {
                this.extra().onRowMove?.(row.id, targetId);
            }
        };
        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onUp);
    };

    startColDrag = (event: ReactPointerEvent<HTMLDivElement>, leaf: LeafTrack, leaves: LeafTrack[], colWidths: number[], treeWidth: number) => {
        event.preventDefault();
        event.stopPropagation();
        const handle = event.currentTarget;
        handle.setPointerCapture(event.pointerId);
        const origin = { x: event.clientX, y: event.clientY };
        let started = false;
        const onMove = (move: PointerEvent) => {
            if (!started && Math.hypot(move.clientX - origin.x, move.clientY - origin.y) < DRAG_START_PIXELS) {
                return;
            }
            started = true;
            const over = this.leafAtClientX(move.clientX, leaves, colWidths, treeWidth);
            this.setState({
                drag: {
                    kind: 'col',
                    fromRootId: leaf.rootId,
                    overRootId: over?.rootId ?? leaf.rootId,
                    x: move.clientX,
                    y: move.clientY,
                    label: leaf.title,
                },
            });
        };
        const onUp = (up: PointerEvent) => {
            handle.releasePointerCapture(up.pointerId);
            handle.removeEventListener('pointermove', onMove);
            handle.removeEventListener('pointerup', onUp);
            const over = this.leafAtClientX(up.clientX, leaves, colWidths, treeWidth);
            this.setState({ drag: null });
            if (started && over && over.rootId !== leaf.rootId) {
                this.handleColumnMove(leaf.rootId, over.rootId);
            }
        };
        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onUp);
    };

    startResize = (event: ReactPointerEvent<HTMLSpanElement>, leaf: LeafTrack, startWidth: number) => {
        event.preventDefault();
        event.stopPropagation();
        const startX = event.clientX;
        const onMove = (move: PointerEvent) => {
            this.handleColumnResize(leaf, Math.max(60, startWidth + move.clientX - startX));
        };
        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    };

    autoScroll = (clientY: number) => {
        const scroller = this.scrollerRef.current;
        if (!scroller) {
            return;
        }
        const rect = scroller.getBoundingClientRect();
        if (clientY < rect.top + 28) {
            scroller.scrollTop -= 16;
        } else if (clientY > rect.bottom - 28) {
            scroller.scrollTop += 16;
        }
    };

    rowAtClientY(clientY: number, rows: DisplayRow[], geometry: { rows: RowGeometry[] }): DisplayRow | null {
        const scroller = this.scrollerRef.current;
        if (!scroller || rows.length === 0) {
            return null;
        }
        const pixel = scroller.scrollTop + clientY - scroller.getBoundingClientRect().top;
        const index = getRowIndexAtPixel(geometry.rows, pixel);
        return rows[index] ?? null;
    }

    leafAtClientX(clientX: number, leaves: LeafTrack[], colWidths: number[], treeWidth: number): LeafTrack | null {
        const scroller = this.scrollerRef.current;
        if (!scroller) {
            return null;
        }
        const x = clientX - scroller.getBoundingClientRect().left + scroller.scrollLeft - treeWidth;
        let cursor = 0;
        for (let i = 0; i < leaves.length; i++) {
            const width = colWidths[i] ?? leaves[i].width;
            if (x < cursor + width) {
                return leaves[i];
            }
            cursor += width;
        }
        return leaves[leaves.length - 1] ?? null;
    }

    renderFilterMenu(): ReactNode {
        const menu = this.state.filterMenu;
        if (!menu) {
            return null;
        }
        const filter = this.state.columnFilters[menu.field] ?? { comparison: 'contains' as FilterComparison, value: '' };
        return (
            <div className="data-table__menu" style={{ left: menu.left, top: menu.top }}>
                <div className="data-table__menu-title">Фильтр</div>
                <select
                    value={filter.comparison}
                    onChange={(event) => this.setColumnFilter(menu.field, { comparison: event.target.value as FilterComparison })}
                >
                    <option value="contains">Содержит</option>
                    <option value="eq">Равно</option>
                    <option value="filled">Заполнено</option>
                    <option value="empty">Пусто</option>
                </select>
                {filter.comparison !== 'empty' && filter.comparison !== 'filled' && (
                    <input
                        autoFocus
                        value={filter.value}
                        placeholder="Значение"
                        onChange={(event) => this.setColumnFilter(menu.field, { value: event.target.value })}
                    />
                )}
                <button type="button" onClick={() => this.setColumnFilter(menu.field, { value: '', comparison: 'contains' })}>
                    Сбросить
                </button>
            </div>
        );
    }

    renderContextMenu(rows: DisplayRow[]): ReactNode {
        const menu = this.state.contextMenu;
        if (!menu) {
            return null;
        }
        return (
            <div className="data-table__menu" style={{ left: menu.x, top: menu.y }}>
                <button type="button" onClick={() => this.startEdit(menu.rowId, menu.field)}>
                    Изменить
                </button>
                <button type="button" onClick={() => this.copyRows([menu.rowId], rows)}>
                    Копировать
                </button>
                <button type="button" onClick={() => this.deleteRows([menu.rowId])}>
                    Удалить
                </button>
            </div>
        );
    }

    render(): ReactNode {
        const { data, columns } = this.tableModel();
        const rules = (getConditionalFormattingSettingsState().conditionalFormattingRules ?? []) as CfRule[];
        const grouping = data.length > 0 && isTreeRow(data[0]) && Boolean((data[0] as ITreeRow).isGroup);
        const treeWidth = (grouping ? 260 : 32) + CHECK_WIDTH;
        const leafHeight = Math.max(36, getConfigCellHeight(columns));
        const built = buildLeaves(columns);
        const sortRules = readSortRules();
        const enabledSort = sortRules.filter((rule) => rule.enabled);
        const sortState = new Map(enabledSort.map((rule, index) => [rule.field, { direction: rule.direction, index, count: enabledSort.length }]));

        const drag = this.state.drag;
        const rowDrag = drag?.kind === 'row' ? drag : null;
        const colDrag = drag?.kind === 'col' ? drag : null;
        let leaves = built.leaves;
        if (colDrag) {
            leaves = moveLeavesByRoot(leaves, colDrag.fromRootId, colDrag.overRootId);
        }
        const bodyWidth = Math.max(0, this.state.viewportWidth - treeWidth);
        const colWidths = allocateColumnWidths(leaves, bodyWidth, this.state.widthOverrides);
        const paintedLefts = prefixOffsets(colWidths);
        const totalWidth = treeWidth + colWidths.reduce((sum, width) => sum + width, 0);
        const titles = bandTitleByRoot(columns);

        const rows = applyColumnFilters(flattenRows(data, this.state.expandedGroups, rules), this.state.columnFilters);
        const paintedRows = rowDrag ? moveRow(rows, rowDrag.fromId, rowDrag.overId) : rows;
        const leafIds = paintedRows.filter((row) => row.kind === 'leaf').map((row) => row.id);
        const selectedCount = leafIds.filter((id) => this.state.selectedIds.has(id)).length;
        const allSelected = leafIds.length > 0 && selectedCount === leafIds.length;
        const heights = paintedRows.map((row) => (row.kind === 'group' ? 42 : leafHeight));
        const geometry = buildRowGeometry(heights);
        const range = firstAndLastRowsToRender(geometry.rows, this.state.scrollTop, this.state.viewportHeight, leafHeight);
        const visible = paintedRows.slice(Math.max(0, range.first), range.last + 1);
        const dropOverIndex = rowDrag ? paintedRows.findIndex((row) => row.id === rowDrag.overId) : -1;
        const dropTop = dropOverIndex >= 0 ? geometry.rows[dropOverIndex]?.top : undefined;

        const className = [
            'data-table',
            'is-row-animation',
            this.state.afterCreated ? 'is-after-created' : '',
            this.state.scrolling && !drag ? 'is-prevent-animation' : '',
            colDrag ? 'is-column-moving' : '',
        ]
            .filter(Boolean)
            .join(' ');

        return (
            <div className={className}>
                {selectedCount > 0 && (
                    <div className="data-table__toolbar">
                        <span>Выбрано: {selectedCount}</span>
                        <button type="button" onClick={() => this.copyRows([...this.state.selectedIds], paintedRows)}>
                            Копировать
                        </button>
                        <button type="button" onClick={() => this.deleteRows([...this.state.selectedIds])}>
                            Удалить
                        </button>
                        <button type="button" onClick={() => this.toggleSelectAll([])}>
                            Снять
                        </button>
                    </div>
                )}
                <div className="data-table__header" ref={this.headerRef}>
                    {built.hasGroupHeader && (
                        <div className="data-table__header-row" style={{ width: totalWidth, height: 36 }}>
                            <div className="data-table__hcell data-table__pinned" style={{ left: 0, width: treeWidth }}>
                                <input
                                    type="checkbox"
                                    className="data-table__check"
                                    checked={allSelected}
                                    ref={(el) => {
                                        if (el) {
                                            el.indeterminate = selectedCount > 0 && !allSelected;
                                        }
                                    }}
                                    onChange={() => this.toggleSelectAll(allSelected ? [] : leafIds)}
                                    onPointerDown={(event) => event.stopPropagation()}
                                />
                                {grouping ? 'Группа' : ''}
                            </div>
                            {renderBands(leaves, colWidths, paintedLefts, treeWidth, titles, this.state.drag, this.startColDrag, this.startResize)}
                        </div>
                    )}
                    <div className="data-table__header-row" style={{ width: totalWidth, height: 36 }}>
                        <div className="data-table__hcell data-table__pinned" style={{ left: 0, width: treeWidth }}>
                            <input
                                type="checkbox"
                                className="data-table__check"
                                checked={allSelected}
                                ref={(el) => {
                                    if (el) {
                                        el.indeterminate = selectedCount > 0 && !allSelected;
                                    }
                                }}
                                onChange={() => this.toggleSelectAll(allSelected ? [] : leafIds)}
                                onPointerDown={(event) => event.stopPropagation()}
                            />
                            {grouping ? (built.hasGroupHeader ? '' : 'Группа') : ''}
                        </div>
                        {leaves.map((leaf, index) => {
                            const field = leaf.field ?? leaf.stackLeaves?.[0]?.name;
                            const sort = field ? sortState.get(field) : undefined;
                            const dragging = this.state.drag?.kind === 'col' && this.state.drag.fromRootId === leaf.rootId;
                            const over = this.state.drag?.kind === 'col' && this.state.drag.overRootId === leaf.rootId;
                            return (
                                <div
                                    key={leaf.id}
                                    className={`data-table__hcell${over ? ' is-drop' : ''}${dragging ? ' is-col-dragging' : ''}${sort ? ' is-sorted' : ''}`}
                                    style={{ left: treeWidth + paintedLefts[index], width: colWidths[index] }}
                                    onPointerDown={(event) => this.startColDrag(event, leaf, built.leaves, colWidths, treeWidth)}
                                >
                                    <span className="data-table__hlabel">{leaf.kind === 'stack' && built.hasGroupHeader ? '' : leaf.title}</span>
                                    {field && (
                                        <button
                                            type="button"
                                            className={`data-table__filter-btn${this.state.columnFilters[field] ? ' is-on' : ''}`}
                                            title="Фильтр"
                                            onPointerDown={(event) => event.stopPropagation()}
                                            onClick={(event) => this.openFilterMenu(event, field)}
                                        >
                                            ▾
                                        </button>
                                    )}
                                    {field && (
                                        <button
                                            type="button"
                                            className="data-table__sort"
                                            title="Сортировка"
                                            onPointerDown={(event) => event.stopPropagation()}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                this.handleColumnSort(field);
                                            }}
                                        >
                                            <span className={`data-table__sort-arrow${sort?.direction === 'ASC' ? ' is-active' : ''}`}>▲</span>
                                            <span className={`data-table__sort-arrow${sort?.direction === 'DESC' ? ' is-active' : ''}`}>▼</span>
                                            {sort && sort.count > 1 && <span className="data-table__sort-index">{sort.index + 1}</span>}
                                        </button>
                                    )}
                                    <span className="data-table__resize" onPointerDown={(event) => this.startResize(event, leaf, colWidths[index])} />
                                </div>
                            );
                        })}
                    </div>
                </div>
                <div className="data-table__scroll" ref={this.scrollerRef}>
                    {data.length === 0 || paintedRows.length === 0 ? (
                        <div className="data-table__empty">{data.length === 0 ? 'Нет данных' : 'Нет строк по фильтру'}</div>
                    ) : (
                        <div className="data-table__body" style={{ height: geometry.totalHeight, width: totalWidth }}>
                            {dropTop != null && <div className="data-table__drop-line" style={{ transform: `translateY(${dropTop}px)` }} />}
                            {visible.map((row, offset) => {
                                const index = range.first + offset;
                                const geo = geometry.rows[index];
                                if (!geo) {
                                    return null;
                                }
                                const dragging = Boolean(rowDrag && rowDrag.fromId === row.id);
                                const groupStyle = row.substringHit ? substringGroupStyle(rules) : {};
                                return (
                                    <div
                                        key={row.id}
                                        className={[
                                            'data-table__row',
                                            row.kind === 'group' ? 'is-group-row' : '',
                                            dragging ? 'is-dragging' : '',
                                            row.kind === 'leaf' && this.state.selectedIds.has(row.id) ? 'is-selected' : '',
                                        ]
                                            .filter(Boolean)
                                            .join(' ')}
                                        style={{
                                            height: geo.height,
                                            width: totalWidth,
                                            transform: `translateY(${geo.top}px)`,
                                            ...(row.kind === 'group' ? groupStyle : {}),
                                        }}
                                        onContextMenu={(event) => this.openContextMenu(event, row)}
                                        onClick={() => {
                                            if (row.kind === 'group' && row.groupKey) {
                                                this.handleToggleGroup(row.groupKey);
                                            }
                                        }}
                                    >
                                        <div className="data-table__cell data-table__pinned" style={{ left: 0, width: treeWidth, ...(row.kind === 'group' ? groupStyle : {}) }}>
                                            {row.kind === 'leaf' && (
                                                <input
                                                    type="checkbox"
                                                    className="data-table__check"
                                                    checked={this.state.selectedIds.has(row.id)}
                                                    onChange={() => this.toggleRowSelected(row.id)}
                                                    onClick={(event) => event.stopPropagation()}
                                                />
                                            )}
                                            {row.kind === 'leaf' && (
                                                <button
                                                    type="button"
                                                    className="data-table__row-drag"
                                                    onPointerDown={(event) => this.startRowDrag(event, row, rows, geometry)}
                                                    onClick={(event) => event.stopPropagation()}
                                                >
                                                    <RowDragIcon />
                                                </button>
                                            )}
                                            {row.kind === 'group' ? (
                                                <span className="data-table__group-cell" style={{ paddingLeft: row.depth * 16 }}>
                                                    <span className="data-table__group-marker">
                                                        {row.expanded ? <GroupMarkerDown /> : <GroupMarkerRight />}
                                                    </span>
                                                    <strong className="data-table__group-value">{formatCellValue(row.groupValue)}</strong>
                                                    <span className="data-table__group-count">{row.leafCount}</span>
                                                </span>
                                            ) : grouping ? (
                                                <span className="data-table__leaf-cell">
                                                    {cellText(row, 'name', rules).text || cellText(row, 'code', rules).text}
                                                </span>
                                            ) : null}
                                        </div>
                                        {leaves.map((leaf, leafIndex) => {
                                            if (row.kind === 'group') {
                                                return (
                                                    <div
                                                        key={leaf.id}
                                                        className="data-table__cell"
                                                        style={{
                                                            left: treeWidth + paintedLefts[leafIndex],
                                                            width: colWidths[leafIndex],
                                                            ...groupStyle,
                                                        }}
                                                    />
                                                );
                                            }
                                            if (leaf.kind === 'stack') {
                                                return (
                                                    <div
                                                        key={leaf.id}
                                                        className="data-table__cell"
                                                        style={{ left: treeWidth + paintedLefts[leafIndex], width: colWidths[leafIndex] }}
                                                    >
                                                        <div className="data-table__stack">
                                                            {(leaf.stackLeaves ?? []).map((column) => {
                                                                const painted = cellText(row, column.name, rules);
                                                                if (!painted.text) {
                                                                    return null;
                                                                }
                                                                return (
                                                                    <div key={column.name} className="data-table__stack-line" style={painted.style}>
                                                                        <span className="data-table__stack-label">{column.label ?? column.name}</span>
                                                                        <span>{painted.text}</span>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                );
                                            }
                                            const painted = cellText(row, leaf.field!, rules);
                                            const isEditing = this.state.editing?.rowId === row.id && this.state.editing.field === leaf.field;
                                            return (
                                                <div
                                                    key={leaf.id}
                                                    className={`data-table__cell${this.state.drag?.kind === 'col' && this.state.drag.fromRootId === leaf.rootId ? ' is-col-dragging' : ''}`}
                                                    style={{
                                                        left: treeWidth + paintedLefts[leafIndex],
                                                        width: colWidths[leafIndex],
                                                        ...painted.style,
                                                    }}
                                                    onContextMenu={(event) => this.openContextMenu(event, row, leaf.field)}
                                                    onDoubleClick={(event) => {
                                                        event.stopPropagation();
                                                        if (leaf.field) {
                                                            this.startEdit(row.id, leaf.field);
                                                        }
                                                    }}
                                                >
                                                    {isEditing ? (
                                                        <input
                                                            className="data-table__edit"
                                                            autoFocus
                                                            defaultValue={painted.text}
                                                            onClick={(event) => event.stopPropagation()}
                                                            onBlur={(event) => this.commitEdit(row.id, leaf.field!, event.target.value)}
                                                            onKeyDown={(event) => {
                                                                if (event.key === 'Enter') {
                                                                    this.commitEdit(row.id, leaf.field!, event.currentTarget.value);
                                                                }
                                                                if (event.key === 'Escape') {
                                                                    this.setState({ editing: null });
                                                                }
                                                            }}
                                                        />
                                                    ) : (
                                                        <span className="data-table__value">{painted.text}</span>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                );
                            })}
                            {this.extra().loadingMore && <div className="data-table__more">Загрузка…</div>}
                        </div>
                    )}
                </div>
                {this.state.filterMenu && this.renderFilterMenu()}
                {this.state.contextMenu && this.renderContextMenu(paintedRows)}
                {this.state.drag && (
                    <div className="data-table__ghost" style={{ left: this.state.drag.x + 12, top: this.state.drag.y + 12 }}>
                        {this.state.drag.label}
                    </div>
                )}
            </div>
        );
    }
}

function reorderByRootOrder(columns: GroupedColumn[], order: string[]): GroupedColumn[] {
    const currentIds = columns.map((col, index) => (Array.isArray(col) ? `group:${index}` : `col:${(col as IColumnData).name}`));
    if (currentIds.length !== order.length) {
        return columns;
    }
    const byOld = new Map(currentIds.map((id, index) => [id, columns[index]]));
    const next = order.map((id) => byOld.get(id)).filter((item): item is GroupedColumn => item != null);
    return next.length === columns.length ? next : columns;
}

function renderBands(
    leaves: LeafTrack[],
    colWidths: number[],
    paintedLefts: number[],
    treeWidth: number,
    titles: Map<string, string>,
    drag: DragState | null,
    onDragStart: (event: ReactPointerEvent<HTMLDivElement>, leaf: LeafTrack, leaves: LeafTrack[], colWidths: number[], treeWidth: number) => void,
    onResize: (event: ReactPointerEvent<HTMLSpanElement>, leaf: LeafTrack, startWidth: number) => void
): ReactNode {
    const bands: { title: string; start: number; span: number; rootId: string }[] = [];
    let index = 0;
    while (index < leaves.length) {
        const rootId = leaves[index].rootId;
        let span = 1;
        while (index + span < leaves.length && leaves[index + span].rootId === rootId) {
            span += 1;
        }
        bands.push({ title: titles.get(rootId) ?? '', start: index, span, rootId });
        index += span;
    }
    return bands.map((band) => {
        const owner = leaves[band.start];
        const width = colWidths.slice(band.start, band.start + band.span).reduce((sum, value) => sum + value, 0);
        const dragging = drag?.kind === 'col' && drag.fromRootId === band.rootId;
        const over = drag?.kind === 'col' && drag.overRootId === band.rootId;
        return (
            <div
                key={band.rootId}
                className={`data-table__hcell data-table__hband${dragging ? ' is-col-dragging' : ''}${over ? ' is-drop' : ''}`}
                style={{ left: treeWidth + paintedLefts[band.start], width }}
                onPointerDown={(event) => owner && onDragStart(event, owner, leaves, colWidths, treeWidth)}
            >
                {band.title}
                {owner && (
                    <span className="data-table__resize" onPointerDown={(event) => onResize(event, owner, width)} />
                )}
            </div>
        );
    });
}

function RowDragIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16">
            <circle cx="6" cy="4" r="1.2" fill="currentColor" />
            <circle cx="10" cy="4" r="1.2" fill="currentColor" />
            <circle cx="6" cy="8" r="1.2" fill="currentColor" />
            <circle cx="10" cy="8" r="1.2" fill="currentColor" />
            <circle cx="6" cy="12" r="1.2" fill="currentColor" />
            <circle cx="10" cy="12" r="1.2" fill="currentColor" />
        </svg>
    );
}

export type { ExtraTableProps };
