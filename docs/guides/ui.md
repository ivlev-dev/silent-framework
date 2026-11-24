# UI и дизайн-система

`@ivlev-dev/silent-ui` — дизайн-система Silent Framework: токены, темы, layout-примитивы, типографика, компоненты, формы, иконки и Storybook. Пакет поставляется **precompiled**: TSX собран `@ivlev-dev/silent-swc` в `dist`, поэтому библиотека работает и в Vite-приложении, и в Node-SSR без дополнительной компиляции.

Справочник по каждому экспорту — [`docs/api/ui.md`](../api/ui.md).

## Установка

```bash
pnpm add @ivlev-dev/silent-ui @ivlev-dev/silent-core @ivlev-dev/silent-reactivity
# для field={form.getFieldProps(...)} и FieldArray:
pnpm add @ivlev-dev/silent-form
```

`@ivlev-dev/silent-core` и `@ivlev-dev/silent-reactivity` — обязательные peer-зависимости (`>=0.14.0 <0.15.0`). `@ivlev-dev/silent-form` — optional peer: типы `field` и `FieldArray` ссылаются на него, но рантайм UI-пакета его не импортирует.

```tsx
import { Button, Stack, Heading, Text } from "@ivlev-dev/silent-ui";
import "@ivlev-dev/silent-ui/styles.css";
```

## CSS: только отдельным входом

CSS **нельзя** импортировать из JS-модулей пакета: Node-SSR упадёт на `import "./button.css"`. Стили подключаются отдельными входами:

```ts
// Приложение: всё сразу (reset + токены + темы + base + layout + компоненты + формы)
import "@ivlev-dev/silent-ui/styles.css";

// Или точечно
import "@ivlev-dev/silent-ui/base.css";    // reset + tokens + themes + base
import "@ivlev-dev/silent-ui/themes.css";  // tokens + цветовые роли light/dark/auto
import "@ivlev-dev/silent-ui/layout.css";  // layout-примитивы
import "@ivlev-dev/silent-ui/form.css";    // контролы и обёртки форм
import "@ivlev-dev/silent-ui/button.css";  // отдельный компонент
```

| Вход | Содержимое |
| --- | --- |
| `styles.css` | полный набор слоёв: reset + tokens + themes + base + layout + все компоненты + формы |
| `base.css` | reset + tokens + themes + base, без layout и компонентов |
| `themes.css` | tokens + цветовые роли light/dark/auto |
| `tokens.css` | нецветовые токены: типографика, отступы, радиусы, elevation, motion, плотность |
| `reset.css` | минимальный reset |
| `layout.css` | `Box`/`Stack`/`Inline`/`Grid`/`Container`/`Surface`/`Divider` |
| `form.css` | все контролы и обёртки форм |
| `<component>.css` | CSS одного компонента: `button.css`, `dialog.css`, `table.css`, `search-field.css`, … |

Важно: отдельные CSS-входы есть у компонентов из `components/` (они лежат в `dist/components/<name>/<name>.css`). У контролов форм отдельного `<control>.css` нет — подключайте `form.css` (или `styles.css`). Сабпуть `form.css` — единственный публичный CSS-вход для форм.

Порядок слоёв фиксирован и объявляется первым файлом:

```css
@layer sui.reset, sui.tokens, sui.base, sui.layout, sui.components, sui.overrides;
```

Селекторы дизайн-системы обёрнуты в `:where()`, поэтому переопределения в `@layer sui.overrides` выигрывают без войны со специфичностью.

## Темы

Тема ставится атрибутом `data-theme="light|dark|auto"` на `<html>` (или любой контейнер — тема наследуется поддеревом). Без атрибута действует светлая тема; при `prefers-color-scheme: dark` и отсутствии `data-theme="light"` — тёмная.

```ts
import { applyTheme, readStoredTheme, resetThemePalette } from "@ivlev-dev/silent-ui";

applyTheme({ theme: "dark" });
applyTheme({ theme: "auto", persist: true });                        // системная, выбор запоминается
applyTheme({ theme: "light", palette: { primary: "#0F766E" } });     // брендовая перекраска
applyTheme({ theme: "dark", root: panelElement });                   // тема поддерева
```

- `applyTheme` пишет `data-theme`, inline-переменные `--sui-color-<role>` для `palette` и при `persist` сохраняет выбор в `localStorage` (ключ `sui-theme`).
- `readStoredTheme()` возвращает сохранённое значение или `null`; `resetThemePalette()` снимает inline-переопределения.
- Без DOM все три функции — no-op, поэтому безопасны в SSR.
- `data-palette` зарезервирован под будущие палитры. Сейчас палитра одна (ivory/almond/mist/navy/noir/gold), перекраска — только через `palette`/`--sui-color-*`.

