# @ivlev-dev/silent-ui

Дизайн-система Silent Framework: токены, темы, layout-примитивы, типографика, компоненты, формы и иконки. Справочник описывает публичный API точки входа `@ivlev-dev/silent-ui`; сабпути `/layout`, `/theme`, `/tokens`, `/form`, `/form/*`, `/icons/*` переэкспортируют те же символы.

Компоненты — light-компоненты: функция `(props) => Node`, ровно один корневой элемент, стили в co-located `.css`, варианты через `data-*`. CSS подключается только отдельными входами (`@ivlev-dev/silent-ui/styles.css` и т. п.): импорт CSS из JS ломает Node-SSR.

## Импорты

```ts
import { Button, Stack, Heading, Text, applyTheme } from "@ivlev-dev/silent-ui";
import "@ivlev-dev/silent-ui/styles.css";
```

## Токены и брейкпоинты

### `breakpoints`

`const breakpoints: Readonly<Record<Breakpoint, number>>` — запись `Breakpoint → px`: `xs: 0`, `sm: 360`, `md: 480`, `lg: 600`, `xl: 840`, `2xl: 1200`, `3xl: 1600`, `4xl: 1920`, `5xl: 2560`, `6xl: 3840`. Источник истины — `src/tokens/breakpoints.json`, синхронность проверяется тестом.

### `breakpointEm`

`const breakpointEm: Readonly<Record<Breakpoint, string>>` — те же брейкпоинты в `em` (от `baseFontSize = 16`): значения для `@media (min-width: …)`. `xs` — `"0"`.

### `breakpointOrder`

`const breakpointOrder: readonly Breakpoint[]` — порядок брейкпоинтов от узкого к широкому. Используется тестами и генерацией документации.

### `baseFontSize`

`const baseFontSize = 16` — базовая величина, от которой считаются `em`-брейкпоинты.

### `mediaUp`

`function mediaUp(breakpoint: Breakpoint): string | null` — `@media`-условие «от брейкпоинта и шире» (`"(min-width: 30em)"`); для `xs` возвращает `null`.

### `mediaDown`

`function mediaDown(breakpoint: Breakpoint): string | null` — условие «уже брейкпоинта» (`"(max-width: 29.9375em)"`); для `xs` возвращает `null`.

### `Breakpoint`

`type Breakpoint = keyof typeof breakpoints` — юнион имён брейкпоинтов: `"xs" | "sm" | … | "6xl"`.

### `palette`

`const palette` — исходная брендовая палитра: `ink-900 #081A2E`, `ink-800 #0E2A47`, `teal-700 #1F4E6B`, `mist-300 #9FB8C9`, `ivory-50 #F2F5F7`; публичные алиасы прежней палитры (`ivory #F2F5F7`, `almond #E6EDF2`, `mist #9FB8C9`, `navy #0E2A47`, `noir #081A2E`, `gold #1F4E6B`, `navy-deep #081A2E`, `navy-mid #0E2A47`, `navy-dark #061424`, `white #FFFFFF`) и прежние ключи ролей (`primary`, `secondary`, `tertiary`, `neutralDarkest`, `neutralDark`, `neutralLightest`) сохранены для обратной совместимости.

### `PaletteColor`

`type PaletteColor = keyof typeof palette` — ключи `palette`.

### `lightColors`

`const lightColors: SemanticColors` — семантические роли светлой темы: `primary`, `on-primary`, `primary-container`, `on-primary-container`, `primary-fixed*`, `secondary`, `tertiary`, `accent`/`on-accent`, `error`, `success`, `warning` и их `*-container`/`on-*`, `surface`, `surface-dim`, `surface-bright`, `surface-container-*`, `on-surface`, `on-surface-variant`, `on-surface-muted`, `outline`, `outline-variant`, `scrim`, `shadow`, `inverse-*`. `accent` — mist-пара для CTA/хайлайтов.

### `darkColors`

`const darkColors: SemanticColors` — те же роли для тёмной темы. Значения дублируют `themes.css`; расхождение ломает тест.

### `SemanticColors`

`interface SemanticColors` — интерфейс набора семантических ролей (все ключи `lightColors`/`darkColors`).

### `SemanticColorRole`

`type SemanticColorRole = keyof SemanticColors` — имя цветовой роли.

### `semanticRoles`

`const semanticRoles: readonly SemanticColorRole[]` — стабильный список ролей в порядке объявления: для генераторов и проверок полноты.

### `stateLayerOpacity`

`const stateLayerOpacity` — прозрачности state layers: `hover 0.08`, `focus 0.12`, `pressed 0.12`, `dragged 0.16`, `disabled 0.38`, `disabledContainer 0.12`.

### `StateLayer`

`type StateLayer = keyof typeof stateLayerOpacity` — имя состояния state layer.

### `spacing`

`const spacing` — шкала отступов `0…10` (`--sui-space-*`), 4px база.

### `SpacingStep`

`type SpacingStep = keyof typeof spacing` — числовой шаг отступа, который принимают `gap`/`padding`.

### `radii`

`const radii` — радиусы: `none`, `xs` (4px), `sm` (6px), `md` (10px), `lg` (14px), `xl` (20px), `full` (999px), плюс семантические `card` (14px), `dialog`/`sheet` (20px).

### `Radius`

`type Radius = keyof typeof radii` — имя радиуса.

### `elevation`

`const elevation` — тени `0…5` на `rgba(var(--sui-color-shadow-rgb), …)`: без обязательного `color-mix`.

### `Elevation`

`type Elevation = keyof typeof elevation` — уровень тени.

### `typeScale`

`const typeScale: Record<TypeVariant, TypeStyle>` — типографическая шкала `display-*`/`headline-*`/`title-*`/`body-*`/`label-*` с полями `family`, `size` (fluid `clamp` с верхней границей на 4K), `lineHeight`, `weight`, `tracking`. `family: "display"` — семантический алиас того же sans-stack (без serif) у `display-*`/`headline-*`; `family: "sans"` — UI-шрифт у `title-*`/`body-*`/`label-*`. Display ≤ 2.75rem, headline ≤ 2rem, title ≤ 1.25rem, body 1rem/0.875rem, label 0.8125rem/0.75rem.

### `TypeFamily`

`type TypeFamily = "display" | "sans" | "mono"` — семейство шрифта варианта шкалы: `display` и `sans` резолвятся в один современный sans (`--sui-font-display` — алиас `--sui-font-sans`), `mono` — код.

### `TypeStyle`

`interface TypeStyle` — форма одного стиля шкалы: `family`, `size`, `lineHeight`, `weight`, `tracking`.

### `TypeVariant`

`type TypeVariant = keyof typeof typeScale` — имя стиля типографики.

### `motion`

`const motion` — длительности `duration.fast/base/slow` (120/180/240ms) и прежняя M3-шкала `short1…long2`; easing `standard`/`emphasized`/`editorial`/`linear` и др.

### `density`

`const density` — множители плотности: `compact 0.875`, `default 1`, `comfortable 1.125`.

### `Density`

`type Density = keyof typeof density` — режим плотности.

### `controlHeight`

`const controlHeight` — высоты контролов по размеру: `sm 2rem` (32px), `md 2.5rem` (40px), `lg 3rem` (48px). На `pointer: coarse` компоненты поднимают цель нажатия до `--sui-touch-target` (44px).

### `ControlSize`

`type ControlSize = keyof typeof controlHeight` — размер контрола (`sm`/`md`/`lg`).

