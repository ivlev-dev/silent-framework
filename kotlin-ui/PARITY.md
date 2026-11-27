# Паритет с `@ivlev-dev/silent-ui`

Статус: `полный` — визуал + базовое взаимодействие, `частичный` — компонент отрисован и работает в галерее, но без части web-поведения, `нет` — отсутствует.

| Компонент | Статус | Виртуализация | DnD | Анимации | Отличия |
| --- | --- | --- | --- | --- | --- |
| Button | полный | — | — | нет | filled/tonal/outlined/text, 32/40/48, loading, icon |
| IconButton | полный | — | — | нет | варианты standard/filled/tonal |
| Fab | полный | — | — | нет | extended/regular |
| Text / Heading / Label | полный | — | — | — | типографика из tokens |
| Link | полный | — | — | — | underline, external-метка не рисуется |
| Icon | частичный | — | — | — | векторные иконки shell/метрик (24×24, Painter-примитивы); Icon widget в галерее — glyph-строка |
| Card | полный | — | — | — | body + слоты действий/футера через композицию |
| Divider | полный | — | — | — | — |
| TextField | полный | — | — | — | нативный overlay-редактор на desktop/Android |
| Textarea | частичный | — | — | — | overlay однострочный, визуал многострочный |
| NumberField | частичный | — | — | — | кнопки ± нарисованы, шаг по клику не реализован |
| Select | частичный | — | — | — | dropdown в canvas, без клавиатурного listbox |
| Combobox | частичный | — | — | — | без async/фильтрации/создания опций |
| TreeSelect | частичный | — | — | — | раскрытие/сворачивание и DnD узлов нет |
| Checkbox / Switch | полный | — | — | — | size/variant ограничены |
| CheckboxGroup / RadioGroup | полный | — | — | — | сетка колонок по ширине |
| Slider | полный | — | — | — | клик/тап по треку |
| OTP | частичный | — | — | — | один overlay-ввод, ячейки визуальные |
| TagInput | частичный | — | — | — | добавление/удаление тегов базовое |
| Field / FieldGroup / FormActions | полный | — | — | — | FieldGroup принимает один контейнер |
| FieldArray | частичный | — | — | — | add/remove без авто-валидации массива |
| FileField / FileUpload | частичный | — | — | — | нет системного file picker |
| FormProgress | полный | — | — | — | прогресс по required-полям |
| Tag / Badge / Chip | полный | — | — | — | tone-набор |
| Avatar | частичный | — | — | — | инициалы, без изображений |
| Progress / Spinner | полный | — | — | — | spinner статический, не анимирован |
| Skeleton | полный | — | — | — | без shimmer |
| EmptyState | полный | — | — | — | — |
| Alert | полный | — | — | — | без dismiss-анимации |
| Table | частичный | да (видимые строки) | нет | нет | выравнивание колонок, status/tags-ячейки, sticky header, без resize/selection |
| DataTable | полный | да (видимые строки) | колонки: да; строки: нет | только ghost/highlight, без tween | серверная пагинация/сортировка, выбор, status/tags-ячейки, density, bulk, resize, заголовки в обычном регистре |
| Pagination | полный | — | — | — | — |
| List | частичный | да (видимые строки) | нет | нет | без вложенности/секций |
| NavigationRail / NavigationBar | полный | — | — | — | rail 260 на xl |
| TopAppBar | полный | — | — | — | small/medium/large, слоты |
| Tabs | полный | — | — | — | без scroll-кнопок |
| Breadcrumbs | полный | — | — | — | inline-разделители |
| SegmentedButton | полный | — | — | — | single-select |
| Accordion | полный | — | — | — | без анимации раскрытия |
| Dialog / AlertDialog | частичный | — | — | нет | backdrop/close; focus trap и native dialog нет |
| Drawer / Sheet | частичный | — | — | нет | modal/standard, scrim; без focus trap |
| Popover / Menu / Tooltip | частичный | — | — | нет | inline canvas, без portal/floating-позиционирования |
| Snackbar | частичный | — | — | нет | без таймера автоскрытия |
| SearchField | частичный | — | — | — | использует TextField, без иконки/очистки |
| DatePicker | частичный | — | — | нет | один месяц, без навигации по месяцам |
| DateRangePicker | частичный | — | — | нет | выбор начала/конца, без двух месяцев |
| ColorPicker | частичный | — | — | — | палитра, без HSV/hex-ввода |
| RichTextEditor | частичный | — | — | нет | toolbar-заглушка, без contenteditable-модели |
| FileUpload | частичный | — | — | — | dropzone, без нативного выбора |
| Listbox | полный | — | — | — | базовый listbox |

## Демо-страницы

- Dashboard повторяет web-пример: 6 метрик с векторными иконками и подсказками, панели «Статусы» (тег, `60 из 240`, прогресс, 25%) и «Команда и теги» (владельцы и теги чипами), «Последние проекты» с ячейками статуса и тегов, выравниванием бюджета/даты, данными 1:1 и заголовками в обычном регистре.
- Раскладка: 2 колонки метрик на узком, 3 от 600 px, 6 от 1600 px; панели 1.15:1 от 1024 px и 1.35:1 от 1920 px; таблица заменяется карточками ниже 600 px.

## Общие отличия

- Hover: path-based hit-test, стабильные пути между ребилдами, курсоры pointer/text/grab/grabbing/col-resize; state layer 8%/12%; damage только старых/новых регионов.
- Рендеринг: Canvas (Skia/Android) вместо DOM/CSS.
- Focus trap, ARIA, portal/floating positioning и keyboard-навигация listbox реализованы частично.
- Table/DataTable DnD: перетаскивание колонок за заголовок, ghost, target highlight, resize без jump; строки и tree-nodes не перетаскиваются и в галерее не демонстрируются.
- Анимации перестроения: time-based tween не подключён, в галерее только статические ghost/highlight; `MotionSettings.reducedMotion` зарезервирован.
- Виртуализация: DataTable/Table/List рисуют только пересекающие viewport строки и overscan; 10k строк проверено тестом.
- Формы: overlay-редакторы нативные, но OTP/NumberField/Textarea используют один контрол ввода.
