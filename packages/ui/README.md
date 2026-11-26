# @ivlev-dev/silent-ui

Дизайн-система Silent Framework: токены Material 3, светлая/тёмная темы, layout-примитивы, типографика, компоненты, формы, иконки и Storybook. Пакет поставляется **precompiled** (`dist` собран `@ivlev-dev/silent-swc`), поэтому TSX-компоненты работают и в Vite-приложении, и в Node-SSR без дополнительной компиляции.

```bash
pnpm add @ivlev-dev/silent-ui @ivlev-dev/silent-core @ivlev-dev/silent-reactivity
# опционально, для field={form.getFieldProps(...)}
pnpm add @ivlev-dev/silent-form
```

```tsx
import { Button, Stack, TextField, Heading } from "@ivlev-dev/silent-ui";
import "@ivlev-dev/silent-ui/styles.css";

<Stack gap={4}>
  <Heading level={1}>Профиль</Heading>
  <TextField label="Email" type="email" name="email" required />
  <Button type="submit">Сохранить</Button>
  <Button variant="accent">Оформить</Button>
</Stack>;
```

`accent` есть у `Button`, `IconButton` и `Badge` — это mist-пара `accent`/`on-accent` для одного ключевого действия. `Table` на узких экранах скроллится по горизонтали внутри `.sui-table-scroll`, поэтому широкая таблица не ломает страницу.

CSS **никогда** не импортируется из JS пакета: подключение идёт отдельными входами (`styles.css`, `base.css`, `tokens.css`, `themes.css`, `layout.css`, `form.css`, `<component>.css`). Отдельного CSS-входа у контролов форм нет — используйте `form.css`. Полное руководство — [docs/guides/ui.md](../../docs/guides/ui.md), справочник API — [docs/api/ui.md](../../docs/api/ui.md).

## Возможности

- **Токены**: палитра `ink-900/ink-800/teal-700/mist-300/ivory-50` (`#081A2E/#0E2A47/#1F4E6B/#9FB8C9/#F2F5F7`), семантические роли Material 3 с парой `accent`/`on-accent`, state layers, elevation/shape/type/motion/spacing/density. Display/headline и UI/body — единый современный sans; fluid-шкала с верхней границей на 4K, компактные контролы 32/40/48px и мягкие радиусы 4/6/10/14/20.
- **Доступность**: все пары текст/фон проходят WCAG AA (проверяется тестом), `focus-visible` ring, `prefers-reduced-motion`, `aria-busy`/`aria-label`, touch targets 44/48px; `check:ui` держит axe-core critical на нуле.
- **Темы**: `data-theme="light|dark|auto"`, `prefers-color-scheme` fallback, `applyTheme`, SSR-скрипт `ThemeScript` без вспышки.
- **Слои**: `@layer sui.reset, sui.tokens, sui.base, sui.layout, sui.components, sui.overrides`.
- **Брейкпоинты**: 10 mobile-first `xs 0 … 6xl 3840`, `em`-литералы, 4K через `max-width`/gutters; адаптивные `FieldGroup.columns`, горизонтальный скролл `Table`.
- **Компоненты**: контролы (`Button`/`IconButton` с вариантом `accent`, `Fab`, `SegmentedButton`), данные (`Card` с `mediaAspect`/`headerLines`, `List`, `Table`, `Avatar`, `Badge` с `position`, `Chip`, `Tag`, `Accordion`), обратная связь (`Alert`, `Progress`, `Skeleton` с `size`, `Snackbar`, `EmptyState`), оверлеи (`Dialog`, `AlertDialog`, `Sheet`, `Drawer`, `Popover`, `Menu`, `Tooltip`), навигация (`Tabs` с `size`, `TopAppBar`, `NavigationBar`, `NavigationRail`, `Breadcrumbs`, `Pagination`, `SearchField`).
- **Формы**: `Field`, `FieldGroup`, `FormActions`, `TextField`, `Textarea`, `Select`, `Checkbox`, `RadioGroup`, `Switch`, `Slider`, `FileField`, `FieldArray`; `field` из `@ivlev-dev/silent-form` — источник, явные пропсы — overrides; `validating`, `columns`/`maxWidth`, `sticky`.
- **Storybook**: `packages/ui-storybook` (private) на `@storybook/html-vite` без React: docs/controls/patterns, темы и плотность в toolbar, `check:ui` (viewport'ы, overflow, axe-core, скриншоты).

## Скрипты

```bash
pnpm --filter @ivlev-dev/silent-ui build      # precompiled dist + CSS-агрегаты + .d.ts
pnpm --filter @ivlev-dev/silent-ui test       # build + vitest (jsdom, SSR, dist)
pnpm --filter @ivlev-dev/silent-ui typecheck
pnpm --filter @ivlev-dev/silent-ui-storybook dev        # Storybook на :6106
pnpm --filter @ivlev-dev/silent-ui-storybook check:ui   # overflow/a11y/скриншоты
pnpm --filter @ivlev-dev/silent-ui-storybook test:ui    # build + strict browser check
```

## Лицензия

MIT.