### `cssVar`

`function cssVar(name: string): string` — собирает имя CSS-переменной дизайн-системы: `cssVar("space-4") → "--sui-space-4"`.

## Тема

### `applyTheme`

`function applyTheme(options: ApplyThemeOptions): void` — ставит `data-theme` на `documentElement` (или `root`), пишет inline-переопределения `--sui-color-*` и при `persist` сохраняет выбор в `localStorage`. Без DOM — no-op (SSR-safe).

### `ApplyThemeOptions`

`interface ApplyThemeOptions` — опции `applyTheme`: `theme`, `palette`, `root`, `persist`, `storageKey`.

### `ThemeMode`

`type ThemeMode = "light" | "dark" | "auto"` — режим темы.

### `ThemePalette`

`type ThemePalette = Partial<SemanticColors>` — переопределяются только переданные роли.

### `THEME_STORAGE_KEY`

`const THEME_STORAGE_KEY = "sui-theme"` — ключ `localStorage` по умолчанию, который читает `ThemeScript`.

### `readStoredTheme`

`function readStoredTheme(storageKey?: string): ThemeMode | null` — возвращает сохранённую тему или `null`. Не падает при запрете storage.

### `resetThemePalette`

`function resetThemePalette(root?: HTMLElement | null): void` — снимает inline-переопределения `--sui-color-*` с корня.

### `ThemeScript`

`function ThemeScript(props: ThemeScriptProps): Node` — SSR-компонент `<script>`: ставит `data-theme` до отрисовки. Принимает `nonce`, `defaultTheme`, `storageKey`.

### `ThemeScriptProps`

`interface ThemeScriptProps` — пропсы `ThemeScript`: `nonce`, `defaultTheme`, `storageKey`, `class`, `attrs`.

### `themeScriptSource`

`function themeScriptSource(defaultTheme?: ThemeMode, storageKey?: string): string` — исходник инлайн-скрипта темы (для ручной вставки в `<head>`).

### `UiConfigProvider`

`function UiConfigProvider(props: UiConfigProviderProps): Node` — провайдер конфигурации: строки интерфейса, локаль, тема и плотность поддерева. Рендерит `display: contents`-контейнер `sui-provider` и ставит на него `data-theme`/`data-density`, сохраняя контракт «один корень».

### `UiConfigProviderProps`

`interface UiConfigProviderProps` — пропсы провайдера: `strings`, `locale`, `theme`, `density`, `class`, `children`.

### `UiConfig`

`interface UiConfig` — конфигурация UI-дерева: `strings` и `locale`. Тема и плотность живут на DOM-контейнере провайдера, а не в контексте.

### `uiConfigContext`

`const uiConfigContext: Context<UiConfig>` — контекст дизайн-системы: можно использовать напрямую вместо провайдера.

### `useUiConfig`

`function useUiConfig(): UiConfig` — возвращает текущую `UiConfig`. Вне провайдера — значения по умолчанию, в том числе в SSR.

### `DEFAULT_UI_CONFIG`

`const DEFAULT_UI_CONFIG: UiConfig` — конфигурация по умолчанию: RU-строки и локаль `ru-RU`.

### `UiStrings`

`interface UiStrings` — контракт строк: `close`, `loading`, `showPassword`, `hidePassword`, `required`, `addItem`, `removeItem`, `moveUp`, `moveDown`, `submit`, `reset`, `chooseFile`, `navigation`, `actions` (доступное имя группы действий в шапке), `breadcrumbs`, `pagination`, `previousPage`, `nextPage`, `pageStatus` (шаблон `{page}`/`{pageCount}`), `search`, `clear`, `sortAscending`, `sortDescending`, `noData`.

### `defaultUiStrings`

`const defaultUiStrings: UiStrings` — RU-значения: `Закрыть`, `Загрузка`, `Показать пароль`, `Скрыть пароль`, `Обязательное поле`, `Добавить`, `Удалить`, `Переместить выше`, `Переместить ниже`, `Сохранить`, `Сбросить`, `Выбрать файл`, `Основная навигация`, `Хлебные крошки`, `Постраничная навигация`, `Назад`, `Вперёд`, `Страница {page} из {pageCount}`, `Поиск`, `Очистить`, `По возрастанию`, `По убыванию`, `Нет данных`.

### `DEFAULT_LOCALE`

`const DEFAULT_LOCALE = "ru-RU"` — локаль по умолчанию.

## Layout

### `Box`

`function Box(props: BoxProps): Node` — базовый контейнер: `padding`, `background`, `border`, `radius`, `elevation` + общие `class`/`style`/`attrs`/`children`.

### `BoxProps`

`interface BoxProps extends PrimitiveProps` — пропсы `Box`: `padding`, `background`, `border`, `radius`, `elevation`.

### `Stack`

`function Stack(props: StackProps): Node` — вертикальный flex-поток: `gap`, `align`, `justify`.

### `StackProps`

`interface StackProps extends PrimitiveProps` — пропсы `Stack`.

### `Inline`

`function Inline(props: InlineProps): Node` — горизонтальный flex-поток: `gap`, `align`, `justify`, `wrap`.

### `InlineProps`

`interface InlineProps extends PrimitiveProps` — пропсы `Inline`.

### `Grid`

`function Grid(props: GridProps): Node` — сетка: `columns` (1–12 или `auto`), `gap`, `min` (минимальная ширина колонки для `auto`).

### `GridProps`

`interface GridProps extends PrimitiveProps` — пропсы `Grid`.

### `GridColumns`

`type GridColumns = 1 | 2 | … | 12 | "auto"` — число колонок или auto-fit.

### `Container`

`function Container(props: ContainerProps): Node` — ограничитель ширины: `size` (`content`/`wide`/`full`), `gutter`.

### `ContainerProps`

`interface ContainerProps extends PrimitiveProps` — пропсы `Container`.

### `ContainerSize`

`type ContainerSize = "content" | "wide" | "full"` — варианты ширины.

### `Surface`

`function Surface(props: SurfaceProps): Node` — поверхность: `tone`, `padding`, `border`, `radius`, `elevation`.

### `SurfaceProps`

`interface SurfaceProps extends PrimitiveProps` — пропсы `Surface`.

### `Divider`

`function Divider(props: DividerProps): Node` — hairline-разделитель: `orientation` (`horizontal`/`vertical`), `inset` (`none`/`start`/`both`).

### `DividerProps`

`interface DividerProps extends PrimitiveProps` — пропсы `Divider`.

### `DividerOrientation`

`type DividerOrientation = "horizontal" | "vertical"` — ориентация разделителя.

### `DividerInset`

`type DividerInset = "none" | "start" | "both"` — отступ линии от края.

## Типографика

### `Text`

`function Text(props: TextProps): Node` — семантический `<span>`: `variant`, `tone`, `align`, `clamp` (1–4 строки), `truncate` (одна строка с многоточием), `measure` (мера строки 68ch).

### `TextProps`

`interface TextProps` — пропсы `Text`: `variant`, `tone`, `align`, `clamp`, `truncate` (`.sui-truncate`), `measure` (`.sui-measure`), `class`, `style`, `attrs`, `children`.

### `TextVariant`

`type TextVariant` — `body-*`, `title-medium`, `title-small`, `label-*`.

### `TextTone`

`type TextTone` — `default`, `muted`, `primary`, `secondary`, `error`, `success`, `warning`, `inherit`.

### `TextAlign`