### SSR без вспышки светлой темы

```tsx
import { ThemeScript } from "@ivlev-dev/silent-ui";

<html lang="ru">
  <head>
    <ThemeScript nonce={cspNonce} defaultTheme="auto" storageKey="sui-theme" />
  </head>
  <body>{content}</body>
</html>
```

`ThemeScript` — единственный компонент, который пишет в DOM `<script>`: он ставит `data-theme` до первой отрисовки. `themeScriptSource(defaultTheme?, storageKey?)` даёт тот же исходник для ручной вставки в `<head>`. Если нужен `theme-color` для мобильных браузеров, пакет его не управляет: добавьте `<meta name="theme-color">` и обновляйте `content` после `applyTheme()` из токена поверхности.

```ts
applyTheme({ theme: "dark" });
const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
meta?.setAttribute(
  "content",
  getComputedStyle(document.documentElement).getPropertyValue("--sui-color-surface").trim(),
);
```

### Строки интерфейса

```tsx
import { UiConfigProvider } from "@ivlev-dev/silent-ui";

<UiConfigProvider strings={{ loading: "Загружаем" }} locale="ru-RU" theme="dark" density="compact">
  <App />
</UiConfigProvider>
```

Провайдер рендерит `display: contents`-контейнер, ставит `data-theme`/`data-density` на поддерево и дополняет строки значениями по умолчанию. RU-строки: `Закрыть`, `Загрузка`, `Показать пароль`, `Скрыть пароль`, `Обязательное поле`, `Добавить`, `Удалить`, `Переместить выше`, `Переместить ниже`, `Сохранить`, `Сбросить`, `Выбрать файл`, `Основная навигация`, `Действия`, `Хлебные крошки`, `Постраничная навигация`, `Назад`, `Вперёд`, `Страница {page} из {pageCount}`, `Поиск`, `Очистить`, `По возрастанию`, `По убыванию`, `Нет данных`. `useUiConfig()` читает конфигурацию; без провайдера возвращаются значения по умолчанию (в том числе в SSR).

## Палитра и кастомизация

Базовая палитра — тёплая бумага, приглушённый mist и глубокий navy с золотом:

| Имя | HEX | Назначение |
| --- | --- | --- |
| ivory | `#F9F8F7` | светлая surface, текст на navy |
| almond | `#EDEAE4` | контейнеры и dim-поверхности |
| mist | `#ADB8BB` | secondary в тёмной теме, outline-семейство |
| navy | `#153147` | primary light, inverse-surface |
| noir | `#232A2F` | основной текст light |
| gold | `#CEA434` | accent/tertiary, золотые CTA и хайлайты |
| navy-mid | `#122948` | тёмный container-low |
| navy-deep | `#193153` | тёмный container-high |
| navy-dark | `#0E1F33` | surface тёмной темы |
| white | `#FFFFFF` | светлые контейнеры и on-secondary |

Ключевые семантические роли:

| Роль | light | dark |
| --- | --- | --- |
| `surface` | `#F9F8F7` | `#0E1F33` |
| `surface-container` | `#F3F0EA` | `#153147` |
| `on-surface` | `#232A2F` | `#F9F8F7` |
| `on-surface-variant` | `#42505A` | `#C3CED2` |
| `primary` | `#153147` | `#E6C766` |
| `on-primary` | `#F9F8F7` | `#1A1405` |
| `primary-container` | `#DCE3E3` | `#153147` |
| `secondary` | `#4C5D68` | `#ADB8BB` |
| `accent` / `on-accent` | `#CEA434` / `#232A2F` | `#E6C766` / `#1A1405` |
| `outline` | `#6F7D80` | `#7E8C8F` |
| `error` | `#A8322A` | `#F2B8B5` |
| `success` | `#1F6B45` | `#8FD3A8` |
| `warning` | `#7A5200` | `#E8C56A` |

`accent`/`on-accent` — отдельная пара для золотых кнопок и хайлайтов; имена прежних ролей сохранены. Полный набор (`primary-fixed*`, `surface-container-*`, `inverse-*`, `scrim`, `shadow` и контейнеры состояний) раскладывается в `lightColors`/`darkColors` и `themes.css`. Все пары текст/фон проходят WCAG AA (4.5:1; `outline` на поверхностях и focus ring — 3:1), контраст проверяется unit-тестом.

