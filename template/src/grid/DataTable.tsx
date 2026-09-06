import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';

import type { DisplayRow } from '../listModel/toAgGrid';
import type { IColumnData, IDataColumn, SortRule, TableCol } from '../listModel/types';
import { allocateColumnWidths, buildColumnLayout, moveLeavesByRoot, prefixOffsets, type LeafTrack } from './columnLayout';
import { buildRowGeometry, firstAndLastRowsToRender, getRowIndexAtPixel } from './rowViewport';
import './dataTable.css';

const TREE_WIDTH = 280;
const DRAG_START_PIXELS = 4;

interface DataTableProps {
    rows: DisplayRow[];
    columns: TableCol[];
    metaColumns: IDataColumn[];
    grouping: boolean;
    leafHeight: number;
    onRowClick: (row: DisplayRow) => void;
    onCellChange: (rowId: string, field: string, value: string) => void;
    onRowMove: (fromId: string, toId: string) => void;
    onColumnMove: (fromRootId: string, toRootId: string) => void;
    onColumnResize: (rootId: string, width: number) => void;
    sortRules?: SortRule[];
    onColumnSort?: (field: string) => void;
}

type DragState =
    | { kind: 'row'; fromId: string; overId: string; x: number; y: number; label: string }
    | { kind: 'col'; fromRootId: string; overRootId: string; x: number; y: number; label: string };

