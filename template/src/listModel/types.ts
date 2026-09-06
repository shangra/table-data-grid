export type DataRow = Record<string, unknown>;

export type ListFieldDataType = 'string' | 'number' | 'date' | 'boolean' | 'uuid' | 'unknown';

export interface IDataColumn {
    field: string;
    type: string;
    name: string;
    description: string;
    len: number;
    hasSorting?: boolean;
    show: boolean;
    cellWidth?: number;
    cellFlexGrow?: boolean;
    cellHeight?: number;
    cellExpandVertical?: boolean;
}

export interface IData {
    rows: DataRow[];
    cols: IDataColumn[];
    refs: Record<string, Record<string, string>>;
    count: number;
}

export interface ICell {
    columnName: string;
    value: {
        originalData: unknown;
        viewedData: unknown;
    };
    type: string;
    rowIndex: number;
    columnIndex: number;
    editable: unknown;
    hierarchy: unknown;
}

export interface IColumnData {
    name: string;
    label: string;
    order?: 'ASC' | 'DESC';
    cellWidth?: number;
    cellFlexGrow?: boolean;
    cellHeight?: number;
    cellExpandVertical?: boolean;
}

export interface IColumnGroupData extends Array<IColumnData | IColumnGroupData> {
    title: string;
    orientation?: 'horizontal' | 'vertical';
}

export type TableCol = IColumnData | IColumnGroupData;

export interface ITableState {
    rowCount: number;
    columnsCount: number;
    data: (ICell | ICell[])[][];
    cols: TableCol[];
}

export interface ITreeRow {
    cells: ICell | ICell[];
    children?: ITreeRow[];
    isGroup?: true;
    groupField?: string;
    groupValue?: unknown;
    groupKey?: string;
    sourceId?: string;
}

export type SelectionComparison =
    | 'eq'
    | 'ne'
    | 'gt'
    | 'gte'
    | 'lt'
    | 'lte'
    | 'contains'
    | 'notContains'
    | 'filled'
    | 'empty'
    | 'between';

export type SelectionGroupLogic = 'and' | 'or' | 'not';

export interface SelectionCondition {
    id: string;
    kind?: 'condition';
    field: string;
    comparison: SelectionComparison;
    value: string | [string, string];
    enabled: boolean;
    useRange?: boolean;
}

export interface SelectionGroup {
    id: string;
    kind: 'group';
    logic: SelectionGroupLogic;
    enabled: boolean;
    children: SelectionNode[];
}

export type SelectionNode = SelectionCondition | SelectionGroup;

export type SortDirection = 'ASC' | 'DESC';

export interface SortRule {
    field: string;
    direction: SortDirection;
    enabled: boolean;
}

export interface SortFieldTreeNode {
    id: string;
    label: string;
    value: string;
    isGroupLevel: boolean;
    children?: SortFieldTreeNode[];
}

export interface SortSettingsState {
    sortRules: SortRule[];
    availableFields: SortFieldTreeNode[];
    fieldTypes: Record<string, ListFieldDataType>;
}

export interface ColumnCellAppearance {
    width?: number;
    flexGrow?: boolean;
    height?: number;
    expandVertical?: boolean;
}

export interface ColumnGroupNode extends ColumnCellAppearance {
    id: string;
    kind: 'root' | 'group' | 'column';
    title?: string;
    fieldId?: string;
    orientation?: 'horizontal' | 'vertical';
    enabled?: boolean;
    children?: ColumnGroupNode[];
}

export interface ConditionalAppearance {
    backgroundColor?: string;
    textColor?: string;
    font?: {
        bold?: boolean;
        italic?: boolean;
        underline?: boolean;
        strikethrough?: boolean;
        size?: number;
        name?: string;
    };
    format?: string;
    horizontalAlign?: 'left' | 'center' | 'right' | 'justify' | 'auto';
    verticalAlign?: 'top' | 'center' | 'bottom';
    textOrientation?: 'notChanged' | 'bottomToTop' | 'topToBottom';
    mirror?: 'none' | 'horizontal' | 'vertical';
    markNegatives?: boolean;
    markIncomplete?: boolean;
    text?: string;
}

export interface ConditionalFormattingRule {
    id: string;
    enabled: boolean;
    presentation: string;
    appearance: ConditionalAppearance;
    conditionNodes: SelectionNode[];
    targetFields: string[];
    applyToSubstrings?: boolean;
}

export interface ActiveListView {
    activeSelectionNodes: SelectionNode[];
    activeGroupFields: string[];
    activeSortRules: SortRule[];
    activeConditionalFormattingRules: ConditionalFormattingRule[];
}

export interface GroupingSettingsState {
    selectedGroupFields: string[];
    disabledGroupFields: string[];
}

export interface ListSettings {
    selectionNodes: SelectionNode[];
    grouping: GroupingSettingsState;
    sort: SortSettingsState;
    columnGroupingRoot: ColumnGroupNode;
    conditionalFormattingRules: ConditionalFormattingRule[];
}

export interface ConditionalCellDecoration {
    style: Record<string, string>;
    text?: string;
    formattedValue?: string;
}

export function isColumnGroup(col: TableCol): col is IColumnGroupData {
    return Array.isArray(col);
}

export function isSelectionGroup(node: SelectionNode): node is SelectionGroup {
    return node.kind === 'group';
}

export function isTreeRow(item: unknown): item is ITreeRow {
    return typeof item === 'object' && item != null && 'cells' in item;
}

export function getActiveGroupFields(grouping: GroupingSettingsState): string[] {
    return grouping.selectedGroupFields.filter((field) => !grouping.disabledGroupFields.includes(field));
}