Состояния используют прозрачные слои поверх `currentColor` (hover `0.08`, focus/pressed `0.12`, dragged `0.16`); focus ring — 2px с offset 2px, navy в светлой теме и gold в тёмной. Selection — золото с noir-текстом, scrim — глубокий navy/noir.

Три уровня кастомизации:

1. **Токены** — переопределите `--sui-color-*`, `--sui-space-*`, `--sui-radius-*`, `--sui-density` на `:root` или контейнере.
2. **Компонентные переменные** — точечные `--sui-*` из CSS компонента (например, высота контрола) и `class`/`attrs` на экземпляре.
3. **Слой** — `@layer sui.overrides { … }` гарантированно выигрывает у компонентов.

```css
@layer sui.overrides {
  .brand-cta {
    --sui-control-height-md: 3rem;
    border-radius: var(--sui-radius-full);
  }
}
```

## Брейкпоинты

Источник истины — `packages/ui/src/tokens/breakpoints.json`. Тест сверяет JSON, TS-модуль, CSS-переменные, media-литералы в `layout.css` и эту таблицу.

| Имя | px | em | Назначение |
| --- | --- | --- | --- |
| `xs` | 0 | 0 | mobile-first база |
| `sm` | 360 | 22.5em | крупный телефон |
| `md` | 480 | 30em | телефон landscape |
| `lg` | 600 | 37.5em | планшет портрет |
| `xl` | 840 | 52.5em | планшет landscape |
| `2xl` | 1200 | 75em | ноутбук |
| `3xl` | 1600 | 100em | десктоп |
| `4xl` | 1920 | 120em | Full HD |
| `5xl` | 2560 | 160em | QHD |
| `6xl` | 3840 | 240em | 4K |

```ts
import { mediaUp, mediaDown } from "@ivlev-dev/silent-ui/tokens";

mediaUp("md");   // "(min-width: 30em)"
mediaDown("md"); // "(max-width: 29.9375em)"
mediaUp("xs");   // null — ограничение не нужно
```

Стили mobile-first: базовые правила действуют всегда, расширения — через `@media (min-width: …)`. Гуттеры: 16/24 на мобильном, 24/32 на планшете, 32/48 на десктопе; `--sui-content-max` растёт до 2400px на 4K, а `--sui-content-wide-max` — до 2600px, при этом кегль не «уезжает» в бесконечность. Единицы — `rem`, иконки — SVG, границы — hairline `1px` (`--sui-hairline` = `0.5px` на high-DPI). Текст ограничивается мерой `--sui-measure: 68ch` / `--sui-measure-narrow: 52ch`. TV-профиль (10-foot UI) в v1 не проектировался: токены совместимы со старыми WebView, но отдельного TV-набора нет.

Адаптивы компонентов: `FieldGroup.columns={2|3}` даёт 1 колонку на мобильном, 2 на `≥600px` и 3 на `≥840px` (`auto` — auto-fit по минимальной ширине); `FieldGroup.maxWidth` ограничивает меру формы. `Table` рендерит корень `.sui-table-scroll` и скроллит широкую таблицу по горизонтали, не ломая страницу. `Grid`/`Inline` переносятся по `wrap`, `TopAppBar` учитывает `safe-area-inset-top`, а `NavigationBar` — нижний safe-area. Touch targets контролов — 44px (`md`) и 48px (`lg`/cozy), поэтому плотные раскладки не уменьшают цель нажатия ниже 44px.

## Layout и типографика

Все примитивы CSS-only: один корень, статические классы `sui-*`, варианты — `data-*`. Пропса `as` нет.

```tsx
import { Box, Stack, Inline, Grid, Container, Surface, Divider } from "@ivlev-dev/silent-ui/layout";

<Container size="wide">
  <Stack gap={4}>
    <Inline gap={2} wrap>
      <Button>Сохранить</Button>
      <Button variant="text">Отмена</Button>
    </Inline>
    <Grid columns={3} gap={3}>
      <Surface tone="surface-container" padding={4} radius="md" elevation={1}>…</Surface>
    </Grid>
    <Divider />
  </Stack>
</Container>;
```

| Компонент | Пропсы |
| --- | --- |
| `Box` | `padding`, `background`, `border`, `radius`, `elevation` |
| `Stack` | `gap`, `align`, `justify` |
| `Inline` | `gap`, `align`, `justify`, `wrap` |
| `Grid` | `columns` (1–12 или `auto`), `gap`, `min` |
| `Container` | `size` (`content`/`wide`/`full`), `gutter` |
| `Surface` | `tone`, `padding`, `border`, `radius`, `elevation` |
| `Divider` | `orientation`, `inset` |