export function DataTable({
    rows,
    columns,
    metaColumns,
    grouping,
    leafHeight,
    onRowClick,
    onCellChange,
    onRowMove,
    onColumnMove,
    onColumnResize,
    sortRules = [],
    onColumnSort,
}: DataTableProps) {
    const scrollerRef = useRef<HTMLDivElement>(null);
    const headerRef = useRef<HTMLDivElement>(null);
    const [scrolling, setScrolling] = useState(false);
    const [scrollTop, setScrollTop] = useState(0);
    const [viewportHeight, setViewportHeight] = useState(400);
    const [viewportWidth, setViewportWidth] = useState(800);
    const [editing, setEditing] = useState<{ rowId: string; field: string } | null>(null);
    const [drag, setDrag] = useState<DragState | null>(null);
    const [afterCreated, setAfterCreated] = useState(false);

    const layout = useMemo(() => buildColumnLayout(columns, grouping), [columns, grouping]);
    const hasGroupHeader = layout.bands.some((band) => band.title);
    const bodyWidth = Math.max(0, viewportWidth - TREE_WIDTH);
    const colWidths = useMemo(
        () => allocateColumnWidths(layout.leaves, bodyWidth),
        [layout.leaves, bodyWidth]
    );
    const totalWidth = TREE_WIDTH + colWidths.reduce((sum, width) => sum + width, 0);
    const paintedLeaves = useMemo(() => {
        if (drag?.kind !== 'col') {
            return layout.leaves;
        }
        return moveLeavesByRoot(layout.leaves, drag.fromRootId, drag.overRootId);
    }, [layout.leaves, drag]);
    const widthById = useMemo(() => {
        const map = new Map<string, number>();
        layout.leaves.forEach((leaf, index) => map.set(leaf.id, colWidths[index] ?? leaf.width));
        return map;
    }, [layout.leaves, colWidths]);
    const paintedWidths = paintedLeaves.map((leaf) => widthById.get(leaf.id) ?? leaf.width);
    const paintedLefts = prefixOffsets(paintedWidths);
    const bandTitleByRoot = useMemo(() => {
        const map = new Map<string, string>();
        for (const band of layout.bands) {
            const owner = layout.leaves[band.start];
            if (owner) {
                map.set(owner.rootId, band.title);
            }
        }
        return map;
    }, [layout.bands, layout.leaves]);
    const paintedBands = useMemo(() => {
        const bands: { title: string; start: number; span: number; rootId: string }[] = [];
        let index = 0;
        while (index < paintedLeaves.length) {
            const rootId = paintedLeaves[index].rootId;
            let span = 1;
            while (index + span < paintedLeaves.length && paintedLeaves[index + span].rootId === rootId) {
                span += 1;
            }
            bands.push({ title: bandTitleByRoot.get(rootId) ?? '', start: index, span, rootId });
            index += span;
        }
        return bands;
    }, [paintedLeaves, bandTitleByRoot]);

    const paintedRows = useMemo(() => {
        if (drag?.kind !== 'row') {
            return rows;
        }
        return moveRow(rows, drag.fromId, drag.overId);
    }, [rows, drag]);

    const heights = useMemo(
        () => paintedRows.map((row) => (row.kind === 'group' ? 42 : leafHeight)),
        [paintedRows, leafHeight]
    );
    const geometry = useMemo(() => buildRowGeometry(heights), [heights]);
    const range = firstAndLastRowsToRender(geometry.rows, scrollTop, viewportHeight, leafHeight);
    const visible = paintedRows.slice(Math.max(0, range.first), range.last + 1);

    useEffect(() => {
        const timer = window.setTimeout(() => setAfterCreated(true), 1000);
        return () => window.clearTimeout(timer);
    }, []);

    useEffect(() => {
        const el = scrollerRef.current;
        if (!el) {
            return;
        }
        let frame = 0;
        let scrollTimer = 0;
        const onScroll = () => {
            setScrolling(true);
            window.clearTimeout(scrollTimer);
            scrollTimer = window.setTimeout(() => setScrolling(false), 120);
            if (frame) {
                return;
            }
            frame = window.requestAnimationFrame(() => {
                frame = 0;
                setScrollTop(el.scrollTop);
                if (headerRef.current) {
                    headerRef.current.scrollLeft = el.scrollLeft;
                }
            });
        };
        const ro = new ResizeObserver(() => {
            setViewportHeight(el.clientHeight);
            setViewportWidth(el.clientWidth);
        });
        el.addEventListener('scroll', onScroll, { passive: true });
        ro.observe(el);
        setViewportHeight(el.clientHeight);
        setViewportWidth(el.clientWidth);
        return () => {
            el.removeEventListener('scroll', onScroll);
            ro.disconnect();
            window.clearTimeout(scrollTimer);
            if (frame) {
                window.cancelAnimationFrame(frame);
            }
        };
    }, []);

    const commitEdit = useCallback(
        (rowId: string, field: string, value: string) => {
            onCellChange(rowId, field, value);
            setEditing(null);
        },
        [onCellChange]
    );

    const rowAtClientY = useCallback(
        (clientY: number) => {
            const scroller = scrollerRef.current;
            if (!scroller || rows.length === 0) {
                return null;
            }
            const rect = scroller.getBoundingClientRect();
            const pixel = scroller.scrollTop + clientY - rect.top;
            const index = getRowIndexAtPixel(geometry.rows, pixel);
            return rows[index] ?? null;
        },
        [geometry.rows, rows]
    );

    const autoScroll = useCallback((clientY: number) => {
        const scroller = scrollerRef.current;
        if (!scroller) {
            return;
        }
        const rect = scroller.getBoundingClientRect();
        if (clientY < rect.top + 28) {
            scroller.scrollTop -= 16;
        } else if (clientY > rect.bottom - 28) {
            scroller.scrollTop += 16;
        }
    }, []);

    const startRowDrag = (event: ReactPointerEvent, row: DisplayRow) => {
        if (row.kind !== 'leaf') {
            return;
        }
        event.stopPropagation();
        const handle = event.currentTarget;
        handle.setPointerCapture(event.pointerId);
        const origin = { x: event.clientX, y: event.clientY };
        let started = false;
        const label = row.displayValues.name || row.displayValues.code || row.id;

        const onMove = (move: PointerEvent) => {
            const dist = Math.hypot(move.clientX - origin.x, move.clientY - origin.y);
            if (!started && dist < DRAG_START_PIXELS) {
                return;
            }
            started = true;
            autoScroll(move.clientY);
            const over = rowAtClientY(move.clientY);
            setDrag({
                kind: 'row',
                fromId: row.id,
                overId: over?.id ?? row.id,
                x: move.clientX,
                y: move.clientY,
                label,
            });
        };
        const onUp = (up: PointerEvent) => {
            handle.releasePointerCapture(up.pointerId);
            handle.removeEventListener('pointermove', onMove);
            handle.removeEventListener('pointerup', onUp);
            const over = rowAtClientY(up.clientY);
            const targetId = over ? leafIdForTarget(rows, over.id, row.id) : null;
            setDrag(null);
            if (started && targetId && targetId !== row.id) {
                onRowMove(row.id, targetId);
            }
        };
        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onUp);
    };

    const startColDrag = (event: ReactPointerEvent, leaf: LeafTrack) => {
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
            const over = leafAtClientX(move.clientX);
            setDrag({
                kind: 'col',
                fromRootId: leaf.rootId,
                overRootId: over?.rootId ?? leaf.rootId,
                x: move.clientX,
                y: move.clientY,
                label: leaf.title,
            });
        };
        const onUp = (up: PointerEvent) => {
            handle.releasePointerCapture(up.pointerId);
            handle.removeEventListener('pointermove', onMove);
            handle.removeEventListener('pointerup', onUp);
            const over = leafAtClientX(up.clientX);
            setDrag(null);
            if (started && over && over.rootId !== leaf.rootId) {
                onColumnMove(leaf.rootId, over.rootId);
            }
        };
        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onUp);
    };

    const leafAtClientX = (clientX: number) => {
        const scroller = scrollerRef.current;
        if (!scroller) {
            return null;
        }
        const x = clientX - scroller.getBoundingClientRect().left + scroller.scrollLeft - TREE_WIDTH;
        let cursor = 0;
        for (let i = 0; i < layout.leaves.length; i++) {
            const width = colWidths[i] ?? layout.leaves[i].width;
            if (x < cursor + width) {
                return layout.leaves[i];
            }
            cursor += width;
        }
        return layout.leaves.at(-1) ?? null;
    };

    const startResize = (event: ReactPointerEvent, leaf: LeafTrack, index: number) => {
        event.preventDefault();
        event.stopPropagation();
        const startX = event.clientX;
        const startWidth = colWidths[index];
        const onMove = (move: PointerEvent) => {
            onColumnResize(leaf.rootId, Math.max(60, startWidth + move.clientX - startX));
        };
        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    };

    const sortableFields = useMemo(() => {
        const map = new Map<string, boolean>();
        for (const column of metaColumns) {
            map.set(column.field, column.hasSorting !== false);
        }
        return map;
    }, [metaColumns]);

    const sortState = useMemo(() => {
        const map = new Map<string, { direction: 'ASC' | 'DESC'; index: number; count: number }>();
        const enabled = sortRules.filter((rule) => rule.enabled);
        enabled.forEach((rule, index) => {
            map.set(rule.field, { direction: rule.direction, index, count: enabled.length });
        });
        return map;
    }, [sortRules]);

    const dropTop =
        drag?.kind === 'row'
            ? geometry.rows[paintedRows.findIndex((row) => row.id === drag.overId)]?.top
            : undefined;

    return (
        <div className={`dt dt-row-animation${afterCreated ? ' dt-after-created' : ''}${scrolling && !drag ? ' dt-prevent-animation' : ''}${drag?.kind === 'col' ? ' dt-column-moving' : ''}`}>
            <div className="dt-header" ref={headerRef}>
                <div className="dt-header-row" style={{ width: totalWidth, height: 36 }}>
                    <div className="dt-hcell dt-pinned" style={{ left: 0, width: TREE_WIDTH }}>
                        {grouping ? 'Группа' : 'Наименование'}
                    </div>
                    {hasGroupHeader
                        ? paintedBands.map((band) => {
                              const owner = paintedLeaves[band.start];
                              const width = paintedWidths.slice(band.start, band.start + band.span).reduce((sum, value) => sum + value, 0);
                              return (
                                  <div
                                      key={band.rootId}
                                      className={`dt-hcell dt-hband${drag?.kind === 'col' && drag.fromRootId === band.rootId ? ' is-col-dragging' : ''}${drag?.kind === 'col' && drag.overRootId === band.rootId ? ' is-drop' : ''}`}
                                      style={{ left: TREE_WIDTH + paintedLefts[band.start], width }}
                                      onPointerDown={(event) => owner && startColDrag(event, owner)}
                                  >
                                      {band.title}
                                      {owner && (
                                          <span
                                              className="dt-resize"
                                              onPointerDown={(event) => {
                                                  const originalIndex = layout.leaves.findIndex((item) => item.id === owner.id);
                                                  startResize(event, owner, originalIndex);
                                              }}
                                          />
                                      )}
                                  </div>
                              );
                          })
                        : paintedLeaves.map((leaf, index) => (
                              <HeaderCell
                                  key={leaf.id}
                                  leaf={leaf}
                                  left={TREE_WIDTH + paintedLefts[index]}
                                  width={paintedWidths[index]}
                                  dragging={drag?.kind === 'col' && drag.fromRootId === leaf.rootId}
                                  over={drag?.kind === 'col' && drag.overRootId === leaf.rootId}
                                  onDragStart={startColDrag}
                                  onResize={startResize}
                                  index={layout.leaves.findIndex((item) => item.id === leaf.id)}
                                  sort={sortForLeaf(leaf, sortState, sortableFields)}
                                  onSort={onColumnSort}
                              />
                          ))}
                </div>
                {hasGroupHeader && (
                    <div className="dt-header-row" style={{ width: totalWidth, height: 36 }}>
                        <div className="dt-hcell dt-pinned" style={{ left: 0, width: TREE_WIDTH }} />
                        {paintedLeaves.map((leaf, index) => (
                            <HeaderCell
                                key={leaf.id}
                                leaf={leaf}
                                left={TREE_WIDTH + paintedLefts[index]}
                                width={paintedWidths[index]}
                                dragging={drag?.kind === 'col' && drag.fromRootId === leaf.rootId}
                                over={drag?.kind === 'col' && drag.overRootId === leaf.rootId}
                                onDragStart={startColDrag}
                                onResize={startResize}
                                index={layout.leaves.findIndex((item) => item.id === leaf.id)}
                                title={leaf.kind === 'stack' ? '' : leaf.title}
                                sort={sortForLeaf(leaf, sortState, sortableFields)}
                                onSort={onColumnSort}
                            />
                        ))}
                    </div>
                )}
            </div>
            <div className="dt-scroll" ref={scrollerRef}>
                <div className="dt-body" style={{ height: geometry.totalHeight, width: totalWidth }}>
                    {dropTop != null && <div className="dt-drop-line" style={{ transform: `translateY(${dropTop}px)` }} />}
                    {visible.map((row, offset) => {
                        const index = range.first + offset;
                        const geo = geometry.rows[index];
                        if (!geo) {
                            return null;
                        }
                        const dragging = drag?.kind === 'row' && drag.fromId === row.id;
                        return (
                            <div
                                key={row.id}
                                className={[
                                    'dt-row',
                                    row.kind === 'group' ? 'is-group-row' : '',
                                    row.substringHit ? 'is-cf-substring' : '',
                                    dragging ? 'is-dragging' : '',
                                ]
                                    .filter(Boolean)
                                    .join(' ')}
                                style={{
                                    height: geo.height,
                                    width: totalWidth,
                                    transform: `translateY(${geo.top}px)`,
                                    ...(row.rowStyle ?? {}),
                                }}
                                onClick={() => onRowClick(row)}
                            >
                                <div className="dt-cell dt-pinned" style={{ left: 0, width: TREE_WIDTH, ...(row.rowStyle ?? {}) }}>
                                    {row.kind === 'leaf' && (
                                        <button
                                            type="button"
                                            className="dt-row-drag"
                                            aria-hidden
                                            onPointerDown={(event) => startRowDrag(event, row)}
                                            onClick={(event) => event.stopPropagation()}
                                        >
                                            <RowDragIcon />
                                        </button>
                                    )}
                                    <TreeCell row={row} metaColumns={metaColumns} />
                                </div>
                                {paintedLeaves.map((leaf, leafIndex) => (
                                    <div
                                        key={leaf.id}
                                        className={`dt-cell${drag?.kind === 'col' && drag.fromRootId === leaf.rootId ? ' is-col-dragging' : ''}`}
                                        style={{
                                            left: TREE_WIDTH + paintedLefts[leafIndex],
                                            width: paintedWidths[leafIndex],
                                            ...(row.kind === 'group' ? row.rowStyle : undefined),
                                            ...(leaf.kind === 'field' ? row.cellStyles[leaf.field!] : undefined),
                                        }}
                                    >
                                        {leaf.kind === 'stack' ? (
                                            <StackedCell row={row} leaves={leaf.stackLeaves ?? []} />
                                        ) : editing?.rowId === row.id && editing.field === leaf.field && row.kind === 'leaf' ? (
                                            <input
                                                className="dt-input"
                                                autoFocus
                                                defaultValue={row.displayValues[leaf.field!] ?? ''}
                                                onClick={(event) => event.stopPropagation()}
                                                onBlur={(event) => commitEdit(row.id, leaf.field!, event.target.value)}
                                                onKeyDown={(event) => {
                                                    if (event.key === 'Enter') {
                                                        commitEdit(row.id, leaf.field!, event.currentTarget.value);
                                                    }
                                                    if (event.key === 'Escape') {
                                                        setEditing(null);
                                                    }
                                                }}
                                            />
                                        ) : (
                                            <span
                                                className="dt-value"
                                                onDoubleClick={(event) => {
                                                    if (leaf.editable && row.kind === 'leaf' && leaf.field) {
                                                        event.stopPropagation();
                                                        setEditing({ rowId: row.id, field: leaf.field });
                                                    }
                                                }}
                                            >
                                                {row.displayValues[leaf.field!] ?? ''}
                                            </span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        );
                    })}
                </div>
            </div>
            {drag && (
                <div className="dt-ghost" style={{ left: drag.x + 12, top: drag.y + 12 }}>
                    {drag.label}
                </div>
            )}
        </div>
    );
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

function sortFieldOf(leaf: LeafTrack): string | undefined {
    if (leaf.kind === 'field') {
        return leaf.field;
    }
    return leaf.stackLeaves?.[0]?.name;
}

function sortForLeaf(
    leaf: LeafTrack,
    sortState: Map<string, { direction: 'ASC' | 'DESC'; index: number; count: number }>,
    sortableFields: Map<string, boolean>
): { field: string; direction?: 'ASC' | 'DESC'; index?: number; count?: number } | undefined {
    const field = sortFieldOf(leaf);
    if (!field || sortableFields.get(field) === false) {
        return undefined;
    }
    const state = sortState.get(field);
    return { field, direction: state?.direction, index: state?.index, count: state?.count };
}

function HeaderCell({
    leaf,
    index,
    left,
    width,
    over,
    dragging,
    title,
    onDragStart,
    onResize,
    sort,
    onSort,
}: {
    leaf: LeafTrack;
    index: number;
    left: number;
    width: number;
    over: boolean;
    dragging: boolean;
    title?: string;
    onDragStart: (event: ReactPointerEvent, leaf: LeafTrack) => void;
    onResize: (event: ReactPointerEvent, leaf: LeafTrack, index: number) => void;
    sort?: { field: string; direction?: 'ASC' | 'DESC'; index?: number; count?: number };
    onSort?: (field: string) => void;
}) {
    return (
        <div
            className={`dt-hcell${over ? ' is-drop' : ''}${dragging ? ' is-col-dragging' : ''}${sort?.direction ? ' is-sorted' : ''}`}
            style={{ left, width }}
            onPointerDown={(event) => onDragStart(event, leaf)}
        >
            <span className="dt-hlabel">{title ?? leaf.title}</span>
            {sort && onSort && (
                <button
                    type="button"
                    className="dt-sort"
                    title={
                        sort.direction === 'ASC'
                            ? 'Сортировка: по возрастанию'
                            : sort.direction === 'DESC'
                              ? 'Сортировка: по убыванию'
                              : 'Сортировать'
                    }
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                        event.stopPropagation();
                        onSort(sort.field);
                    }}
                >
                    <span className={`dt-sort-arrow${sort.direction === 'ASC' ? ' is-active' : ''}`} aria-hidden>
                        ▲
                    </span>
                    <span className={`dt-sort-arrow${sort.direction === 'DESC' ? ' is-active' : ''}`} aria-hidden>
                        ▼
                    </span>
                    {sort.direction && sort.count != null && sort.count > 1 && sort.index != null && (
                        <span className="dt-sort-index">{sort.index + 1}</span>
                    )}
                </button>
            )}
            <span className="dt-resize" onPointerDown={(event) => onResize(event, leaf, index)} />
        </div>
    );
}

function RowDragIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" className="dt-row-drag-icon">
            <circle cx="6" cy="4" r="1.2" fill="currentColor" />
            <circle cx="10" cy="4" r="1.2" fill="currentColor" />
            <circle cx="6" cy="8" r="1.2" fill="currentColor" />
            <circle cx="10" cy="8" r="1.2" fill="currentColor" />
            <circle cx="6" cy="12" r="1.2" fill="currentColor" />
            <circle cx="10" cy="12" r="1.2" fill="currentColor" />
        </svg>
    );
}

function TreeCell({ row, metaColumns }: { row: DisplayRow; metaColumns: IDataColumn[] }) {
    if (row.kind === 'group') {
        const label = metaColumns.find((column) => column.field === row.groupField)?.description ?? row.groupField;
        return (
            <span
                className={`group-cell${row.substringHit ? ' is-substring-hit' : ''}`}
                style={{ paddingLeft: row.depth * 18, ...(row.rowContentStyle ?? {}) }}
            >
                <span className="group-chevron" aria-hidden>
                    {row.expanded ? '▼' : '▶'}
                </span>
                <span className="group-field">{label}</span>
                <strong className="group-key">{String(row.groupValue ?? '')}</strong>
                <span className="group-count">{row.leafCount}</span>
            </span>
        );
    }
    return (
        <span className="leaf-cell" style={{ paddingLeft: 4 }}>
            {row.displayValues.name || row.displayValues.code || ''}
        </span>
    );
}

function StackedCell({ row, leaves }: { row: DisplayRow; leaves: IColumnData[] }) {
    if (row.kind === 'group') {
        return null;
    }
    return (
        <div className="stack-cell">
            {leaves.map((column) => {
                const text = row.displayValues[column.name];
                if (!text) {
                    return null;
                }
                return (
                    <div key={column.name} className="stack-line" style={row.cellStyles[column.name]}>
                        <span className="stack-label">{column.label}</span>
                        <span>{text}</span>
                    </div>
                );
            })}
        </div>
    );
}
