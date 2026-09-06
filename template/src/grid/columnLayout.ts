import type { ColumnGroupNode, IColumnData, TableCol } from '../listModel/types';
import { isColumnGroup } from '../listModel/types';

export interface HeaderBand {
    title: string;
    start: number;
    span: number;
}

export interface LeafTrack {
    id: string;
    rootId: string;
    title: string;
    width: number;
    flexGrow: boolean;
    kind: 'field' | 'stack';
    field?: string;
    stackLeaves?: IColumnData[];
    editable: boolean;
}

function groupLeaves(col: TableCol): IColumnData[] {
    if (!isColumnGroup(col)) {
        return [col];
    }
    return col.flatMap((child) => groupLeaves(child as TableCol));
}

export function buildColumnLayout(cols: TableCol[], grouping: boolean): { bands: HeaderBand[]; leaves: LeafTrack[] } {
    const bands: HeaderBand[] = [];
    const leaves: LeafTrack[] = [];

    const pushField = (column: IColumnData, rootId: string) => {
        leaves.push({
            id: column.name,
            rootId,
            title: column.label,
            width: column.cellWidth ?? 140,
            flexGrow: Boolean(column.cellFlexGrow),
            kind: 'field',
            field: column.name,
            editable: !grouping,
        });
    };

    for (let colIndex = 0; colIndex < cols.length; colIndex++) {
        const col = cols[colIndex];
        const rootId = isColumnGroup(col) ? `group:${colIndex}` : `col:${col.name}`;
        if (!isColumnGroup(col)) {
            const start = leaves.length;
            pushField(col, rootId);
            bands.push({ title: '', start, span: 1 });
            continue;
        }
        if (col.orientation === 'vertical') {
            const stacked = groupLeaves(col);
            const start = leaves.length;
            leaves.push({
                id: `stack:${col.title}`,
                rootId,
                title: col.title,
                width: stacked[0]?.cellWidth ?? 180,
                flexGrow: Boolean(stacked[0]?.cellFlexGrow),
                kind: 'stack',
                stackLeaves: stacked,
                editable: false,
            });
            bands.push({ title: col.title, start, span: 1 });
            continue;
        }
        const start = leaves.length;
        for (const child of col) {
            if (isColumnGroup(child as TableCol)) {
                groupLeaves(child as TableCol).forEach((item) => pushField(item, rootId));
            } else {
                pushField(child as IColumnData, rootId);
            }
        }
        bands.push({ title: col.title, start, span: leaves.length - start });
    }

    return { bands, leaves };
}

export function moveRootChild(root: ColumnGroupNode, fromRootId: string, toRootId: string): ColumnGroupNode {
    const children = [...(root.children ?? [])];
    const indexOf = (rootId: string) => {
        const [kind, raw] = rootId.split(':');
        if (kind === 'group') {
            return Number(raw);
        }
        return children.findIndex((node) => node.kind === 'column' && node.fieldId === raw);
    };
    const from = indexOf(fromRootId);
    const to = indexOf(toRootId);
    if (from < 0 || to < 0 || from === to) {
        return root;
    }
    const next = [...children];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return { ...root, children: next };
}

export function setNodeWidth(root: ColumnGroupNode, rootId: string, width: number): ColumnGroupNode {
    const children = [...(root.children ?? [])];
    const [kind, raw] = rootId.split(':');
    const index = kind === 'group' ? Number(raw) : children.findIndex((node) => node.fieldId === raw);
    if (index < 0 || !children[index]) {
        return root;
    }
    children[index] = { ...children[index], width, flexGrow: false };
    return { ...root, children };
}

export function moveLeavesByRoot(leaves: LeafTrack[], fromRootId: string, toRootId: string): LeafTrack[] {
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

export function prefixOffsets(widths: number[]): number[] {
    const lefts: number[] = [];
    let x = 0;
    for (const width of widths) {
        lefts.push(x);
        x += width;
    }
    return lefts;
}

export function allocateColumnWidths(leaves: LeafTrack[], available: number): number[] {
    const min = leaves.map((leaf) => leaf.width);
    const fixed = min.reduce((sum, width) => sum + width, 0);
    const flexIndexes = leaves.map((leaf, index) => (leaf.flexGrow ? index : -1)).filter((index) => index >= 0);
    if (flexIndexes.length === 0 || available <= fixed) {
        return min;
    }
    const extra = (available - fixed) / flexIndexes.length;
    return min.map((width, index) => (flexIndexes.includes(index) ? width + extra : width));
}