У всех — `class`, `style`, `attrs` (произвольные `data-*`/`aria-*`). `attrs` применяется runtime-хелпером компилятора, геттеры пропсов не снимаются снимком.

```tsx
import { Heading, Text, Label, Icon } from "@ivlev-dev/silent-ui";

<Heading level={1}>Заголовок</Heading>
<Text tone="muted" variant="body-small">Пояснение</Text>
<Label for="email" required>Email</Label>
<Icon size="md" label="Поиск"><path d="…" /></Icon>;
```

`Heading` задаёт тег уровнем 1–6 и позволяет переопределить размер через `variant`, не ломая структуру. `Text` — `variant`/`tone`/`align`/`clamp` (1–4 строки), `truncate` (одна строка с многоточием) и `measure` (мера строки 68ch). `Label` — `for`/`variant`/`tone`/`disabled`/`required`, `uppercase` для подписей секций (осознанно, не по умолчанию).

### Типографика, форма и переполнение

- `--sui-font-display` — редакционный serif (`Iowan Old Style`, `Palatino`, `Georgia`) для display/headline; `--sui-font-sans` — Inter/system для UI и body; `--sui-font-mono` — код.
- Type scale остаётся fluid, но с верхней границей на 4K. Display/headline используют serif-семейство, title/body/label — sans. Основной body — не меньше 16px (`body-medium` = 17px, `body-small` = 16px), длинный текст — `--sui-measure: 68ch` / `--sui-measure-narrow: 52ch`.
- Радиусы: `xs 4`, `sm 8`, `md 12`, `lg 16`, `xl 24`, `full 999`; не всё — pill. Семантические `--sui-radius-card` (16), `--sui-radius-dialog`/`--sui-radius-sheet` (24), `--sui-radius-control` (8).
- Touch targets: `--sui-touch-target: 2.75rem` (44px), `--sui-touch-target-cozy: 3rem` (48px); `control-height-md` = 44px.
- Motion сдержанный: `--sui-motion-fast` 120ms, `--sui-motion-base` 180ms, `--sui-motion-slow` 240ms, `--sui-easing-editorial`; при `prefers-reduced-motion` анимации отключаются.
- Утилиты переполнения: `.sui-truncate` (ellipsis), `.sui-clamp-2`/`.sui-clamp-3` (line-clamp), `.sui-scroll-x`, `.sui-break-words`, `.sui-measure`, `.sui-measure-narrow`. У детей `Stack`/`Inline`/`Grid` стоит `min-inline-size: 0`, у контейнера — `max-inline-size` и safe-area.

## Формы

```tsx
import { Field, Form, Label, Required } from "@ivlev-dev/silent-form";
import { Checkbox, FormActions, Select, Textarea, TextField } from "@ivlev-dev/silent-ui";

class ProfileForm extends Form {
  @Field() @Label("Имя") @Required() public accessor name = "";
  @Field() @Label("Email") @Required() public accessor email = "";
  @Field() @Label("О компании") public accessor bio = "";
  @Field() @Label("Роль") public accessor role = "user";
  @Field() @Label("Согласие") public accessor consent = false;
}

const form = new ProfileForm();
const roles = [{ value: "user", label: "Пользователь" }, { value: "admin", label: "Администратор" }];

<form>
  <TextField label="Имя" field={form.getFieldProps("name")} required />
  <TextField label="Email" field={form.getFieldProps("email")} type="email" />
  <Textarea label="О компании" field={form.getFieldProps("bio")} rows={4} />
  <Select label="Роль" field={form.getFieldProps("role")} options={roles} />
  <Checkbox label="Согласен" field={form.getFieldProps("consent")} />
  <FormActions submitLabel="Сохранить" onReset={() => form.reset()} />
</form>;
```

`Field` — самостоятельная обёртка для контролов, которых нет в пакете: он рисует подпись/подсказку/ошибку, а связи ARIA ставит ваш контрол.

```tsx
import { Field } from "@ivlev-dev/silent-ui";

<Field id="website" label="Сайт" hint="https://…" error={errors.website}>
  <input id="website" class="my-input" aria-describedby="website-hint" aria-invalid={errors.website ? "true" : undefined} />
</Field>;
```

`FieldArray` работает поверх `FormArray` и требует поля-массива с фабрикой:

```tsx
import { Field, Form, Label } from "@ivlev-dev/silent-form";
import { FieldArray, TextField } from "@ivlev-dev/silent-ui";

class PhoneForm extends Form {
  @Field() @Label("Номер") public accessor number = "";
}

class ContactsForm extends Form {
  @Field({ array: () => new PhoneForm() })
  public accessor phones: PhoneForm[] = [];
}

const contacts = new ContactsForm();

<FieldArray array={contacts.getFieldArray("phones")} label="Телефоны" onAdd={(item) => { /* … */ }}>
  {(item) => <TextField label="Номер" field={item.getFieldProps("number")} />}
</FieldArray>;
```