`type TextAlign = "start" | "center" | "end"` — выравнивание.

### `TextClamp`

`type TextClamp = 1 | 2 | 3 | 4` — количество строк до обрезки.

### `Heading`

`function Heading(props: HeadingProps): Node` — заголовок: `level` 1–6 задаёт тег (`h1…h6`) и вариант по умолчанию; `variant` переопределяет размер, `tone` — цвет.

### `HeadingProps`

`interface HeadingProps` — пропсы `Heading`.

### `HeadingLevel`

`type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6` — уровень заголовка.

### `HeadingVariant`

`type HeadingVariant` — варианты от `display-large` до `title-small`.

### `HeadingTone`

`type HeadingTone = "default" | "muted" | "primary" | "inherit"` — тон заголовка.

### `Label`

`function Label(props: LabelProps): Node` — подпись поля: `for`, `variant`, `tone`, `disabled`, `required` (маркер `*` скрыт от скринридера), `uppercase` (верхний регистр для подписей секций).

### `LabelProps`

`interface LabelProps` — пропсы `Label`: `for`, `variant`, `tone`, `disabled`, `required`, `uppercase`, `class`, `style`, `attrs`, `children`.

### `LabelVariant`

`type LabelVariant = "label-large" | "label-medium" | "label-small"` — размер подписи.

### `LabelTone`

`type LabelTone = "default" | "muted" | "error" | "primary" | "inherit"` — тон подписи; `error` включается только явно.

### `Icon`

`function Icon(props: IconProps): Node` — inline-SVG обёртка: `size`, `label` (иначе `aria-hidden`), `children` — `<path>`/`<circle>`.

### `IconProps`

`interface IconProps` — пропсы `Icon`: `size`, `label`, `class`, `style`, `attrs`, `children`.

### `IconSize`

`type IconSize = "sm" | "md" | "lg" | "xl"` — размер иконки.

### `Spinner`

`function Spinner(props: SpinnerProps): Node` — индикатор загрузки: `size`, `label` (по умолчанию строка `loading` из конфигурации). Останавливается при `prefers-reduced-motion`.

### `SpinnerProps`

`interface SpinnerProps` — пропсы `Spinner`.

### `SpinnerSize`

`type SpinnerSize = "sm" | "md" | "lg"` — размер спиннера.

## Иконки

### `GlyphProps`

`interface GlyphProps extends Omit<IconProps, "children"> { readonly title?: string }` — общие пропсы глифов: `size`, `label` (алиас `title`), `title` (доступное имя → `role="img"` и `<title>`), `class`, `style`, `attrs`. `children` запрещён: глиф задаётся модулем.

### `CloseIcon`

`function CloseIcon(props: GlyphProps): Node` — Material Symbols `close`.

### `DismissIcon`

`const DismissIcon` — алиас `CloseIcon` (тот же компонент, экспортируется для семантических имён).

### `CheckIcon`

`function CheckIcon(props: GlyphProps): Node` — Material Symbols `check`.

### `MenuIcon`

`function MenuIcon(props: GlyphProps): Node` — Material Symbols `menu`.

### `SearchIcon`

`function SearchIcon(props: GlyphProps): Node` — Material Symbols `search`.

### `LoadingIcon`

`function LoadingIcon(props: GlyphProps): Node` — Material Symbols `progress_activity` (четверть кольца).

### `ChevronDownIcon`

`function ChevronDownIcon(props: GlyphProps): Node` — Material Symbols `keyboard_arrow_down`.

### `ChevronUpIcon`

`function ChevronUpIcon(props: GlyphProps): Node` — Material Symbols `keyboard_arrow_up`.

### `ChevronStartIcon`

`function ChevronStartIcon(props: GlyphProps): Node` — Material Symbols `keyboard_arrow_left` (LTR).

### `ChevronEndIcon`

`function ChevronEndIcon(props: GlyphProps): Node` — Material Symbols `keyboard_arrow_right` (LTR).

### `ArrowBackIcon`

`function ArrowBackIcon(props: GlyphProps): Node` — Material Symbols `arrow_back`.

### `ArrowForwardIcon`

`function ArrowForwardIcon(props: GlyphProps): Node` — Material Symbols `arrow_forward`.

### `ExpandMoreIcon`

`function ExpandMoreIcon(props: GlyphProps): Node` — Material Symbols `expand_more`.

### `ExpandLessIcon`

`function ExpandLessIcon(props: GlyphProps): Node` — Material Symbols `expand_less`.

### `MoreVertIcon`

`function MoreVertIcon(props: GlyphProps): Node` — Material Symbols `more_vert`.

### `MoreHorizIcon`

`function MoreHorizIcon(props: GlyphProps): Node` — Material Symbols `more_horiz`.

### `AddIcon`

`function AddIcon(props: GlyphProps): Node` — Material Symbols `add`.

### `RemoveIcon`

`function RemoveIcon(props: GlyphProps): Node` — Material Symbols `remove`.

### `VisibilityIcon`

`function VisibilityIcon(props: GlyphProps): Node` — Material Symbols `visibility` (показать пароль).

### `VisibilityOffIcon`

`function VisibilityOffIcon(props: GlyphProps): Node` — Material Symbols `visibility_off` (скрыть пароль).

### `UploadIcon`

`function UploadIcon(props: GlyphProps): Node` — Material Symbols `file_upload`.

### `DownloadIcon`

`function DownloadIcon(props: GlyphProps): Node` — Material Symbols `file_download`.

### `RefreshIcon`

`function RefreshIcon(props: GlyphProps): Node` — Material Symbols `refresh`.

### `InfoIcon`

`function InfoIcon(props: GlyphProps): Node` — Material Symbols `info`.

### `WarningIcon`

`function WarningIcon(props: GlyphProps): Node` — Material Symbols `warning`.

### `ErrorIcon`

`function ErrorIcon(props: GlyphProps): Node` — Material Symbols `error`.

### `SuccessIcon`

`function SuccessIcon(props: GlyphProps): Node` — Material Symbols `check_circle`.

### `StarIcon`

`function StarIcon(props: GlyphProps): Node` — Material Symbols `star_border` (контур).

### `StarFilledIcon`

`function StarFilledIcon(props: GlyphProps): Node` — Material Symbols `star` (заливка).

Готовые глифы доступны и точечно: `@ivlev-dev/silent-ui/icons/close` и т. п.

## Кнопки и действия

### `Button`

`function Button(props: ButtonProps): Node` — кнопка: `variant` (`filled`/`accent`/`tonal`/`outlined`/`text`/`elevated`), `size`, `leading`, `trailing`, `loading` (`aria-busy` + спиннер + блокировка), `disabled`, `fullWidth`, `type`, `onClick`, `ref`.

### `ButtonProps`

`interface ButtonProps` — пропсы `Button`.

### `ButtonVariant`

`type ButtonVariant = "filled" | "accent" | "tonal" | "outlined" | "text" | "elevated"` — визуальный вариант; `accent` — золотая CTA на паре `accent`/`on-accent`.

### `ButtonSize`

`type ButtonSize = "sm" | "md" | "lg"` — размер кнопки.

### `ButtonType`

`type ButtonType = "button" | "submit" | "reset"` — нативный `type`.

### `IconButton`

`function IconButton(props: IconButtonProps): Node` — круглая кнопка-иконка: обязательный `label` → `aria-label`, `size`, `variant` (`standard`/`filled`/`accent`/`tonal`/`outlined`), `loading` (спиннер вместо иконки и блокировка нажатий).

