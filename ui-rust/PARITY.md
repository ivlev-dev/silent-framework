# Parity: Silent UI web → ui-rust

Статус: **MVP+**. Ниже честная карта: что портировано, что только визуально,
где нет виртуализации/DnD/анимаций. Desktop — только Wayland; headless-рендер
используется для скриншотов.

Легенда: ✅ полный · 🟡 частичный · ⚪ заглушка/только вид · ❌ нет.

## Компоненты `packages/ui/src/components`

| Компонент | Статус | Виртуализация | DnD | Анимации | Отличия от web |
| --- | --- | --- | --- | --- | --- |
| Button | ✅ | — | — | 🟡 hover/pressed state layer | нет ripple, нет full-width media-query нюансов |
| IconButton | ✅ | — | — | 🟡 hover/pressed | нет tooltip по long-press |
| Fab | ✅ | — | — | 🟡 hover/pressed | только circle + primary |
| Text | ✅ | — | — | — | нет rich inline-разметки |
| Heading | ✅ | — | — | — | scale 1–6, clamp заменён фиксированной шкалой |
| Label | ✅ | — | — | — | — |
| Icon | 🟡 | — | — | — | встроенный набор ~13 иконок вместо полного набора |
| Card | ✅ | — | — | 🟡 hover для interactive | header/body/footer композицией, нет media-slot |
| Divider | ✅ | — | — | — | — |
| Tag | ✅ | — | — | 🟡 hover если clickable | нет remove-кнопки с 44px hit-area |
| Badge | ✅ | — | — | — | через Tag |
| Chip | 🟡 | — | — | — | визуально Tag, нет chip-input логики |
| Avatar | ✅ | — | — | — | initials only, нет image/status |
| Progress | ✅ | — | — | 🟡 value transition нет | linear only |
| Spinner | ✅ | — | — | ❌ | статичная дуга, без вращения |
| Skeleton | ✅ | — | — | ❌ | без shimmer |
| EmptyState | ✅ | — | — | — | композиция Card |
| Alert | ✅ | — | — | — | тональные контейнеры |
| Table | ✅ | ❌ | ❌ | ❌ | header 44/row 48, tag-колонка; без sort/selection по клику |
| DataTable | 🟡 | ✅ 10k rows, O(viewport) | 🟡 column reorder/resize | ❌ reorder без tween | нет settings-панели, row DnD, sticky footer в scroll-контейнере |
| NavigationRail | ✅ | — | — | 🟡 hover | expanded 260, collapsed 72 |
| NavigationBar | ✅ | — | — | 🟡 hover | 6 items максимум по дизайну |
| TopAppBar | ✅ | — | — | — | композиция shell, без sticky-scroll elevation |
| Tabs | 🟡 | — | — | ❌ | кнопки + tonal selected, без indicator-slide |
| Breadcrumbs | ✅ | — | — | — | без collapse-логики |
| Pagination | 🟡 | — | — | — | кнопки-композиция, без ellipsis/страниц 10k |
| Accordion | ✅ | — | — | ❌ | toggle без height-анимации |
| List | 🟡 | ❌ | ❌ | ❌ | композиция Row/Divider, без virtual scroll |
| Dialog | 🟡 | — | — | ❌ | top-layer backdrop, без focus-trap |
| AlertDialog | 🟡 | — | — | — | визуальная панель |
| Drawer | 🟡 | — | — | ❌ | превью-панель, без slide |
| Sheet | 🟡 | — | — | ❌ | превью-панель |
| Popover | ✅ | — | — | ❌ | top-layer, backdrop/Escape/click-outside |
| Menu | 🟡 | — | — | — | статичные пункты, без клавиатурного меню |
| Tooltip | ⚪ | — | — | — | только визуальный пример |
| Snackbar | 🟡 | — | — | ❌ | статичная панель, нет auto-hide |
| DatePicker | 🟡 | — | — | — | календарь-сетка, выбор дня не кликабелен |
| DateRangePicker | ⚪ | — | — | — | превью диапазона |
| ColorPicker | 🟡 | — | — | — | swatches из токенов, без HSV/eyedropper |
| FileUpload | ⚪ | — | ❌ | — | dropzone-вид, без загрузки |
| RichTextEditor | ⚪ | — | — | — | тулбар + textarea, нет rich-модели |
| SegmentedButton | 🟡 | — | — | — | через tonal/text buttons |

## Формы `packages/ui/src/form`

| Компонент | Статус | Виртуализация | DnD | Анимации | Отличия |
| --- | --- | --- | --- | --- | --- |
| TextField | ✅ | — | — | 🟡 hover/focus | без affix-кнопок кроме icon |
| Textarea | ✅ | — | — | — | Enter вставляет newline, без autoresize |
| NumberField | 🟡 | — | — | — | TextField, без step/spin и numeric-фильтра |
| SearchField | ✅ | — | — | — | TextField с leading Search |
| Select | ✅ | — | — | ❌ | простой цикл значений по клику, без popup-списка |
| Combobox | 🟡 | — | — | — | select-подобное превью |
| TreeSelect | 🟡 | — | — | — | select-подобное превью, без дерева |
| Checkbox | ✅ | — | — | — | — |
| CheckboxGroup | 🟡 | — | — | — | композиция checkbox |
| RadioGroup | ✅ | — | — | — | radio + signal |
| Switch | ✅ | — | — | 🟡 knob position без tween | 44×24, knob 18 |
| Slider | ✅ | — | — | — | click/drag по track |
| OTP | 🟡 | — | — | — | поле + боксы, caret по всему значению |
| TagInput | ⚪ | — | — | — | tags + textfield, без ввода/удаления чипов |
| Field | ✅ | — | — | — | label/hint/error/focus-ring |
| FieldGroup | 🟡 | — | — | — | вертикальная композиция |
| FormActions | ✅ | — | — | — | Row кнопок |
| FormProgress | ✅ | — | — | 🟡 | progress + список статусов в галерее |

## Общее

- **Damage/idle/layout cache/text cache** — ✅, см. README и тесты.
- **DataTable virtualization** — ✅ 10 000 строк, 7 видимых, sticky header,
  row selection, density, column reorder/resize, bulk-панель над пагинацией.
- **Column drag** — призрак с тенью, подсветка цели, commit; без tween reorder.
- **Row/tree DnD** — ❌ (нет drop-индикатора/auto-expand/клавиатурного DnD).
- **Animations** — ❌/🟡: hover/pressed state layers, нет 120–200 ms tween и
  `prefers-reduced-motion` (флаг пока не подключён).
- **Wayland only** — ✅; X11 feature отключён, `WAYLAND_DISPLAY` обязателен.
- **4K scale** — ✅ 2×, окно 68% рабочей области.