- `field` — **источник** значения, подписи, подсказки, ошибки и событий; явно переданные пропсы контрола — **overrides**.
- Spread `{...field}` не используется: контрол читает конкретные свойства (`field.value`, `field.error`, `field.isValidating`, …) и подписывается на них. Поэтому не полагайтесь на «проброс» незнакомых пропсов.
- `Field` не знает о контроле: он рисует подпись/подсказку/ошибку, а `aria-describedby`/`aria-invalid` ставит сам контрол. id детерминированы (`<id>-hint`, `<id>-error`), поэтому SSR и клиент совпадают.
- `touched`/`invalid` не скрывают текст ошибки: `error` показывается, как только он передан (в том числе серверный), а `touched` уходит в `data-touched`.
- `Field.validating` переводит подпись и сообщения в статус асинхронной проверки (`data-validating`), не подменяя `error`.
- `FieldGroup` умеет сетку (`columns={1|2|3|"auto"}`) и меру (`maxWidth="narrow"|"default"|"none"`); `FormActions.sticky` прижимает подвал к нижней кромке скроллящегося диалога или страницы, `Switch.size` (`sm`/`md`/`lg`) меняет трек, сохраняя цель нажатия не ниже touch-target.
- `FileField` отдаёт `onFiles(files, { signal })`; интеграция с `uploadField(form, "avatar", file, uploader, { signal })` — на стороне приложения. При размонтировании загрузка отменяется.

```tsx
import { uploadField } from "@ivlev-dev/silent-form";
import { FileField } from "@ivlev-dev/silent-ui";

const uploader = async (file: File) => api.upload(file);

<FileField
  label="Аватар"
  accept="image/*"
  field={form.getFieldProps("avatar")}
  onFiles={(files, { signal }) => {
    const file = files[0];
    if (file !== undefined) {
      void uploadField(form, "avatar", file, uploader, { signal });
    }
  }}
/>;
```

- `FieldArray` строит строки по элементу формы (`keyOf`), поэтому `add`/`remove`/`move` не пересоздают контролы. `FormArray.items` — **не сигнал**: UI-операции помечаются локальной ревизией, чтобы `For` пересобрал список.
- SSR: значения пишутся через `bindValue`, `selected`/`checked` выставляются на сервере, гидрация без mismatch. `Textarea` не авто-растёт: `rows` одинаков на сервере и клиенте.

## Каталог компонентов

### Layout

- `Box` — базовый контейнер с padding/border/radius/elevation. `import { Box } from "@ivlev-dev/silent-ui"`.
- `Stack` — вертикальный flex-поток. `import { Stack } from "@ivlev-dev/silent-ui"`.
- `Inline` — горизонтальный flex-поток с `wrap`. `import { Inline } from "@ivlev-dev/silent-ui"`.
- `Grid` — сетка 1–12 колонок или auto-fit. `import { Grid } from "@ivlev-dev/silent-ui"`.
- `Container` — ограничитель ширины с gutters. `import { Container } from "@ivlev-dev/silent-ui"`.
- `Surface` — поверхность с тоном и тенью. `import { Surface } from "@ivlev-dev/silent-ui"`.
- `Divider` — hairline-разделитель. `import { Divider } from "@ivlev-dev/silent-ui"`.

### Типографика

- `Text` — семантический текст с вариантом и тоном. `import { Text } from "@ivlev-dev/silent-ui"`.
- `Heading` — заголовок h1–h6 с независимым размером. `import { Heading } from "@ivlev-dev/silent-ui"`.
- `Label` — подпись поля с маркером `required`. `import { Label } from "@ivlev-dev/silent-ui"`.
- `Icon` — inline-SVG обёртка. `import { Icon } from "@ivlev-dev/silent-ui"`.
- `Spinner` — индикатор загрузки. `import { Spinner } from "@ivlev-dev/silent-ui"`.

### Иконки