### `IconButtonProps`

`interface IconButtonProps` — пропсы `IconButton`: `label`, `size`, `variant`, `loading`, `disabled`, `type`, `onClick`, `class`, `style`, `attrs`, `ref`.

### `IconButtonSize`

`type IconButtonSize = "sm" | "md" | "lg"` — размер.

### `IconButtonVariant`

`type IconButtonVariant = "standard" | "filled" | "accent" | "tonal" | "outlined"` — вариант; `accent` — золотая заливка для ключевого действия.

### `Fab`

`function Fab(props: FabProps): Node` — FloatingActionButton (M3): `primary`/`secondary`/`tertiary`/`surface`, три размера, extended-режим. В extended обязателен `label`, в icon-only — `ariaLabel`: безымянную кнопку компилятор не соберёт.

### `FabProps`

`type FabProps = FabCommonProps & ({ extended: true; label: Children } | { extended?: false; ariaLabel: string })` — дискриминированный юнион двух режимов.

### `FabVariant`

`type FabVariant = "primary" | "secondary" | "tertiary" | "surface"` — цветовой вариант.

### `FabSize`

`type FabSize = "sm" | "md" | "lg"` — размер.

### `FabPosition`

`type FabPosition = "top-start" | "top-end" | "bottom-start" | "bottom-end"` — только `data-position` и `position: absolute` внутри позиционированного контейнера; глобального `position: fixed` нет.

### `SegmentedButton`

`function SegmentedButton(props: SegmentedButtonProps): Node` — группа-сегменты (single select): roving tabindex, Arrow/Home/End, `aria-pressed` на сегментах. Управляется через `value`/`onValueChange`.

### `SegmentedButtonProps`

`interface SegmentedButtonProps` — пропсы `SegmentedButton`: `value`, `options`, `onValueChange`, `size`, `disabled`, `fullWidth`, `label`, `id`.

### `SegmentedButtonOption`

`interface SegmentedButtonOption` — описание сегмента: `key`, `label`, `icon`, `ariaLabel`, `disabled`.

### `SegmentedButtonItem`

`function SegmentedButtonItem(props: SegmentedButtonItemProps): Node` — отдельный сегмент управляемой группы: кнопка с `aria-pressed`.

### `SegmentedButtonItemProps`

`interface SegmentedButtonItemProps` — пропсы сегмента, включая `value`, `selected`, `tabIndex`, `onSelect`, `onKeyDown`.

### `SegmentedButtonSize`

`type SegmentedButtonSize = "sm" | "md" | "lg"` — размер сегментов.

## Статусы и обратная связь

### `Badge`

`function Badge(props: BadgeProps): Node` — бейдж-счётчик или точка. Без `label` точка и пустой бейдж декоративны (`aria-hidden="true"`).

### `BadgeProps`

`interface BadgeProps` — пропсы `Badge`: `count`, `max` (по умолчанию 99 → `99+`), `dot`, `variant`, `position`, `label`, `decorative`.

### `BadgeVariant`

`type BadgeVariant = "neutral" | "primary" | "accent" | "success" | "warning" | "error" | "info"` — цветовой вариант; `accent` — золотой акцент.

### `BadgePosition`

`type BadgePosition = "top-end" | "top-start" | "bottom-end" | "bottom-start"` — угол позиционирования относительно ближайшего родителя с `position: relative`; без `position` бейдж остаётся inline.

### `Chip`

`function Chip(props: ChipProps): Node` — чип `assist`/`filter`/`input`/`suggestion`. Интерактивная часть — отдельная кнопка внутри корня, поэтому кнопка удаления не вкладывается в другую кнопку.

### `ChipProps`

`interface ChipProps` — пропсы `Chip`: `variant`, `selected`, `removable`, `onRemove`, `leading`, `avatar`, `disabled`, `onClick`.

### `ChipVariant`

`type ChipVariant = "assist" | "filter" | "input" | "suggestion"` — тип чипа; `filter` получает `aria-pressed`.

### `Tag`

`function Tag(props: TagProps): Node` — статичная метка с необязательной иконкой и кнопкой удаления (`aria-label`, по умолчанию RU `Удалить`).

### `TagProps`

`interface TagProps` — пропсы `Tag`: `variant`, `size`, `removable`, `onRemove`, `removeLabel`, `leading`.

### `TagVariant`

`type TagVariant = "neutral" | "primary" | "secondary" | "success" | "warning" | "error" | "info"` — цветовой вариант.

### `TagSize`

`type TagSize = "sm" | "md"` — размер тега.

### `Alert`

`function Alert(props: AlertProps): Node` — уведомление: вариант — `data-variant`, роль объявления выводится из варианта (`info`/`success` → `status`, `warning`/`error` → `alert`). Закрытие — кнопка с RU-подписью `Закрыть`.

### `AlertProps`

`interface AlertProps` — пропсы `Alert`: `variant`, `title`, `icon`, `actions`, `dismissible`, `onClose`, `role`.

### `AlertVariant`

`type AlertVariant = "info" | "success" | "warning" | "error"` — вариант уведомления.

### `AlertRole`

`type AlertRole = "status" | "alert"` — роль объявления для скринридера.

### `Progress`

`function Progress(props: ProgressProps): Node` — индикатор выполнения: `value` вне `0..100` зажимается, отсутствие значения (или `NaN`) включает indeterminate-режим (без `aria-valuenow`).

### `ProgressProps`

`interface ProgressProps` — пропсы `Progress`: `variant`, `value`, `label`, `showValue`, `size`.

### `ProgressSize`

`type ProgressSize = "sm" | "md" | "lg"` — размер.

### `ProgressVariant`

`type ProgressVariant = "linear" | "circular"` — форма индикатора.

### `Skeleton`

`function Skeleton(props: SkeletonProps): Node` — плейсхолдер загрузки. Всегда декоративен (`aria-hidden`): смысл озвучивает соседний `aria-busy`-контейнер.

### `SkeletonProps`

`interface SkeletonProps` — пропсы `Skeleton`: `variant`, `width`, `height`, `lines`, `animation`, `size` (высота строки текста `sm`/`md`/`lg` — 0.75em/1em/1.25em).

### `SkeletonVariant`

`type SkeletonVariant = "text" | "circle" | "rect"` — форма плейсхолдера.

### `SkeletonAnimation`

`type SkeletonAnimation = "pulse" | "wave" | "none"` — анимация; `none` отключает движение.

## Данные и контент

### `Avatar`

`function Avatar(props: AvatarProps): Node` — аватар: изображение → инициалы → иконка. Размер/форма/статус через `data-*`; точка статуса не добавляет имени без `statusLabel`. Если `src` не загрузился, показывается fallback (инициалы/иконка) с `role="img"` и `aria-label`; смена `src` повторяет попытку.

### `AvatarProps`

`interface AvatarProps` — пропсы `Avatar`: `src`, `alt`, `initials`, `icon`, `size`, `shape`, `status`, `statusLabel`.

### `AvatarSize`

`type AvatarSize = "sm" | "md" | "lg" | "xl"` — размер.

### `AvatarShape`

`type AvatarShape = "circle" | "square"` — форма.

### `AvatarStatus`

`type AvatarStatus = "online" | "offline" | "away" | "busy"` — статус.

### `Card`

