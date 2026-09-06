import type { ColumnGroupNode, IDataColumn } from '../listModel/types';

interface ColumnGroupPanelProps {
    root: ColumnGroupNode;
    columns: IDataColumn[];
    onChange: (root: ColumnGroupNode) => void;
}

function nextGroupId(): string {
    return `group_${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
}

function updateChildren(root: ColumnGroupNode, children: ColumnGroupNode[]): ColumnGroupNode {
    return { ...root, children };
}

function removeField(nodes: ColumnGroupNode[], fieldId: string): ColumnGroupNode[] {
    return nodes
        .map((node) => {
            if (node.kind === 'column' && node.fieldId === fieldId) {
                return null;
            }
            if (node.children) {
                return { ...node, children: removeField(node.children, fieldId) };
            }
            return node;
        })
        .filter((node): node is ColumnGroupNode => node != null);
}

function moveFieldToGroup(root: ColumnGroupNode, groupId: string, fieldId: string, columns: IDataColumn[]): ColumnGroupNode {
    const without = removeField(root.children ?? [], fieldId);
    const columnNode: ColumnGroupNode = {
        id: `col_${fieldId}`,
        kind: 'column',
        fieldId,
        enabled: true,
        title: columns.find((column) => column.field === fieldId)?.description,
    };
    const children = without.map((node) => {
        if (node.id !== groupId) {
            return node;
        }
        return { ...node, children: [...(node.children ?? []), columnNode] };
    });
    return updateChildren(root, children);
}

export function ColumnGroupPanel({ root, columns, onChange }: ColumnGroupPanelProps) {
    const children = root.children ?? [];
    const groups = children.filter((node) => node.kind === 'group');
    const free = children.filter((node) => node.kind === 'column');

    return (
        <div className="group-panel column-group-panel">
            <div className="group-panel-row">
                <span className="group-panel-label">Группировка столбцов</span>
                <button
                    type="button"
                    className="group-add-btn"
                    onClick={() =>
                        onChange({
                            ...root,
                            children: [
                                ...children,
                                {
                                    id: nextGroupId(),
                                    kind: 'group',
                                    title: `Группа ${groups.length + 1}`,
                                    orientation: 'horizontal',
                                    enabled: true,
                                    children: [],
                                },
                            ],
                        })
                    }
                >
                    + Новая группа
                </button>
            </div>

            <div className="col-groups">
                {groups.map((group) => (
                    <div
                        key={group.id}
                        className="col-group-card"
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                            event.preventDefault();
                            const fieldId = event.dataTransfer.getData('text/column-field');
                            if (fieldId) {
                                onChange(moveFieldToGroup(root, group.id, fieldId, columns));
                            }
                        }}
                    >
                        <div className="col-group-card-head">
                            <input
                                className="col-group-name"
                                value={group.title ?? ''}
                                onChange={(event) =>
                                    onChange({
                                        ...root,
                                        children: children.map((node) =>
                                            node.id === group.id ? { ...node, title: event.target.value } : node
                                        ),
                                    })
                                }
                            />
                            <label className="col-group-toggle">
                                <input
                                    type="checkbox"
                                    checked={group.orientation === 'vertical'}
                                    onChange={(event) =>
                                        onChange({
                                            ...root,
                                            children: children.map((node) =>
                                                node.id === group.id
                                                    ? {
                                                          ...node,
                                                          orientation: event.target.checked ? 'vertical' : 'horizontal',
                                                      }
                                                    : node
                                            ),
                                        })
                                    }
                                />
                                стопка в ячейке, а не группа в шапке
                            </label>
                            <button
                                type="button"
                                className="group-add-btn"
                                onClick={() =>
                                    onChange({
                                        ...root,
                                        children: children.flatMap((node) => {
                                            if (node.id !== group.id) {
                                                return [node];
                                            }
                                            return node.children ?? [];
                                        }),
                                    })
                                }
                            >
                                Разгруппировать
                            </button>
                        </div>
                        <div className="col-group-fields">
                            {(group.children ?? []).length === 0 && (
                                <span className="group-placeholder">Перетащите сюда столбец</span>
                            )}
                            {(group.children ?? [])
                                .filter((node) => node.kind === 'column' && node.fieldId)
                                .map((node) => (
                                    <span key={node.id} className="group-chip col-field-chip">
                                        {columns.find((column) => column.field === node.fieldId)?.description ?? node.fieldId}
                                    </span>
                                ))}
                        </div>
                    </div>
                ))}
            </div>

            <div className="group-panel-row">
                <span className="group-panel-label">Столбцы вне групп</span>
                <div className="group-chips">
                    {free.length === 0 && <span className="group-placeholder">Все столбцы в группах или скрыты деревом</span>}
                    {free.map((node) => (
                        <button
                            key={node.id}
                            type="button"
                            className="group-chip col-free-chip"
                            draggable
                            onDragStart={(event) => {
                                event.dataTransfer.setData('text/column-field', node.fieldId ?? '');
                                event.dataTransfer.effectAllowed = 'move';
                            }}
                            onClick={() => {
                                const last = groups.at(-1);
                                if (last && node.fieldId) {
                                    onChange(moveFieldToGroup(root, last.id, node.fieldId, columns));
                                }
                            }}
                        >
                            {columns.find((column) => column.field === node.fieldId)?.description ?? node.fieldId}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