- `CloseIcon`/`DismissIcon`, `CheckIcon`, `MenuIcon`, `SearchIcon`, `LoadingIcon` — базовый набор. `import { SearchIcon } from "@ivlev-dev/silent-ui"`.
- `ChevronDownIcon`/`ChevronUpIcon`/`ChevronStartIcon`/`ChevronEndIcon`, `ArrowBackIcon`/`ArrowForwardIcon`, `ExpandMoreIcon`/`ExpandLessIcon` — навигация и раскрытие. `import { ChevronDownIcon } from "@ivlev-dev/silent-ui"`.
- `MoreVertIcon`/`MoreHorizIcon`, `AddIcon`/`RemoveIcon` — действия. `import { MoreVertIcon } from "@ivlev-dev/silent-ui"`.
- `VisibilityIcon`/`VisibilityOffIcon`, `UploadIcon`/`DownloadIcon`/`RefreshIcon` — служебные. `import { VisibilityIcon } from "@ivlev-dev/silent-ui"`.
- `InfoIcon`/`WarningIcon`/`ErrorIcon`/`SuccessIcon`, `StarIcon`/`StarFilledIcon` — статусы. `import { SuccessIcon } from "@ivlev-dev/silent-ui"`.

Точечный вход: `import { CloseIcon } from "@ivlev-dev/silent-ui/icons/close"`. Все глифы принимают `GlyphProps` (`title`/`label`, `size`).

### Контролы и действия

- `Button` — 6 вариантов × 3 размера, `accent` для золотой CTA, `loading` с `aria-busy`. `import { Button } from "@ivlev-dev/silent-ui"`.
- `IconButton` — круглая кнопка с обязательным `label`, варианты `standard`/`filled`/`accent`/`tonal`/`outlined`, `loading` блокирует нажатия. `import { IconButton } from "@ivlev-dev/silent-ui"`.
- `Fab` — плавающая кнопка, extended и icon-only. `import { Fab } from "@ivlev-dev/silent-ui"`.
- `SegmentedButton` — группа-сегменты с roving tabindex. `import { SegmentedButton } from "@ivlev-dev/silent-ui"`.
- `SearchField` — поиск с очисткой и `onSearch` по Enter. `import { SearchField } from "@ivlev-dev/silent-ui"`.

### Формы

- `Field` — обёртка подписи/подсказки/ошибки. `import { Field } from "@ivlev-dev/silent-ui"`.
- `FieldGroup` — `fieldset`/`legend` с общей подсказкой. `import { FieldGroup } from "@ivlev-dev/silent-ui"`.
- `FormActions` — submit/reset или свой слот действий, `sticky` для скроллящегося подвала. `import { FormActions } from "@ivlev-dev/silent-ui"`.
- `TextField` — однострочное поле, пароль с toggle. `import { TextField } from "@ivlev-dev/silent-ui"`.
- `Textarea` — многострочное поле с `rows`/counter. `import { Textarea } from "@ivlev-dev/silent-ui"`.
- `Select` — нативный select, включая `multiple`. `import { Select } from "@ivlev-dev/silent-ui"`.
- `Checkbox` — чекбокс с `indeterminate`. `import { Checkbox } from "@ivlev-dev/silent-ui"`.
- `RadioGroup` — группа радио с roving tabindex. `import { RadioGroup } from "@ivlev-dev/silent-ui"`.
- `Switch` — переключатель `role="switch"`. `import { Switch } from "@ivlev-dev/silent-ui"`.
- `Slider` — range + `<output>`. `import { Slider } from "@ivlev-dev/silent-ui"`.
- `FileField` — файл с доступным триггером и прогрессом. `import { FileField } from "@ivlev-dev/silent-ui"`.
- `FieldArray` — повторяемая группа полей. `import { FieldArray } from "@ivlev-dev/silent-ui"`.

### Обратная связь

- `Alert` — уведомление info/success/warning/error. `import { Alert } from "@ivlev-dev/silent-ui"`.
- `Progress` — линейный/круговой индикатор. `import { Progress } from "@ivlev-dev/silent-ui"`.
- `Skeleton` — декоративный плейсхолдер; `size` (`sm`/`md`/`lg`) задаёт высоту строки текста. `import { Skeleton } from "@ivlev-dev/silent-ui"`.
- `Snackbar` — controlled-уведомление с автоскрытием. `import { Snackbar } from "@ivlev-dev/silent-ui"`.
- `EmptyState` — пустое состояние с действиями. `import { EmptyState } from "@ivlev-dev/silent-ui"`.

### Данные