`function Card(props: CardProps): Node` — карточка-контейнер: `variant` (`elevated`/`filled`/`outlined`), `media` + `mediaAspect`, `header` + `headerLines`, `actions`, `padding`. При `interactive` — ARIA-семантика кнопки на `div` (Enter/Space), чтобы в слоты можно было класть ссылки.

### `CardProps`

`interface CardProps` — пропсы `Card`: `variant`, `interactive`, `disabled`, `padding`, `media`, `mediaAspect`, `header`, `headerLines` (1–3 строки перед обрезкой), `actions`, `onClick`, `class`, `style`, `attrs`, `children`, `ref`.

### `CardVariant`

`type CardVariant = "elevated" | "filled" | "outlined"` — вариант оформления.

### `CardMediaAspect`

`type CardMediaAspect = "auto" | "square" | "video" | "wide" | "portrait"` — пропорции медиа-слота: натуральные (`auto`), `1:1`, `16:9`, `21:9` и `4:5`.

### `List`

`function List(props: ListProps): Node` — список; `role="listbox"` ставится только по явному `selectable`.

### `ListProps`

`interface ListProps` — пропсы `List`: `selectable`, `divider`, `dense`.

### `ListItem`

`function ListItem(props: ListItemProps): Node` — строка списка. Интерактивная активируется Enter/Space, `selected` → `aria-selected`, `current` → `aria-current="page"`. Живёт внутри `For` с `keyOf`.

### `ListItemProps`

`interface ListItemProps` — пропсы строки: `selected`, `interactive`, `current`, `disabled`, `leading`, `trailing`, `divider`, `lines` (обрезка текста по 1–3 строкам), `role`.

### `ListItemRole`

`type ListItemRole = "option" | "button" | "link"` — переопределение роли.

### `Table`

`function Table<Row>(props: TableProps<Row>): Node` — таблица: семантические `table/thead/tbody/th/td`, `scope="col"`, `aria-sort` и управляемая сортировка через `onSort`. Строки внутри не сортируются. Корень `.sui-table-scroll` скроллит широкую таблицу по горизонтали и не ломает страницу на узких экранах.

### `TableProps`

`interface TableProps<Row>` — пропсы: `columns`, `rows`, `rowKey`, `sortKey`, `sortDirection`, `onSort`, `dense`, `stickyHeader`, `caption`, `label`, `empty`, `emptyTitle`.

### `TableColumn`

`interface TableColumn<Row>` — колонка: `key`, `header`, `align`, `width`, `sortable`, `truncate` (одна строка с многоточием), `lines` (1–3 строки), `renderCell`.

### `TableAlign`

`type TableAlign = "start" | "center" | "end"` — выравнивание ячейки.

### `TableSortDirection`

`type TableSortDirection = "ascending" | "descending"` — направление сортировки.

### `EmptyState`

`function EmptyState(props: EmptyStateProps): Node` — пустое состояние: слот иконки/иллюстрации, заголовок, описание, действия. Иконка декоративна — скринридер читает только текст.

### `EmptyStateProps`

`interface EmptyStateProps` — пропсы `EmptyState`: `icon`, `illustration`, `title`, `description`, `actions`, `compact`, `titleLevel`.

### `Accordion`

`function Accordion(props: AccordionProps): Node` — WAI-ARIA Accordion: `single`/`multiple`, управляемый `value` и неуправляемый `defaultValue`, Arrow/Home/End по заголовкам. Закрытые пункты не рендерят контент.

### `AccordionProps`

`interface AccordionProps` — пропсы `Accordion`: `items`, `selectionMode`, `value`, `defaultValue`, `onValueChange`, `headingLevel`, `id`.

### `AccordionItem`

`function AccordionItem(props: AccordionItemProps): Node` — публичный пункт аккордеона. Внутри `Accordion` список вызывает внутренний `accordionItemNode` напрямую, чтобы не зависеть от кэша лёгких компонентов при гидрации.

### `AccordionItemProps`

`interface AccordionItemProps` — пропсы пункта: `title`, `expanded`, `content`, `truncate` (заголовок одной строкой), `disabled`, `headingLevel`, `triggerId`, `panelId`, `onToggle`, `onKeyDown`.

### `AccordionItemData`

`interface AccordionItemData` — данные пункта для `items`: `key`, `title`, `content` (для SSR — лениво, `content: () => <… />`), `truncate` (обрезать длинный заголовок одной строкой), `disabled`.

### `AccordionSelectionMode`

`type AccordionSelectionMode = "single" | "multiple"` — режим выбора.

### `AccordionValue`

`type AccordionValue = string | readonly string[]` — `string` для `single`, массив ключей для `multiple`; пустая строка — закрыто.

## Оверлеи

### `Snackbar`

`function Snackbar(props: SnackbarProps): Node` — controlled-снекбар: `role="status"`, таймер автоскрытия создаётся только на клиенте и снимается в `onCleanup`/`dispose()`.

### `SnackbarProps`

`interface SnackbarProps` — пропсы: `open`, `message`, `action`, `onClose`, `autoHideDuration` (по умолчанию 5000; `0`/`null` — не скрывать), `closeLabel`.

### `Dialog`

`function Dialog(props: DialogProps): Node` — модальный диалог на нативном `<dialog>`: `showModal()` после монтирования, Escape/backdrop, focus trap и возврат фокуса. SSR рендерит inline `<dialog open>` без Portal — гидрация не теряет контекст.

### `DialogProps`

`interface DialogProps` — пропсы `Dialog`: `open`, `defaultOpen`, `onOpenChange`, `title`, `description`, `actions`, `closeLabel`, `hideClose`.

### `AlertDialog`

`function AlertDialog(props: AlertDialogProps): Node` — подтверждающий диалог (`role="alertdialog"`): фокус на действиях, backdrop не закрывает, Escape работает как отмена.

### `AlertDialogProps`

`interface AlertDialogProps` — пропсы: `open`, `defaultOpen`, `onOpenChange`, `title`, `description`, `confirmLabel`, `cancelLabel`, `onConfirm`, `onCancel`, `destructive`, `hideCancel`.

### `Sheet`

`function Sheet(props: SheetProps): Node` — боковая/нижняя панель. `modal` (по умолчанию) блокирует фон (`inert` + `aria-hidden`) и запирает фокус; drag-жеста в v1 нет — ручка только affordance.

### `SheetProps`

`interface SheetProps` — пропсы `Sheet`: `open`, `defaultOpen`, `onOpenChange`, `side`, `modal`, `title`, `description`, `actions`, `closeLabel`, `hideClose`.

### `SheetSide`

`type SheetSide = "top" | "right" | "bottom" | "left"` — сторона появления.

### `Drawer`

`function Drawer(props: DrawerProps): Node` — боковая панель. `modal` рендерит скрим, `role="dialog"`/`aria-modal`, ставит `inert`/`aria-hidden` на фон, блокирует прокрутку `body`, запирает фокус и возвращает его на триггер; Escape закрывает через `onOpenChange(false)`. `standard` — часть раскладки: фон и прокрутка не блокируются.

### `DrawerProps`

`interface DrawerProps` — пропсы `Drawer`: `open` (обязателен), `onOpenChange`, `variant`, `side`, `header`, `footer`, `label`, `labelledBy`, `showCloseButton`, `closeOnScrimClick`.

### `DrawerVariant`

`type DrawerVariant = "modal" | "standard"` — модальная панель или часть раскладки.

### `DrawerSide`

`type DrawerSide = "start" | "end"` — сторона.

### `Popover`

