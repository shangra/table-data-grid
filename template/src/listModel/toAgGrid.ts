import type { CSSProperties } from 'react';

import { appearanceToStyle, chromeAppearanceStyle, decorationsForRow, flattenCells, formatCellValue, rowDataFromCells, ruleMatchesRow } from './pipeline';
import type {
    ConditionalCellDecoration,
    ConditionalFormattingRule,
    ICell,
    IColumnData,
    ITreeRow,
    TableCol,
} from './types';
import { isColumnGroup, isTreeRow } from './types';

export type GridColumnItem =
    | { kind: 'leaf'; column: IColumnData }
    | { kind: 'collapsed'; title: string; leaves: IColumnData[] };

export interface DisplayRow {
    id: string;
    kind: 'group' | 'leaf';
    depth: number;
    cells: ICell[];
    rowData: Record<string, unknown>;
    displayValues: Record<string, string>;
    cellStyles: Record<string, CSSProperties>;
    groupField?: string;
    groupValue?: unknown;
    groupKey?: string;
    leafCount?: number;
    expanded?: boolean;
    substringHit?: boolean;
    rowStyle?: CSSProperties;
    rowContentStyle?: CSSProperties;
}

function leavesOf(col: TableCol): IColumnData[] {
    if (!isColumnGroup(col)) {
        return [col];
    }
    return col.flatMap((child) => leavesOf(child as TableCol));
}

export function flattenGridColumns(cols: TableCol[]): GridColumnItem[] {
    const items: GridColumnItem[] = [];
    for (const col of cols) {
        if (!isColumnGroup(col)) {
            items.push({ kind: 'leaf', column: col });
            continue;
        }
        if (col.orientation === 'vertical') {
            items.push({ kind: 'collapsed', title: col.title, leaves: leavesOf(col) });
            continue;
        }
        items.push(...flattenGridColumns(col as unknown as TableCol[]));
    }
    return items;
}

export function collectGroupKeys(nodes: ITreeRow[]): string[] {
    const keys: string[] = [];
    const walk = (rows: ITreeRow[]) => {
        for (const row of rows) {
            if (row.isGroup && row.groupKey) {
                keys.push(row.groupKey);
                walk(row.children ?? []);
            }
        }
    };
    walk(nodes);
    return keys;
}

function countLeaves(node: ITreeRow): number {
    if (!node.isGroup) {
        return 1;
    }
    return (node.children ?? []).reduce((sum, child) => sum + countLeaves(child), 0);
}

function displayFromCells(
    cells: ICell[],
    rules: ConditionalFormattingRule[]
): Pick<DisplayRow, 'rowData' | 'displayValues' | 'cellStyles'> {
    const rowData = rowDataFromCells(cells);
    const decorations = decorationsForRow(rowData, rules);
    const displayValues: Record<string, string> = {};
    const cellStyles: Record<string, CSSProperties> = {};
    for (const cell of flattenCells(cells)) {
        const decoration = decorations[cell.columnName];
        const raw = cell.value.viewedData ?? cell.value.originalData;
        displayValues[cell.columnName] = String(decoration?.text ?? decoration?.formattedValue ?? formatCellValue(raw) ?? '');
        if (decoration) {
            cellStyles[cell.columnName] = decoration.style as CSSProperties;
        }
    }
    return { rowData, displayValues, cellStyles };
}

function isExpandedKey(expanded: ReadonlySet<string> | 'all', id: string): boolean {
    return expanded === 'all' || expanded.has(id);
}

function flattenTree(
    nodes: ITreeRow[],
    expanded: ReadonlySet<string> | 'all',
    depth: number,
    rules: ConditionalFormattingRule[],
    into: DisplayRow[]
): void {
    for (const node of nodes) {
        if (node.isGroup) {
            const id = node.groupKey ?? `group-${depth}-${into.length}`;
            const isExpanded = isExpandedKey(expanded, id);
            const children = node.children ?? [];
            const substringRules = rules.filter((rule) => rule.applyToSubstrings);
            const matched = collectMatchingRules(children, substringRules);
            const substringHit = matched.length > 0;
            const appearance = matched.reduce<Record<string, string>>(
                (style, rule) => ({ ...style, ...appearanceToStyle(rule.appearance) }),
                {}
            );
            const rowStyle = substringHit ? (chromeAppearanceStyle(appearance) as CSSProperties) : undefined;
            const rowContentStyle = substringHit ? (appearance as CSSProperties) : undefined;
            into.push({
                id,
                kind: 'group',
                depth,
                cells: [],
                rowData: {},
                displayValues: {},
                cellStyles: {},
                groupField: node.groupField,
                groupValue: node.groupValue,
                groupKey: node.groupKey,
                leafCount: countLeaves(node),
                expanded: isExpanded,
                substringHit,
                rowStyle,
                rowContentStyle,
            });
            if (isExpanded) {
                flattenTree(children, expanded, depth + 1, rules, into);
            }
            continue;
        }

        const cells = flattenCells(node.cells);
        into.push({
            id: node.sourceId ?? `leaf-${depth}-${into.length}`,
            kind: 'leaf',
            depth,
            cells,
            ...displayFromCells(cells, rules),
        });
    }
}

function collectMatchingRules(nodes: ITreeRow[], rules: ConditionalFormattingRule[]): ConditionalFormattingRule[] {
    const matched: ConditionalFormattingRule[] = [];
    for (const rule of rules) {
        if (treeHasRuleMatch(nodes, [rule])) {
            matched.push(rule);
        }
    }
    return matched;
}

function treeHasRuleMatch(nodes: ITreeRow[], rules: ConditionalFormattingRule[]): boolean {
    for (const node of nodes) {
        if (node.isGroup) {
            if (treeHasRuleMatch(node.children ?? [], rules)) {
                return true;
            }
        } else if (ruleMatchesRow(rowDataFromCells(node.cells), rules)) {
            return true;
        }
    }
    return false;
}

export function toDisplayRows(
    data: ICell[][] | ITreeRow[],
    expanded: ReadonlySet<string> | 'all',
    rules: ConditionalFormattingRule[]
): DisplayRow[] {
    if (data.length === 0) {
        return [];
    }
    if (isTreeRow(data[0])) {
        const rows: DisplayRow[] = [];
        flattenTree(data as ITreeRow[], expanded, 0, rules, rows);
        return rows;
    }

    return (data as ICell[][]).map((cells, index) => {
        const flat = flattenCells(cells);
        const sourceId = (cells as ICell[] & { sourceId?: string }).sourceId;
        return {
            id: sourceId ?? `row-${index}`,
            kind: 'leaf' as const,
            depth: 0,
            cells: flat,
            ...displayFromCells(flat, rules),
        };
    });
}

export function maxCellHeight(cols: TableCol[], fallback: number): number {
    const walk = (items: TableCol[]): number =>
        items.reduce((max, col) => {
            if (isColumnGroup(col)) {
                return Math.max(max, walk(col as unknown as TableCol[]));
            }
            return Math.max(max, col.cellHeight ?? 0);
        }, 0);
    return walk(cols) || fallback;
}

export type { ConditionalCellDecoration };