- `Card` — карточка, опционально интерактивная; `mediaAspect` (`auto`/`square`/`video`/`wide`/`portrait`) и `headerLines` (1–3 строки). `import { Card } from "@ivlev-dev/silent-ui"`.
- `List` — список, опционально `selectable`. `import { List } from "@ivlev-dev/silent-ui"`.
- `ListItem` — строка списка с leading/trailing и `lines` (1–3). `import { ListItem } from "@ivlev-dev/silent-ui"`.
- `Table` — семантическая таблица с управляемой сортировкой; корень скроллится по горизонтали, колонки поддерживают `truncate`/`lines`. `import { Table } from "@ivlev-dev/silent-ui"`.
- `Avatar` — изображение/инициалы/иконка + статус. `import { Avatar } from "@ivlev-dev/silent-ui"`.
- `Badge` — счётчик, точка или `position` (`top-end`/`top-start`/`bottom-end`/`bottom-start`) у позиционированного родителя. `import { Badge } from "@ivlev-dev/silent-ui"`.
- `Chip` — assist/filter/input/suggestion. `import { Chip } from "@ivlev-dev/silent-ui"`.
- `Tag` — статичная метка с удалением. `import { Tag } from "@ivlev-dev/silent-ui"`.
- `Accordion` — раскрывающиеся секции single/multiple; `truncate` обрезает длинный заголовок одной строкой. `import { Accordion } from "@ivlev-dev/silent-ui"`.

### Оверлеи

- `Dialog` — модальный диалог на нативном `<dialog>`. `import { Dialog } from "@ivlev-dev/silent-ui"`.
- `AlertDialog` — подтверждение с фокусом на действиях. `import { AlertDialog } from "@ivlev-dev/silent-ui"`.
- `Sheet` — боковая/нижняя панель с модальным режимом. `import { Sheet } from "@ivlev-dev/silent-ui"`.
- `Drawer` — модальная или standard-панель. `import { Drawer } from "@ivlev-dev/silent-ui"`.
- `Popover` — inline-панель без Portal. `import { Popover } from "@ivlev-dev/silent-ui"`.
- `Menu` — меню с roving tabindex. `import { Menu } from "@ivlev-dev/silent-ui"`.
- `MenuItem` — пункт меню. `import { MenuItem } from "@ivlev-dev/silent-ui"`.
- `MenuSeparator` — разделитель пунктов. `import { MenuSeparator } from "@ivlev-dev/silent-ui"`.
- `Tooltip` — подсказка на hover/focus. `import { Tooltip } from "@ivlev-dev/silent-ui"`.

### Навигация

- `Tabs` — контейнер вкладок с `size` (`sm`/`md`/`lg`). `import { Tabs } from "@ivlev-dev/silent-ui"`.
- `TabList` — список вкладок с `role="tablist"`. `import { TabList } from "@ivlev-dev/silent-ui"`.
- `Tab` — отдельная вкладка. `import { Tab } from "@ivlev-dev/silent-ui"`.
- `TabPanel` — панель вкладки. `import { TabPanel } from "@ivlev-dev/silent-ui"`.
- `TopAppBar` — верхняя панель small/medium/large; `actionsLabel` задаёт доступное имя группы действий. `import { TopAppBar } from "@ivlev-dev/silent-ui"`.
- `NavigationBar` — нижняя навигация 3–5 пунктов. `import { NavigationBar } from "@ivlev-dev/silent-ui"`.
- `NavigationRail` — боковой рейл со свёрнутым/развёрнутым режимом. `import { NavigationRail } from "@ivlev-dev/silent-ui"`.
- `Breadcrumbs` — крошки со сворачиванием по `maxItems`. `import { Breadcrumbs } from "@ivlev-dev/silent-ui"`.
- `Pagination` — страницы, многоточия, RU-подписи. `import { Pagination } from "@ivlev-dev/silent-ui"`.

## UX-правила

- **Иерархия**: один `Heading` первого уровня на экран; display/headline — serif, интерфейс и body — sans. Не повышайте уровень заголовка ради размера — для этого есть `variant`.
- **Акцент**: золотой `accent` — для одного ключевого действия на экране (`Button`/`IconButton`/`Badge`). Остальные действия — `filled`/`tonal`/`outlined`/`text`. Не превращайте все поверхности в pill: радиусы 4/8/12/16/24, `full` — только аватары и круги.
- **Длина текста**: длинный повествовательный текст ограничивайте `Text.measure` (68ch) или `.sui-measure`; для строк списков, карточек, таблиц и аккордеона используйте осознанную обрезку (`lines`/`truncate`/`headerLines`) вместо «прыгающей» высоты строки. Обрезка не должна скрывать единственное действие.
- **Формы**: ошибка видна сразу, как только передана; `validating` — отдельное состояние, не подменяет `error`. Подписи секций — `Label.uppercase`, только осознанно. На широких экранах форма ограничивается `FieldGroup.maxWidth`, а не растягивается на всю ширину.
- **Таблицы**: на узких экранах `Table` скроллит по горизонтали; не уменьшайте шрифт ради влезания. Длинные значения — `TableColumn.truncate`/`lines`, заголовки остаются видимыми.
- **Доступность и движение**: цель нажатия не меньше 44px (48px в cozy/`lg`), focus ring 2px с offset 2px, `prefers-reduced-motion` отключает анимации, иконки без подписи получают `aria-label`/`label`. Storybook `check:ui` держит axe-core critical на нуле.
- **SSR-гидрация**: не меняйте структуру ради визуального эффекта на клиенте — сервер и клиент должны давать одинаковую разметку (см. «Ограничения v1»).

