# DataTable — как прикрутить API

Скопируйте в проект `DataTable.tsx` и `DataTable.css`. Компонент по-прежнему принимает те же пропсы, что и раньше: `data` и `columns` (`IReactWindowWrapperCombined`). Всё ниже — **необязательные** поля: без них таблица рендерится, но действия не уходят на бэкенд.

Типы колбэков: `ExtraTableProps` (экспорт из `DataTable.tsx`).

```tsx
import { createRef } from 'react';
import { DataTable, type ExtraTableProps } from './DataTable';

const tableRef = createRef<DataTable>();

<DataTable
    ref={tableRef}
    data={table.data}
    columns={table.cols as any}
    {...tableApiProps}
/>
```

`DataTable` — классовый компонент, `ref` даёт методы `scrollToCell` / `scrollToRow`.

---

## 1. Выделение строк

Чекбоксы на листьях и в шапке работают сразу (состояние внутри таблицы).

| Проп | Когда | Что сделать в хосте |
| --- | --- | --- |
| `onSelectionChange(ids: string[])` | Изменился набор чекбоксов | Запомнить `ids` для массовых действий / кнопки вне таблицы |

`ids` — идентификаторы **листовых** строк (`sourceId` / `row.id` из пайплайна).

---

## 2. Фильтр колонки (меню ▾)

Локально таблица уже прячет строки (содержит / равно / заполнено / пусто). Это **не** фасет «Отбор» из настроек списка.

| Проп | Когда | Что сделать |
| --- | --- | --- |
| `onColumnFilterChange(filters)` | Пользователь применил или сбросил фильтр | При необходимости продублировать в фасет `selection` или в запрос к API |

Форма `filters`:

```ts
{
  [field: string]: {
    comparison: 'contains' | 'eq' | 'empty' | 'filled';
    value: string;
  }
}
```

Пустые «содержит/равно» из объекта убираются.

---

## 3. Редактирование ячейки

Двойной клик или пункт контекстного меню «Изменить».

| Проп | Когда | Что сделать |
| --- | --- | --- |
| `onEditRow(rowId, field?)` | Начало правки | Открыть форму / зафиксировать аналитику |
| `onCellChange(rowId, field, value)` | Enter или blur инпута | `PATCH`/`PUT` записи, затем обновить `data` |

Без `onCellChange` значение в инпуте не попадёт в модель хоста.

---

## 4. Удаление и копирование

Панель над таблицей (если есть выбранные) и контекстное меню (ПКМ по листу).

| Проп | Когда | Что сделать |
| --- | --- | --- |
| `onDeleteRows(ids)` | Удалить выбранные или одну строку из меню | Вызвать API удаления, выкинуть строки из `data` |
| `onCopyRows(ids)` | Копировать | По желанию свой буфер / API. Иначе таблица сама пишет TSV в `navigator.clipboard` |

Без `onDeleteRows` чекбоксы сбросятся, строки на экране останутся, пока хост не обновит `data`.

---

## 5. Бесконечный скролл

Когда скролл почти у низа (`~96px`), вызывается `onLoadMore`.

| Проп | Смысл |
| --- | --- |
| `onLoadMore()` | Догрузить следующую страницу и **добавить** строки в `data` (не подменять весь массив, если пагинация накопительная) |
| `hasMore={false}` | Больше не вызывать `onLoadMore` |
| `loadingMore={true}` | Показать «Загрузка…», не слать повторный запрос |

```ts
onLoadMore = () => {
    if (this.state.loading) return;
    this.setState({ loading: true });
    fetchPage(this.state.offset).then((chunk) => {
        this.setState({
            rows: [...this.state.rows, ...chunk.rows],
            offset: this.state.offset + chunk.rows.length,
            loading: false,
            hasMore: chunk.rows.length > 0,
        });
    });
};
```

В `DataTable` передайте уже собранный `data` после `toDataTableViewModel` / своего адаптера.

---

## 6. Скролл к ячейке и автоскролл

Автоскролл при **перетаскивании строки** к краю вьюпорта включён всегда.

Программный скролл (после загрузки / из поиска):

```ts
tableRef.current?.scrollToRow('entity-id');
tableRef.current?.scrollToCell('entity-id', 'name');
```

- `rowId` — тот же id, что у листа в `data`
- `field` — `IColumnData.name` / `cell.columnName`; без него скроллится только вертикаль
- Группы временно раскрываются (`expandedGroups = 'all'`), чтобы строка была в раскладке

---

## 7. Сортировка, колонки, порядок строк

Уже были в таблице; к API так:

| Проп | Событие |
| --- | --- |
| `onSort({ column, direction })` | Клик по стрелкам; `direction` = `'ASC' \| 'DESC' \| null` (сброс) |
| `onSortRulesChange(rules)` | Полный список правил фасета `sort` |
| `onColumnMove(fromIndex, toIndex)` | Перестановка корневых колонок |
| `onColumnResize(columnName, width)` | Ресайз |
| `onRowMove(fromId, toId)` | Drag строки |

Сортировка также пытается писать в `helpers/listSettings` (`getSortSettingsState` / `replaceSortSettingsState`), если они есть. Если фасета нет — достаточно `onSort` / `onSortRulesChange`.

---

## Минимальный пример хоста

```tsx
type HostState = { data: ICell[][] | ITreeRow[]; selected: string[]; hasMore: boolean; loadingMore: boolean };

<DataTable
    ref={this.tableRef}
    data={this.state.data}
    columns={this.props.columns}
    hasMore={this.state.hasMore}
    loadingMore={this.state.loadingMore}
    onSelectionChange={(ids) => this.setState({ selected: ids })}
    onCellChange={(id, field, value) => this.patchRow(id, field, value)}
    onDeleteRows={(ids) => this.deleteRows(ids)}
    onCopyRows={(ids) => this.logCopy(ids)}
    onLoadMore={() => this.fetchNextPage()}
    onSort={({ column, direction }) => this.setQuerySort(column, direction)}
    onColumnFilterChange={(filters) => this.setQueryFilters(filters)}
/>
```

После `patch`/`delete`/`fetch` передайте новый `data` — таблица перерисуется сама.

---

## Что не нужно передавать

Условное оформление по-прежнему читается из стора списка в `render` (`getConditionalFormattingSettingsState`). Отбор, группировка строк и группировка колонок по-прежнему готовятся **до** `DataTable` в пайплайне списка.
