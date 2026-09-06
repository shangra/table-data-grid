import { useCallback, useMemo, useState } from 'react';

import { ColumnGroupPanel } from '../grouping/ColumnGroupPanel';
import { GroupPanel } from '../grouping/GroupPanel';
import { SortPanel } from '../grouping/SortPanel';
import { moveRootChild, setNodeWidth } from '../grid/columnLayout';
import { DataTable } from '../grid/DataTable';
import { cycleSortRules, getActiveListView, toDataTableViewModel } from '../listModel/pipeline';
import { SAMPLE_DATA, SAMPLE_SETTINGS } from '../listModel/sample';
import { collectGroupKeys, flattenGridColumns, maxCellHeight, toDisplayRows, type DisplayRow } from '../listModel/toAgGrid';
import type { DataRow, IData, ITreeRow, ListSettings } from '../listModel/types';
import { isTreeRow } from '../listModel/types';
import './app.css';

function toNumber(value: unknown): number {
    const next = Number(value);
    return Number.isFinite(next) ? next : 0;
}

export function App() {
    const [data, setData] = useState<IData>(() => ({
        ...SAMPLE_DATA,
        rows: SAMPLE_DATA.rows.map((row) => ({ ...row })),
        cols: SAMPLE_DATA.cols.map((col) => ({ ...col })),
        refs: SAMPLE_DATA.refs,
    }));
    const [settings, setSettings] = useState<ListSettings>(() => structuredClone(SAMPLE_SETTINGS));
    const [expanded, setExpanded] = useState<Set<string> | 'all'>('all');

    const [originalOrder, setOriginalOrder] = useState<Record<number, string>>(() =>
        Object.fromEntries(SAMPLE_DATA.rows.map((row, index) => [index, String(row.id)]))
    );

    const view = useMemo(() => getActiveListView(settings), [settings]);
    const model = useMemo(
        () =>
            toDataTableViewModel(
                data,
                view,
                settings.columnGroupingRoot,
                settings.sort.fieldTypes,
                originalOrder
            ),
        [data, view, settings.columnGroupingRoot, settings.sort.fieldTypes, originalOrder]
    );

    const grouping = view.activeGroupFields.length > 0;
    const rowData = useMemo(
        () => toDisplayRows(model.data, expanded, view.activeConditionalFormattingRules),
        [model.data, expanded, view.activeConditionalFormattingRules]
    );

    const fieldOptions = useMemo(
        () => data.cols.filter((col) => col.show).map((col) => ({ field: col.field, label: col.description || col.name })),
        [data.cols]
    );

    const groupKeys = useMemo(() => {
        if (!model.data.length || !isTreeRow(model.data[0])) {
            return [];
        }
        return collectGroupKeys(model.data as ITreeRow[]);
    }, [model.data]);

    const toggleGroup = useCallback(
        (id: string) => {
            setExpanded((current) => {
                const next = new Set(current === 'all' ? groupKeys : current);
                if (next.has(id)) {
                    next.delete(id);
                } else {
                    next.add(id);
                }
                return next;
            });
        },
        [groupKeys]
    );

    const onRowClick = useCallback(
        (row: DisplayRow) => {
            if (row.kind === 'group') {
                toggleGroup(row.id);
            }
        },
        [toggleGroup]
    );

    const onCellChange = useCallback((rowId: string, field: string, value: string) => {
        setData((current) => ({
            ...current,
            rows: current.rows.map((item) => {
                if (String(item.id) !== rowId) {
                    return item;
                }
                const next: DataRow = { ...item, [field]: value };
                if (current.cols.find((col) => col.field === field)?.type === 'number') {
                    next[field] = toNumber(value);
                }
                return next;
            }),
        }));
    }, []);

    const onRowMove = useCallback((fromId: string, toId: string) => {
        setSettings((current) => ({
            ...current,
            sort: {
                ...current.sort,
                sortRules: current.sort.sortRules.map((rule) => ({ ...rule, enabled: false })),
            },
        }));
        setData((current) => {
            const rows = [...current.rows];
            const from = rows.findIndex((row) => String(row.id) === fromId);
            const to = rows.findIndex((row) => String(row.id) === toId);
            if (from < 0 || to < 0 || from === to) {
                return current;
            }
            const [moved] = rows.splice(from, 1);
            rows.splice(to, 0, moved);
            setOriginalOrder(Object.fromEntries(rows.map((row, index) => [index, String(row.id)])));
            return { ...current, rows };
        });
    }, []);

    const onColumnMove = useCallback((fromRootId: string, toRootId: string) => {
        setSettings((current) => ({
            ...current,
            columnGroupingRoot: moveRootChild(current.columnGroupingRoot, fromRootId, toRootId),
        }));
    }, []);

    const onColumnSort = useCallback((field: string) => {
        setSettings((current) => ({
            ...current,
            sort: {
                ...current.sort,
                sortRules: cycleSortRules(current.sort.sortRules, field),
            },
        }));
    }, []);

    const onColumnResize = useCallback((rootId: string, width: number) => {
        setSettings((current) => ({
            ...current,
            columnGroupingRoot: setNodeWidth(current.columnGroupingRoot, rootId, width),
        }));
    }, []);
    const stacked = flattenGridColumns(model.columns).some((item) => item.kind === 'collapsed');
    const leafHeight = Math.max(stacked ? 52 : 36, maxCellHeight(model.columns, 36));

    return (
        <div className="app-shell">
            <div className="settings-strip">
                <span className="group-panel-label">Пайплайн списка</span>
                <label className="col-group-toggle">
                    <input
                        type="checkbox"
                        checked={settings.selectionNodes.some((node) => node.enabled)}
                        onChange={(event) =>
                            setSettings((current) => ({
                                ...current,
                                selectionNodes: current.selectionNodes.map((node) => ({
                                    ...node,
                                    enabled: event.target.checked,
                                })),
                            }))
                        }
                    />
                    отбор: статус = Активен, цена 100–500
                </label>
                {settings.conditionalFormattingRules.map((rule) => (
                    <label key={rule.id} className="col-group-toggle">
                        <input
                            type="checkbox"
                            checked={rule.enabled}
                            onChange={(event) =>
                                setSettings((current) => ({
                                    ...current,
                                    conditionalFormattingRules: current.conditionalFormattingRules.map((item) =>
                                        item.id === rule.id ? { ...item, enabled: event.target.checked } : item
                                    ),
                                }))
                            }
                        />
                        УФ: {rule.presentation || rule.id}
                    </label>
                ))}
            </div>
            <SortPanel
                rules={settings.sort.sortRules}
                availableFields={settings.sort.availableFields}
                onChange={(sortRules) =>
                    setSettings((current) => ({
                        ...current,
                        sort: { ...current.sort, sortRules },
                    }))
                }
            />
            <GroupPanel
                fields={fieldOptions}
                groupBy={settings.grouping.selectedGroupFields}
                onAdd={(field) =>
                    setSettings((current) => ({
                        ...current,
                        grouping: {
                            ...current.grouping,
                            selectedGroupFields: current.grouping.selectedGroupFields.includes(field)
                                ? current.grouping.selectedGroupFields
                                : [...current.grouping.selectedGroupFields, field],
                        },
                    }))
                }
                onRemove={(field) =>
                    setSettings((current) => ({
                        ...current,
                        grouping: {
                            ...current.grouping,
                            selectedGroupFields: current.grouping.selectedGroupFields.filter((item) => item !== field),
                        },
                    }))
                }
                onMove={(from, to) =>
                    setSettings((current) => {
                        const next = [...current.grouping.selectedGroupFields];
                        const [moved] = next.splice(from, 1);
                        next.splice(to, 0, moved);
                        return { ...current, grouping: { ...current.grouping, selectedGroupFields: next } };
                    })
                }
                onExpandAll={() => setExpanded('all')}
                onCollapseAll={() => setExpanded(new Set())}
            />
            <ColumnGroupPanel
                root={settings.columnGroupingRoot}
                columns={data.cols}
                onChange={(root) => setSettings((current) => ({ ...current, columnGroupingRoot: root }))}
            />
            <div className="grid-host">
                <DataTable
                    rows={rowData}
                    columns={model.columns}
                    metaColumns={data.cols}
                    grouping={grouping}
                    leafHeight={leafHeight}
                    onRowClick={onRowClick}
                    onCellChange={onCellChange}
                    onRowMove={onRowMove}
                    onColumnMove={onColumnMove}
                    onColumnResize={onColumnResize}
                    sortRules={settings.sort.sortRules}
                    onColumnSort={onColumnSort}
                />
            </div>
        </div>
    );
}
