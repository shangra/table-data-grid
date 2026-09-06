/** Viewport math taken from ag-grid-community `rowRenderer.workOutFirstAndLastRowsToRender` and `clientSideRowModel.getRowIndexAtPixel`. */

export const ROW_BUFFER = 10;

export interface RowGeometry {
    top: number;
    height: number;
}

export function buildRowGeometry(heights: number[]): { rows: RowGeometry[]; totalHeight: number } {
    const rows: RowGeometry[] = [];
    let top = 0;
    for (const height of heights) {
        rows.push({ top, height });
        top += height;
    }
    return { rows, totalHeight: top };
}

function isRowInPixel(row: RowGeometry, pixelToMatch: number): boolean {
    const topPixel = row.top;
    const bottomPixel = topPixel + row.height;
    return topPixel <= pixelToMatch && bottomPixel > pixelToMatch;
}

export function getRowIndexAtPixel(rows: RowGeometry[], pixelToMatch: number): number {
    const rowsToRenderLen = rows.length;
    if (rowsToRenderLen === 0) {
        return -1;
    }
    if (pixelToMatch <= 0) {
        return 0;
    }
    const lastNode = rows[rowsToRenderLen - 1];
    if (lastNode.top <= pixelToMatch) {
        if (lastNode.top + lastNode.height > pixelToMatch) {
            return rowsToRenderLen - 1;
        }
        return rowsToRenderLen - 1;
    }

    let bottomPointer = 0;
    let topPointer = rowsToRenderLen - 1;
    while (bottomPointer <= topPointer) {
        const midPointer = Math.floor((bottomPointer + topPointer) / 2);
        const current = rows[midPointer];
        if (isRowInPixel(current, pixelToMatch)) {
            return midPointer;
        }
        if (current.top < pixelToMatch) {
            bottomPointer = midPointer + 1;
        } else {
            topPointer = midPointer - 1;
        }
    }
    return Math.max(0, Math.min(rowsToRenderLen - 1, bottomPointer));
}

export function firstAndLastRowsToRender(
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