`function Popover(props: PopoverProps): Node` — inline-поповер: anchor + абсолютная панель без Portal (SSR-контекст не теряется). На сервере закрыт; закрытие — клик вне и Escape, фокус возвращается на anchor.

### `PopoverProps`

`interface PopoverProps` — пропсы: `trigger`, `children`, `open`, `defaultOpen`, `onOpenChange`, `placement`, `label`, `disabled`.

### `PopoverPlacement`

`type PopoverPlacement = "top" | "bottom" | "start" | "end"` — сторона панели.

### `Menu`

`function Menu(props: MenuProps): Node` — меню с roving tabindex: `role="menu"`, стрелки/Home/End/Enter/Escape. Панель inline, на сервере закрыта и открывается после mount.

### `MenuProps`

`interface MenuProps` — пропсы `Menu`: `trigger`, `open`, `defaultOpen`, `onOpenChange`, `label`, `disabled`.

### `MenuItem`

`function MenuItem(props: MenuItemProps): Node` — пункт меню: `role="menuitem"`, roving tabindex, `disabled`, `onSelect`.

### `MenuItemProps`

`interface MenuItemProps` — пропсы пункта: `disabled`, `leading`, `trailing`, `onSelect`.

### `MenuSeparator`

`function MenuSeparator(props: MenuSeparatorProps): Node` — разделитель пунктов меню.

### `MenuSeparatorProps`

`interface MenuSeparatorProps` — пропсы разделителя (`class`, `style`, `attrs`).

### `Tooltip`

`function Tooltip(props: TooltipProps): Node` — тултип на hover/focus: на сервере не всплывает, на touch не показывается. `aria-describedby` ставится только на видимую подсказку.

### `TooltipProps`

`interface TooltipProps` — пропсы: `content`, `placement`, `delay` (по умолчанию 500 мс), `disabled`.

### `TooltipPlacement`

`type TooltipPlacement = "top" | "bottom" | "start" | "end"` — сторона подсказки.

## Навигация

### `Tabs`

`function Tabs(props: TabsProps): Node` — вкладки WAI-ARIA: roving tabindex, Arrow/Home/End, `aria-selected` и `aria-controls`/`aria-labelledby`. Управляемый (`value`) и неуправляемый (`defaultValue`) режимы; панели ленивые по умолчанию.

### `TabsProps`

`interface TabsProps` — пропсы: `items`, `value`, `defaultValue`, `onValueChange`, `orientation`, `activationMode`, `size`, `lazy`, `id`, `label`, `labelledBy`.

### `TabList`

`function TabList(props: TabListProps): Node` — контейнер вкладок с `role="tablist"`.

### `TabListProps`

`interface TabListProps` — пропсы списка: `orientation`, `label`, `labelledBy`.

### `Tab`

`function Tab(props: TabProps): Node` — вкладка: roving tabindex, выбранная `0`, остальные `-1`. Клавиатурную навигацию обычно задаёт `Tabs` через `onKeyDown`.

### `TabProps`

`interface TabProps` — пропсы вкладки: `selected`, `tabId`, `panelId`, `disabled`, `onSelect`, `onKeyDown`.

### `TabPanel`

`function TabPanel(props: TabPanelProps): Node` — панель вкладки: обёртка существует всегда (валидный `aria-controls`), содержимое при `lazy` монтируется только для активной вкладки.

### `TabPanelProps`

`interface TabPanelProps` — пропсы панели: `active`, `panelId`, `tabId`, `lazy`.

### `TabItem`

`interface TabItem` — одна вкладка: `key`, `label`, `content` (для SSR/hydration передавайте лениво — `content: () => <…/>`), `disabled`.

### `TabsOrientation`

`type TabsOrientation = "horizontal" | "vertical"` — ориентация.

### `TabsActivationMode`

`type TabsActivationMode = "automatic" | "manual"` — стрелки активируют вкладку сразу или только фокусируют.

### `TabsSize`

`type TabsSize = "sm" | "md" | "lg"` — высота вкладок: компактная, обычная, крупная.

### `TopAppBar`

`function TopAppBar(props: TopAppBarProps): Node` — верхняя панель: small/medium/large, слоты `leading`/`actions`, подъём при прокрутке (`elevated` передаёт приложение), `sticky`, safe-area.

### `TopAppBarProps`

`interface TopAppBarProps` — пропсы: `title`, `titleLevel`, `variant`, `leading`, `actions`, `actionsLabel` (доступное имя группы actions), `elevated`, `sticky`, `safeArea`.

### `TopAppBarVariant`

`type TopAppBarVariant = "small" | "medium" | "large"` — вариант высоты.

### `NavigationBar`

`function NavigationBar(props: NavigationBarProps): Node` — нижняя навигация мобильного приложения: 3–5 пунктов, видимые подписи, бейджи, `aria-current` у выбранного.

### `NavigationBarProps`

`interface NavigationBarProps` — пропсы: `items`, `value`, `defaultValue`, `onValueChange`, `label`, `safeArea`.

### `NavigationBarItem`

`function NavigationBarItem(props: NavigationBarItemProps): Node` — пункт нижней навигации: `<li>` со ссылкой при `href`, иначе кнопка; выбранный получает `aria-current="page"`.

### `NavigationBarItemProps`

`interface NavigationBarItemProps` — пропсы пункта: `label`, `icon`, `selected`, `badge`, `badgeLabel`, `disabled`, `href`, `onClick`.

### `NavigationBarItemData`

`interface NavigationBarItemData` — данные пункта для `items`: `key`, `label`, ленивый `icon`/`badge` для SSR, `href`, `disabled`, `onClick`.

### `NavigationRail`

`function NavigationRail(props: NavigationRailProps): Node` — боковая навигация планшета/десктопа: свёрнутая (иконки) и развёрнутая (иконки + подписи), слот FAB, `aria-current`.

### `NavigationRailProps`

`interface NavigationRailProps` — пропсы: `items`, `value`, `defaultValue`, `onValueChange`, `expanded`, `fab`, `label`.

### `NavigationRailItem`

`function NavigationRailItem(props: NavigationRailItemProps): Node` — пункт рейла. Подпись всегда в DOM; в свёрнутом рейле её визуально скрывает CSS, поэтому скринридер читает пункт одинаково.

### `NavigationRailItemProps`

`interface NavigationRailItemProps` — пропсы пункта: `label`, `icon`, `selected`, `badge`, `badgeLabel`, `disabled`, `href`, `onClick`.

### `NavigationRailItemData`

`interface NavigationRailItemData` — данные пункта для `items`: `key`, `label`, ленивый `icon`/`badge`, `href`, `disabled`, `onClick`.

### `Breadcrumbs`

`function Breadcrumbs(props: BreadcrumbsProps): Node` — хлебные крошки: `nav` + `ol`, разделители, `aria-current="page"` у последнего пункта. Сворачивание — только через `maxItems`.

### `BreadcrumbsProps`

`interface BreadcrumbsProps` — пропсы: `items`, `maxItems`, `separator`, `label`.

### `BreadcrumbItem`

`function BreadcrumbItem(props: BreadcrumbItemProps): Node` — пункт крошек: ссылка при `href`, иначе текст с `aria-current`.

### `BreadcrumbItemProps`

`interface BreadcrumbItemProps` — пропсы пункта: `href`, `current`, `icon`, `separator`, `showSeparator`, `onClick`.

### `BreadcrumbItemData`

