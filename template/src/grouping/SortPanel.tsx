import type { SortDirection, SortFieldTreeNode, SortRule } from '../listModel/types';

interface SortPanelProps {
    rules: SortRule[];
    availableFields: SortFieldTreeNode[];
    onChange: (rules: SortRule[]) => void;
}

function flattenFields(nodes: SortFieldTreeNode[]): SortFieldTreeNode[] {
    return nodes.flatMap((node) => [node, ...(node.children ? flattenFields(node.children) : [])]);
}

export function SortPanel({ rules, availableFields, onChange }: SortPanelProps) {
    const fields = flattenFields(availableFields);
    const used = new Set(rules.map((rule) => rule.field));
    const unused = fields.filter((item) => !item.isGroupLevel && !used.has(item.value));

    return (
        <div className="group-panel">
            <div className="group-panel-row">
                <span className="group-panel-label">Сортировка</span>
                <div className="group-chips">
                    {rules.length === 0 && (
                        <span className="group-placeholder">Нет правил — исходный порядок строк</span>
                    )}
                    {rules.map((rule, index) => {
                        const label = fields.find((item) => item.value === rule.field)?.label ?? rule.field;
                        return (
                            <div key={`${rule.field}-${index}`} className="group-chip-wrap">
                                {index > 0 && <span className="group-arrow">→</span>}
                                <button
                                    type="button"
                                    className={`group-chip${rule.enabled ? '' : ' is-disabled'}`}
                                    draggable
                                    title="Клик — направление, перетаскивание — приоритет"
                                    onDragStart={(event) => {
                                        event.dataTransfer.setData('text/plain', String(index));
                                        event.dataTransfer.effectAllowed = 'move';
                                    }}
                                    onDragOver={(event) => event.preventDefault()}
                                    onDrop={(event) => {
                                        event.preventDefault();
                                        const from = Number(event.dataTransfer.getData('text/plain'));
                                        if (Number.isNaN(from) || from === index) {
                                            return;
                                        }
                                        const next = [...rules];
                                        const [moved] = next.splice(from, 1);
                                        next.splice(index, 0, moved);
                                        onChange(next);
                                    }}
                                    onClick={() => {
                                        const nextDirection: SortDirection = rule.direction === 'ASC' ? 'DESC' : 'ASC';
                                        onChange(
                                            rules.map((item, itemIndex) =>
                                                itemIndex === index ? { ...item, direction: nextDirection } : item
                                            )
                                        );
                                    }}
                                >
                                    {label}
                                    <span className="sort-dir">{rule.direction === 'ASC' ? '↑ ASC' : '↓ DESC'}</span>
                                    <span
                                        className="group-chip-remove"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            onChange(rules.filter((_, itemIndex) => itemIndex !== index));
                                        }}
                                    >
                                        ×
                                    </span>
                                </button>
                            </div>
                        );
                    })}
                </div>
                <div className="group-add">
                    {unused.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            className="group-add-btn"
                            onClick={() =>
                                onChange([...rules, { field: item.value, direction: 'ASC', enabled: true }])
                            }
                        >
                            + {item.label}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
