interface FieldOption {
    field: string;
    label: string;
}

interface GroupPanelProps {
    fields: FieldOption[];
    groupBy: string[];
    onAdd: (field: string) => void;
    onRemove: (field: string) => void;
    onMove: (from: number, to: number) => void;
    onExpandAll: () => void;
    onCollapseAll: () => void;
}

export function GroupPanel({ fields, groupBy, onAdd, onRemove, onMove, onExpandAll, onCollapseAll }: GroupPanelProps) {
    const unused = fields.filter((item) => !groupBy.includes(item.field));

    return (
        <div className="group-panel">
            <div className="group-panel-row">
                <span className="group-panel-label">Группировка строк</span>
                <div className="group-chips">
                    {groupBy.length === 0 && (
                        <span className="group-placeholder">Нажмите поле справа, чтобы сгруппировать строки</span>
                    )}
                    {groupBy.map((field, index) => {
                        const label = fields.find((item) => item.field === field)?.label ?? field;
                        return (
                            <div key={field} className="group-chip-wrap">
                                {index > 0 && <span className="group-arrow">→</span>}
                                <button
                                    type="button"
                                    className="group-chip"
                                    draggable
                                    onDragStart={(event) => {
                                        event.dataTransfer.setData('text/plain', String(index));
                                        event.dataTransfer.effectAllowed = 'move';
                                    }}
                                    onDragOver={(event) => event.preventDefault()}
                                    onDrop={(event) => {
                                        event.preventDefault();
                                        const from = Number(event.dataTransfer.getData('text/plain'));
                                        if (!Number.isNaN(from) && from !== index) {
                                            onMove(from, index);
                                        }
                                    }}
                                >
                                    {label}
                                    <span
                                        className="group-chip-remove"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            onRemove(field);
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
                        <button key={item.field} type="button" className="group-add-btn" onClick={() => onAdd(item.field)}>
                            + {item.label}
                        </button>
                    ))}
                </div>
            </div>
            <div className="group-panel-row group-panel-tools">
                <button type="button" onClick={onExpandAll} disabled={groupBy.length === 0}>
                    Раскрыть всё
                </button>
                <button type="button" onClick={onCollapseAll} disabled={groupBy.length === 0}>
                    Свернуть всё
                </button>
            </div>
        </div>
    );
}