`interface BreadcrumbItemData` — данные пункта для `items`: `key`, `label`, `href`, ленивый `icon`, `onClick`.

### `Pagination`

`function Pagination(props: PaginationProps): Node` — постраничная навигация: номер страницы, `siblingCount`, многоточия, стрелки, `aria-current="page"`, RU-подписи из `UiConfigProvider`.

### `PaginationProps`

`interface PaginationProps` — пропсы: `page`, `pageCount`, `onChange`, `siblingCount`, `disabled`, `label`.

### `PaginationToken`

`type PaginationToken = number | "ellipsis-start" | "ellipsis-end"` — элемент диапазона.

### `paginationRange`

`function paginationRange(page: number, pageCount: number, siblingCount?: number): PaginationToken[]` — диапазон страниц с многоточиями. Первая и последняя видны всегда, число кнопок стабильно: `2 * siblingCount + 5`.

### `SearchField`

`function SearchField(props: SearchFieldProps): Node` — `input[type=search]` с иконкой поиска, кнопкой очистки (RU `Очистить`) и Enter → `onSearch`. Дебаунса нет: политика задержки — решение потребителя.

### `SearchFieldProps`

`interface SearchFieldProps` — пропсы `SearchField`, включая `value`/`onValueChange`, `onSearch`, `onClear`, `field`, `label`, `size`, `bare`, `clearLabel`.

## Формы

Формы используют `field` из `@ivlev-dev/silent-form`: `field` — **источник** значения, подписи, подсказки, ошибки и событий; явно переданные пропсы контрола — **overrides**. Spread `{...field}` не применяется: контрол читает конкретные свойства (`field.value`, `field.error`, …) и подписывается на них через JSX. DOM-`id` детерминирован (`id` → `name` → стабильный fallback), поэтому SSR и клиент дают одинаковую разметку; `field` опционален — без него контрол работает на явных пропсах.

`@ivlev-dev/silent-form` — optional peer: типы `field`/`FieldArray` ссылаются на него, но рантайм UI-пакета его не импортирует.

### `Field`

`function Field(props: FieldProps): Node` — обёртка поля: подпись, подсказка, ошибка и слот контрола. `Field` не знает о контроле: `htmlFor`/`id` передаёт вызывающий, а `aria-describedby`/`aria-invalid` ставит сам контрол. Подсказка и ошибка получают id `<id>-hint`/`<id>-error`. `validating` переводит подпись и сообщения в статус асинхронной проверки.

### `FieldProps`

`interface FieldProps` — пропсы `Field`: `id`, `htmlFor`, `label`, `hint`, `error`, `required`, `invalid`, `touched`, `disabled`, `validating`, `bare`.

### `FieldGroup`

`function FieldGroup(props: FieldGroupProps): Node` — группа полей: `fieldset`/`legend`, общая подсказка и блокировка.

### `FieldGroupProps`

`interface FieldGroupProps` — пропсы: `legend`, `hint`, `layout`, `columns` (`1`/`2`/`3`/`auto`; 2/3 дают 1 колонку на мобильном, 2 на ≥600px, 3 на ≥840px), `maxWidth` (`none`/`narrow`/`default` — удобная мера строки), `disabled`.

### `FieldGroupLayout`

`type FieldGroupLayout = "stack" | "inline"` — раскладка группы.

### `FormActions`

`function FormActions(props: FormActionsProps): Node` — подвал формы: submit/reset или свой слот `actions`. `loading` блокирует оба действия (`Button` ставит `aria-busy`); `sticky` прижимает подвал к нижней кромке скроллящегося диалога/страницы.

### `FormActionsProps`

`interface FormActionsProps` — пропсы: `actions`, `submitLabel`, `resetLabel`, `submit`, `reset`, `loading`, `disabled`, `align`, `sticky`, `onSubmit`, `onReset`.

### `FormActionsAlign`

`type FormActionsAlign = "start" | "end" | "between"` — выравнивание действий.

### `TextField`

`function TextField(props: TextFieldProps): Node` — однострочное поле. `field` — источник значений и ошибок, явные пропсы — overrides. Значение пишется в DOM через `bindValue`, поэтому программное изменение формы не требует перерендера контрола.

### `TextFieldProps`

`interface TextFieldProps` — пропсы: `type`, `value`, `field`, `label`, `hint`, `error`, `placeholder`, `size`, `leading`, `trailing`, `passwordToggle`, `bare`.

### `TextFieldType`

`type TextFieldType = "text" | "email" | "password" | "number" | "search" | "tel" | "url"` — нативный тип.

### `Textarea`

`function Textarea(props: TextareaProps): Node` — многострочное поле. Авто-высоты нет: `rows` фиксирует высоту одинаково на сервере и клиенте, поэтому гидрация не «прыгает».

### `TextareaProps`

`interface TextareaProps` — пропсы: `value`, `field`, `label`, `hint`, `error`, `rows`, `resize`, `counter`, `maxLength`, `bare`.

### `TextareaResize`

`type TextareaResize = "none" | "vertical" | "horizontal" | "both"` — CSS `resize`.

### `RichTextEditor`

`function RichTextEditor(props: RichTextEditorProps): Node` — WYSIWYG-редактор без сторонних библиотек и без `document.execCommand`: форматирование и история работают на `Range`/DOM. `value` — controlled-HTML, `defaultValue` — uncontrolled; `field` из `@ivlev-dev/silent-form` даёт значение, подпись, подсказку, ошибку и `onChange`, а явные пропсы его перекрывают. `onValueChange` получает уже санитизированный HTML при вводе, командах и вставке; `onChange` — синтетическое событие с `target.value` (HTML) и `target.type = "text"`. Блочные команды (`h1`–`h3`, `paragraph`, `blockquote`, `code`, `align-*`, `ul`/`ol`, `clear`) применяются ко всем блокам, пересекающим выделение, а не только к текущему. `indent`/`outdent` управляют вложенностью списков: `Tab`/`Shift+Tab` внутри `li` работают как эти команды. `toolbar` по умолчанию показывает полный набор команд, `false` убирает панель, массив оставляет только перечисленные пункты (`"|"` — разделитель). `readOnly` запрещает правки, но сохраняет значение и отправку формы; `disabled` убирает редактор из tab-порядка и отключает скрытый input. `minHeight`/`maxHeight` задают пиксели контентной области (по умолчанию минимум — примерно три строки контрола `lg`, максимум не ограничен). `placeholder` рисуется CSS-псевдоэлементом, пока контент пуст. Без `id`/`name` каждый экземпляр получает детерминированный `useId("sui-rte")`, поэтому несколько редакторов на странице не конфликтуют.

SSR отдаёт пустую контентную область: HTML не попадает в `contenteditable` ни в серверную разметку, ни в гидрацию, иначе браузер нормализовал бы DOM и дал mismatch. Начальное значение живёт в скрытом `input[type=hidden]` (`name` = `name` → `field.name` → `id`) и подставляется в редактор после монтирования: санитизация → `innerHTML` → восстановление каретки; готовность отмечают `data-mounted` на рамке и `data-ready` на области. На сервере скрытый input содержит исходное значение как значение атрибута; после монтирования значение санитизируется. Внешний `value` применяется только когда фокус вне редактора (иначе — после `blur`), поэтому набор текста не затирается. `reset` формы возвращает `defaultValue`, если редактор не в фокусе.