## Storybook

```bash
pnpm --filter @ivlev-dev/silent-ui-storybook dev             # http://localhost:6106
pnpm --filter @ivlev-dev/silent-ui-storybook test            # unit-тесты stories
pnpm --filter @ivlev-dev/silent-ui-storybook typecheck
pnpm --filter @ivlev-dev/silent-ui-storybook build           # static → storybook-static
pnpm --filter @ivlev-dev/silent-ui-storybook check:ui        # браузер, a11y, скриншоты
pnpm --filter @ivlev-dev/silent-ui-storybook check:ui:strict # CI: без fallback при отсутствии браузера
pnpm --filter @ivlev-dev/silent-ui-storybook test:ui         # build + строгая браузерная проверка
```

Storybook живёт в `packages/ui-storybook` (private): `@storybook/html-vite` без React, `addon-a11y`, `@storybook/addon-docs`, toolbar темы light/dark/auto и плотности compact/default/comfortable. Viewport'ы: 360×800, 600×960, 840×1112, 1200×900, 1600×1000, 2560×1440. `check:ui` сам поднимает локальную статическую сборку и не требует внешнего хоста; для точечного прогона есть `--url`, `--stories`, `--dpr`.

Stories разложены по разделам: `Introduction` (MDX: палитра, темы, брейкпоинты, controls), `Foundations` (цвета/темы, типографика, layout), `Components` (эталоны `Button`, `TextField`, `Alert`, `Dialog`, `Table` с тегом `autodocs`) и `Patterns` (форма с валидацией, dashboard, auth, settings, dialog flow). Для HTML-renderer'а Storybook не выводит props из JSDoc, поэтому args table строится из явных `argTypes` в meta; `controls.expanded`, `matchers` и `sort: "requiredFirst"` заданы глобально. Действия подключаются через `fn()` из `storybook/test`.

Смена story освобождает handle предыдущего Canvas через `dispose()`; Docs-страница держит несколько Canvas одновременно, поэтому handle привязан к canvas-элементу, а не к глобальной переменной.

`check:ui` (`scripts/ui-check.mjs`) проходит по `index.json`, проверяет горизонтальный overflow, вылезающий текст, `sb-errordisplay`, ошибки консоли и axe-core (critical — ошибка) на всех viewport'ах с DPR 1/2, снимает скриншоты ключевых stories в `/tmp/silent-ui-check`. Без браузера скрипт печатает причину и выполняет статические проверки; `--strict-browser` (используется в CI) запрещает такой fallback. Известные дефекты a11y, принадлежащие компонентам, помечаются тегом `ui-a11y-baseline` и попадают в отчёт как предупреждения, пока владелец компонента их не исправит.

## Ограничения v1

- `Dialog` использует нативный `<dialog>`; если платформа не умеет `showModal()` (jsdom, старые WebView), включается fallback на атрибут `open` + focus trap. Поведение Escape/backdrop в fallback реализовано компонентом.
- `Drawer` запирает фокус и возвращает его на триггер, но, в отличие от `Dialog`/`Sheet`, не ставит `inert`/`aria-hidden` на фон и не блокирует прокрутку `body` — при необходимости управляйте этим в приложении.
- `FieldArray` опирается на `FormArray.items`, который **не сигнал**: структурные операции внутри UI помечаются локальной ревизией. Внешние мутации массива в обход `FieldArray` не перерисуют строки.
- `Select` рендерит `option` через `.map()`, а не `For`/`KeyedList`: список внутри `<select>` не гидратируется (тег с неявной перестройкой парсером).
- `Table` и `Accordion` держат `For` в отдельной внутренней обёртке (`TableRowList`/`AccordionEntries`), чтобы `For` не оказался единственным ребёнком разметки и не потерял SSR-разметку. Менять эти обёртки нельзя.
- `Sheet` в v1 без drag-жеста: ручка — только affordance. `Popover`/`Menu`/`Tooltip` не используют Portal.
- `Skeleton` всегда декоративен (`aria-hidden`); состояние загрузки озвучивайте через `aria-busy` на контейнере.
