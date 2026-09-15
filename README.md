# DataTable — перенос в реальный проект

## Что скопировать

Из этой папки в MDM **только два рабочих файла** (+ этот редми по желанию):

| Файл здесь | Куда в реальном проекте |
| --- | --- |
| `DataTable.tsx` | `src/components/MetadataForms/ElementsList/ReactWindowWrapperCombined/DataTable/DataTable.tsx` |
| `DataTable.css` | рядом, тот же каталог: `DataTable.css` |

**Не переносить** из репозитория `table-data-grid`:

- `template/` — это React-демо, не хост списка
- импорты не менять: иконки `./Icons/…`, `../../groupTableRows`, `../../types`, `../types`, `helpers/listSettings` должны остаться **как в MDM**

После копирования импорты в шапке `DataTable.tsx` должны совпасть с тем, что уже было в проекте (пути к `listSettings` и `conditionalFormatting/apply`). Если CSS в MDM подключается как модуль — оставьте `import './DataTable.css'` или ваш текущий способ, но **содержимое** файла замените целиком.

Вызов в `renderListTable` **не обязателен менять** для базового рендера:

```tsx
<DataTable data={…} columns={table.cols as any} />
```

Новые возможности включаются **дополнительными пропсами** и `ref` (см. ниже). Старый контракт `data` + `columns` сохранён.

---

## Что перенести из последних правок

Полностью замените оба файла, не мержьте кусками: в правках завязаны шапка, скролл, фильтры и меню.

1. **Ячейки в сгруппированных подстроках**  
   Лист дерева — `{ cells }` без `isGroup`. `getLeafCells` читает `normalizeCells(item.cells)`, иначе под строкой группы пустые ячейки.

2. **TypeScript под ваш `apply.ts`**  
   - `groupField` только если это `string`  
   - `overId` после сужения `kind === 'row'`  
   - `resolveSubstringAppearance` вызывается с **двумя** аргументами  

3. **Выделение и действия**  
   Чекбоксы, панель «Выбрано», копировать / удалить / снять.

4. **Меню фильтра колонки** (▾)  
   Локально по уже загруженным строкам. Не заменяет фасет «Отбор».

5. **Бесконечный скролл**  
   `onLoadMore` / `hasMore` / `loadingMore`.

6. **`scrollToCell` / `scrollToRow`**  
   Через `ref` на класс. Автоскролл при drag строки — без пропсов.

7. **Контекстное меню** (ПКМ): изменить, копировать, удалить. Двойной клик по ячейке — инлайн-правка.

8. **CSS**  
   Новые классы: `__toolbar`, `__check`, `__filter-btn`, `__menu`, `__edit`, `__more`, `__row.is-selected`. Старый файл стилей без них ломает вёрстку.

Иконки `groupMarkerDown` / `groupMarkerRight` **не копировать** — они уже лежат в `DataTable/Icons/` у вас.

---

## Как прикрутить в хосте (MDM)

`DataTable` — class component:

```tsx
private tableRef = createRef<DataTable>();

<DataTable
    ref={this.tableRef}
    data={view.data}
    columns={table.cols as any}
    hasMore={this.state.hasMore}
    loadingMore={this.state.loadingMore}
    onSelectionChange={(ids) => this.setState({ selectedIds: ids })}
    onCellChange={(id, field, value) => this.patchRow(id, field, value)}
    onDeleteRows={(ids) => this.deleteRows(ids)}
    onCopyRows={(ids) => this.logCopy(ids)}
    onEditRow={(id, field) => this.onStartEdit(id, field)}
    onColumnFilterChange={(filters) => this.onTableFilters(filters)}
    onLoadMore={() => this.fetchNextPage()}
    onSort={({ column, direction }) => this.setQuerySort(column, direction)}
    onRowMove={(fromId, toId) => this.reorderRows(fromId, toId)}
    onColumnMove={(from, to) => this.reorderColumns(from, to)}
    onColumnResize={(name, width) => this.saveColumnWidth(name, width)}
/>

this.tableRef.current?.scrollToRow(id);
this.tableRef.current?.scrollToCell(id, 'name');
```

Тип колбэков: `ExtraTableProps` из `DataTable.tsx`. Все поля **необязательные**.

Пайплайн списка не трогать: отбор, группировка, группировка колонок, СФ по-прежнему **до** таблицы / СФ из стора в `render`.

---

## API колбэков

### Выделение

| Проп | Когда | Хост |
| --- | --- | --- |
| `onSelectionChange(ids: string[])` | Чекбоксы | Сохранить id листьев |

### Фильтр колонки (▾)

Локально строки уже фильтруются. Чтобы ушло в запрос:

| Проп | Когда |
| --- | --- |
| `onColumnFilterChange(filters)` | Смена / сброс фильтра |

```ts
{ [field: string]: { comparison: 'contains' | 'eq' | 'empty' | 'filled'; value: string } }
```

### Правка, удаление, копирование

| Проп | Когда | Хост |
| --- | --- | --- |
| `onEditRow(rowId, field?)` | Старт правки | Опционально |
| `onCellChange(rowId, field, value)` | Enter / blur | `PATCH`, затем новый `data` |
| `onDeleteRows(ids)` | Панель или меню | API удаления + убрать из `data` |
| `onCopyRows(ids)` | Копировать | Свой буфер; иначе таблица пишет TSV в clipboard |

Без `onDeleteRows` строки с экрана сами не исчезнут.

### Бесконечный скролл

~96px до низа → `onLoadMore`, если не `hasMore === false` и не `loadingMore`.

Догруженные строки **добавляйте** в уже прогнанный через адаптер `data`.

### Скролл

- Drag к краю — автоскролл всегда  
- `scrollToRow(id)` / `scrollToCell(id, field?)` — `field` = `column.name`; группы раскрываются

### Сортировка и колонки

| Проп | Событие |
| --- | --- |
| `onSort({ column, direction })` | Стрелки; `null` = сброс |
| `onSortRulesChange(rules)` | Весь фасет `sort` |
| `onColumnMove` / `onColumnResize` / `onRowMove` | DnD и ресайз |

Если в MDM есть `getSortSettingsState` / `replaceSortSettingsState`, сортировка ещё пишется в стор.

---

## Что не передавать в таблицу

- Правила СФ — из `getConditionalFormattingSettingsState` в `render`  
- Отбор, группировка строк, дерево колонок — как сейчас, **до** `<DataTable />`