Безопасность: санитайз включён всегда и не отключается пропсом — он прогоняет входное значение (`value`/`defaultValue`/`field`), результат, скрытый input, paste и drop. Разрешён узкий allowlist: `p`, `br`, `strong`/`b`, `em`/`i`, `u`, `s`/`del`, `code`, `pre`, `blockquote`, `h1`–`h3`, `ul`/`ol`/`li` (включая вложенные списки), `a`, `hr`; `data-align` допустим только на блоках. Неизвестные контейнеры разворачиваются, опасные элементы (`script`, `style`, `iframe`, `img`, `svg`, `video`, поля формы) удаляются вместе с содержимым. У ссылок разрешены схемы `http`/`https`/`mailto`/`tel`, относительные адреса, якоря и query; `target` — только `_self`/`_blank`, для `_blank` принудительно ставится `rel="noopener noreferrer"`. Paste и drop санитизируются по тому же allowlist, а plain text экранируется и разбивается на абзацы. Во время IME-композиции DOM не перестраивается и снапшоты не создаются; финальное значение и история фиксируются на `compositionend`.

### `RichTextEditorProps`

`interface RichTextEditorProps` — пропсы: `value`, `defaultValue`, `field`, `onChange`, `onValueChange`, `onBlur`, `label`, `hint`, `error`, `placeholder`, `name`, `id`, `required`, `readOnly`, `disabled`, `invalid`, `toolbar`, `minHeight`, `maxHeight`, `class`, `style`, `attrs`. `invalid` можно не задавать: непустой `error` сам переводит поле в `aria-invalid`. Подпись, hint и error связываются с областью `role="textbox"` через `aria-labelledby`/`aria-describedby`; без подписи доступное имя берётся из `placeholder`, иначе — «Текст».

### `RichTextCommand`

`type RichTextCommand` — команда тулбара и клавиатуры: `"bold"`, `"italic"`, `"underline"`, `"strike"`, `"h1"`, `"h2"`, `"h3"`, `"paragraph"`, `"ul"`, `"ol"`, `"indent"`, `"outdent"`, `"blockquote"`, `"code"`, `"link"`, `"unlink"`, `"align-left"`, `"align-center"`, `"align-right"`, `"undo"`, `"redo"`, `"clear"`. `indent` вкладывает текущий `li` в предыдущий sibling, `outdent` поднимает его на уровень выше и сохраняет порядок; в списке эти же действия доступны по `Tab`/`Shift+Tab`. Блочные команды применяются ко всем блокам выделения. `link` открывает inline-панель адреса (для `http(s)` ссылка получает `target="_blank"` и `rel="noopener noreferrer"`), `undo`/`redo` ходят по снапшотам HTML и каретки, `clear` снимает inline-форматирование, выравнивание, списки и заголовки/цитаты, возвращая выбранные блоки к обычным абзацам. Горячие клавиши: `Ctrl/Cmd+B`/`I`/`U`, `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z` и `Ctrl/Cmd+Y`, `Enter` — новый абзац, `Shift+Enter` — `<br>`, `Tab` — вложенность списка или табуляция, `Shift+Tab` — outdent списка, `Escape` — закрыть панель ссылки или выйти из редактора.

### `ToolbarItem`

`type ToolbarItem = RichTextCommand | "|"` — пункт панели: команда или разделитель `"|"`, который рендерится как `role="separator"` с вертикальной ориентацией. Массив `toolbar` задаёт состав и порядок кнопок; команда `link` дополнительно отражает состояние панели через `aria-expanded`/`aria-controls`.

### `Select`

`function Select(props: SelectProps): Node` — список. SSR-разметка строится `.map()` по начальному `options` (без `For`/`KeyedList`: маркеры списка недопустимы парсером внутри `<select>`), у выбранных `option` стоит `selected`. На клиенте `options` реконсилируются реактивно: изменение `props.options` обновляет существующие `<option>`, добавляет/удаляет недостающие, сохраняет порядок, `disabled` и текст, а placeholder остаётся первым. После реконсиляции выбранное значение восстанавливается из `value`/`field.value` (включая `multiple`); `bindValue` работает с `NO_WRITE`, поэтому состояние формы не перезаписывается. `<select>` при этом не пересоздаётся.

### `SelectProps`

`interface SelectProps` — пропсы: `options`, `value`, `field`, `label`, `hint`, `error`, `placeholder`, `multiple`, `size`, `bare`.

### `SelectOption`

`interface SelectOption` — опция: `value`, `label`, `disabled`.

### `Checkbox`

`function Checkbox(props: CheckboxProps): Node` — чекбокс с необязательным `indeterminate`, описанием и связкой с `field`.

### `CheckboxProps`

`interface CheckboxProps` — пропсы: `checked`, `field`, `label`, `description`, `hint`, `error`, `indeterminate`, `name`, `disabled`, `readOnly`.

### `RadioGroup`

`function RadioGroup(props: RadioGroupProps): Node` — группа радиокнопок: `fieldset`/`legend`, `field` и roving tabindex. Стрелки/Home/End двигают фокус и выбор по включённым пунктам.

### `RadioGroupProps`

`interface RadioGroupProps` — пропсы: `options`, `field`, `value`, `label`, `hint`, `error`, `name`, `required`, `readOnly`.

### `RadioOption`

`interface RadioOption` — опция: `value`, `label`, `description`, `disabled`.

### `Switch`

`function Switch(props: SwitchProps): Node` — переключатель: нативный `input[type=checkbox]` с `role="switch"`; Space и фокус работают штатно, `aria-checked` выводится из `checked`.

### `SwitchProps`

`interface SwitchProps` — пропсы: `checked`, `field`, `label`, `description`, `hint`, `error`, `name`, `id`, `required`, `disabled`, `readOnly`, `size` (`sm`/`md`/`lg`), `describedBy`, `onChange`, `onBlur`, `onFocus`.

### `Slider`

`function Slider(props: SliderProps): Node` — ползунок: `range` + `<output>`, значение синхронизируется через `bindValue`; `formatValue` задаёт `aria-valuetext`.

### `SliderProps`

`interface SliderProps` — пропсы: `min`, `max`, `step`, `value`, `field`, `label`, `unit`, `formatValue`, `output`.

### `FileField`

`function FileField(props: FileFieldProps): Node` — скрытый `input[type=file]` + доступный триггер. При размонтировании активная загрузка отменяется (`AbortSignal`), `input.value` сбрасывается, чтобы тот же файл можно было выбрать снова.

### `FileFieldProps`

`interface FileFieldProps` — пропсы: `accept`, `multiple`, `value`, `field`, `label`, `hint`, `error`, `progress`, `chooseLabel`, `onFiles`.

### `FileSelectionContext`

`interface FileSelectionContext` — контекст выбора файлов: `signal` (`AbortSignal`), отменяется при размонтировании.

### `FieldArray`

`function FieldArray<T extends Form>(props: FieldArrayProps<T>): Node` — повторяемая группа полей поверх `FormArray`. Ключ строки — сам элемент формы, поэтому `add`/`remove`/`move` не пересоздают контролы и не теряют фокус. `FormArray.items` не сигнал: UI-операции помечаются локальной ревизией, чтобы `For` пересобрал строки.

### `FieldArrayProps`

`interface FieldArrayProps<T extends Form>` — пропсы: `array`, `children`, `keyOf`, `label`, `hint`, `addLabel`, `removeLabel`, `moveUpLabel`, `moveDownLabel`, `min`, `max`, `allowMove`, `onAdd`, `onRemove`, `onMove`.
