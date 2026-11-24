import type { Meta, StoryObj } from "@storybook/html-vite";
import { fn } from "storybook/test";
import { createSignal } from "@ivlev-dev/silent-core";
import {
  AddIcon,
  ArrowBackIcon,
  ArrowForwardIcon,
  Button,
  CloseIcon,
  DownloadIcon,
  IconButton,
  Inline,
  InfoIcon,
  MenuIcon,
  MoreVertIcon,
  SearchIcon,
  Stack,
  StarIcon,
  Surface,
  Text,
  WarningIcon,
} from "@ivlev-dev/silent-ui";
import { Breadcrumbs, type BreadcrumbItemData } from "@ivlev-dev/silent-ui/breadcrumbs";
import { Drawer, type DrawerSide, type DrawerVariant } from "@ivlev-dev/silent-ui/drawer";
import {
  NavigationBar,
  type NavigationBarItemData,
} from "@ivlev-dev/silent-ui/navigation-bar";
import {
  NavigationRail,
  type NavigationRailItemData,
} from "@ivlev-dev/silent-ui/navigation-rail";
import { Pagination } from "@ivlev-dev/silent-ui/pagination";
import {
  Tabs,
  type TabItem,
  type TabsActivationMode,
  type TabsOrientation,
  type TabsSize,
} from "@ivlev-dev/silent-ui/tabs";
import { TopAppBar, type TopAppBarVariant } from "@ivlev-dev/silent-ui/top-app-bar";
import { silentStory } from "./silent-story.js";

/* ------------------------------------------------------------------ */
/* Данные контролов                                                    */
/* ------------------------------------------------------------------ */

interface NavItemArg {
  readonly key: string;
  readonly label: string;
  readonly badge?: string;
  readonly href?: string;
}

/** Один control `variant` для TopAppBar и Drawer: разные наборы значений. */
type NavigationVariant = TopAppBarVariant | DrawerVariant;

interface NavigationArgs {
  /* Общие props навигации */
  readonly label: string;
  readonly disabled: boolean;
  readonly value: string;
  readonly defaultValue: string;
  readonly items: readonly NavItemArg[];
  /* Tabs */
  readonly orientation: TabsOrientation;
  readonly activationMode: TabsActivationMode;
  readonly size: TabsSize;
  readonly lazy: boolean;
  /* TopAppBar */
  readonly variant: NavigationVariant;
  readonly title: string;
  readonly titleLevel: 1 | 2 | 3 | 4 | 5 | 6;
  readonly elevated: boolean;
  readonly sticky: boolean;
  readonly safeArea: boolean;
  readonly showLeading: boolean;
  readonly showActions: boolean;
  /* NavigationRail */
  readonly expanded: boolean;
  readonly showFab: boolean;
  /* Drawer */
  readonly open: boolean;
  readonly side: DrawerSide;
  readonly header: string;
  readonly showCloseButton: boolean;
  readonly closeOnScrimClick: boolean;
  readonly showDrawerFooter: boolean;
  /* Breadcrumbs */
  readonly maxItems: number;
  readonly separator: string;
  /* Pagination */
  readonly page: number;
  readonly pageCount: number;
  readonly siblingCount: number;
  /* События */
  readonly onValueChange: (value: string) => void;
  readonly onChange: (page: number) => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly onLeadingClick: () => void;
  readonly onActionClick: () => void;
  readonly onItemClick: (key: string) => void;
  readonly onCreate: () => void;
}

const meta = {
  title: "Components/Navigation",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: [
          "Навигационные компоненты дизайн-системы.",
          "**Tabs** — WAI-ARIA tabs: roving tabindex, стрелки/Home/End,",
          "`activationMode` automatic/manual, ленивые панели и scroll при",
          "переполнении; **TopAppBar** — small/medium/large, elevated, sticky,",
          "safe-area; **NavigationBar** — мобильная нижняя навигация (3–5 пунктов);",
          "**NavigationRail** — свёрнутый/развёрнутый боковой рейл с FAB;",
          "**Drawer** — modal/standard панель со скримом и focus trap;",
          "**Breadcrumbs** — цепочка с `aria-current` и сворачиванием `maxItems`;",
          "**Pagination** — диапазон страниц с многоточиями (`siblings * 2 + 5`).",
        ].join(" "),
      },
      canvas: { sourceState: "shown" },
    },
  },
  argTypes: {
    /*
     * Union общих props семейства для autodocs; controls включаются в
     * конкретных story, чтобы панель не показывала props чужих компонентов.
     */
    label: {
      control: false,
      description: "Доступное имя навигации / списка",
    },
    disabled: {
      control: false,
      description: "Блокирует взаимодействие (Pagination, пункты)",
      table: { defaultValue: { summary: "false" } },
    },
    value: {
      control: false,
      description: "Controlled-значение выбранного элемента",
      table: { category: "Состояние" },
    },
    defaultValue: {
      control: false,
      description: "Начальное значение для uncontrolled-режима",
      table: { category: "Состояние" },
    },
    items: {
      control: false,
      description: "Пункты навигации или хлебных крошек",
    },
    orientation: {
      control: false,
      description: "Ориентация Tabs: horizontal/vertical",
      table: { defaultValue: { summary: "horizontal" } },
    },
    activationMode: {
      control: false,
      description: "Активация вкладок стрелками: automatic/manual",
      table: { defaultValue: { summary: "automatic" } },
    },
    size: {
      control: false,
      description: "Размер вкладок: sm/md/lg",
      table: { defaultValue: { summary: "md" } },
    },
    lazy: {
      control: false,
      description: "Монтировать панель вкладки только при активации",
      table: { defaultValue: { summary: "true" } },
    },
    variant: {
      control: false,
      description: "Вариант TopAppBar или Drawer",
      table: { defaultValue: { summary: "small" } },
    },
    title: { control: false, description: "Заголовок TopAppBar" },
    titleLevel: {
      control: false,
      description: "Уровень `aria-level` заголовка",
      table: { category: "Доступность", defaultValue: { summary: "1" } },
    },
    elevated: {
      control: false,
      description: "Подъём TopAppBar при прокрутке",
      table: { defaultValue: { summary: "false" } },
    },
    sticky: {
      control: false,
      description: "`position: sticky` у TopAppBar",
      table: { defaultValue: { summary: "false" } },
    },
    safeArea: {
      control: false,
      description: "Учитывать safe-area (TopAppBar/NavigationBar)",
      table: { defaultValue: { summary: "true" } },
    },
    expanded: {
      control: false,
      description: "Развёрнутый NavigationRail с подписями",
      table: { defaultValue: { summary: "false" } },
    },
    open: {
      control: false,
      description: "Открытая панель Drawer",
      table: { category: "Состояние", defaultValue: { summary: "false" } },
    },
    side: {
      control: false,
      description: "Сторона Drawer: start/end",
      table: { defaultValue: { summary: "start" } },
    },
    header: { control: false, description: "Заголовок Drawer" },
    showCloseButton: {
      control: false,
      description: "Кнопка закрытия в шапке Drawer",
      table: { defaultValue: { summary: "false" } },
    },
    closeOnScrimClick: {
      control: false,
      description: "Закрывать modal Drawer кликом по скриму",
      table: { defaultValue: { summary: "true" } },
    },
    maxItems: {
      control: false,
      description: "Breadcrumbs: максимум видимых пунктов",
    },
    separator: { control: false, description: "Разделитель Breadcrumbs" },
    page: { control: false, description: "Текущая страница Pagination" },
    pageCount: { control: false, description: "Всего страниц Pagination" },
    siblingCount: {
      control: false,
      description: "Соседних страниц Pagination",
      table: { defaultValue: { summary: "1" } },
    },
    onValueChange: {
      action: "value-change",
      description: "Смена выбранного элемента (Tabs/NavigationBar/NavigationRail)",
      table: { category: "События" },
    },
    onChange: {
      action: "page-change",
      description: "Смена страницы Pagination",
      table: { category: "События" },
    },
    onOpenChange: {
      action: "open-change",
      description: "Открытие/закрытие Drawer",
      table: { category: "События" },
    },
  },
  args: {
    label: "Основная навигация",
    disabled: false,
    value: "home",
    defaultValue: "home",
    items: [
      { key: "home", label: "Главная" },
      { key: "search", label: "Поиск", badge: "3" },
      { key: "profile", label: "Профиль", href: "#profile" },
    ],
    orientation: "horizontal",
    activationMode: "automatic",
    size: "md",
    lazy: true,
    variant: "small",
    title: "Дизайн-система",
    titleLevel: 1,
    elevated: false,
    sticky: true,
    safeArea: true,
    showLeading: true,
    showActions: true,
    expanded: false,
    showFab: true,
    open: false,
    side: "start",
    header: "Меню приложения",
    showCloseButton: true,
    closeOnScrimClick: true,
    showDrawerFooter: true,
    maxItems: 4,
    separator: "/",
    page: 3,
    pageCount: 12,
    siblingCount: 1,
    onValueChange: fn(),
    onChange: fn(),
    onOpenChange: fn(),
    onLeadingClick: fn(),
    onActionClick: fn(),
    onItemClick: fn(),
    onCreate: fn(),
  },
} satisfies Meta<NavigationArgs>;

export default meta;

type Story = StoryObj<NavigationArgs>;

/* ------------------------------------------------------------------ */
/* Хелперы и общие данные                                              */
/* ------------------------------------------------------------------ */

const ICONS = [
  (): Node => <MenuIcon />,
  (): Node => <SearchIcon />,
  (): Node => <CloseIcon />,
  (): Node => <InfoIcon />,
  (): Node => <StarIcon />,
  (): Node => <AddIcon />,
  (): Node => <DownloadIcon />,
  (): Node => <WarningIcon />,
] as const;

function iconAt(index: number): () => Node {
  return ICONS[index % ICONS.length] ?? ICONS[0];
}

function navItems(items: readonly NavItemArg[]): NavigationBarItemData[] {
  return items.map((item, index) => ({
    ...item,
    icon: iconAt(index),
  }));
}

function railItems(items: readonly NavItemArg[]): NavigationRailItemData[] {
  return items.map((item, index) => ({
    ...item,
    icon: iconAt(index),
  }));
}

function breadcrumbItems(
  items: readonly NavItemArg[],
  onItemClick: (key: string) => void,
): BreadcrumbItemData[] {
  return items.map((item, index) => ({
    ...item,
    icon: index === 0 ? () => <MenuIcon /> : undefined,
    onClick: (event: MouseEvent) => {
      event.preventDefault();
      onItemClick(item.key);
    },
  }));
}

const tabItems: readonly TabItem[] = [
  {
    key: "overview",
    label: "Обзор",
    content: () => (
      <Stack gap={2}>
        <Text>
          Содержимое обзора: карточки, метрики и краткая сводка проекта.
        </Text>
        <Text variant="body-small" tone="muted">
          Панель монтируется лениво при первой активации.
        </Text>
      </Stack>
    ),
  },
  {
    key: "details",
    label: "Детали",
    content: () => (
      <Text>Подробности: таблицы, история изменений и параметры доступа.</Text>
    ),
  },
  {
    key: "settings",
    label: "Настройки",
    content: () => <Text>Настройки проекта и уведомлений.</Text>,
  },
  {
    key: "history",
    label: "История",
    disabled: true,
    content: () => <Text>Недоступная вкладка не получает фокус и пропускается стрелками.</Text>,
  },
];

const manyTabItems: readonly TabItem[] = Array.from({ length: 18 }, (_value, index) => ({
  key: `section-${index + 1}`,
  label: `Раздел ${index + 1} — длинное название`,
  content: () => (
    <Text>
      Содержимое раздела {index + 1}. Список вкладок прокручивается по
      горизонтали, у краёв появляется fade (`data-overflow`).
    </Text>
  ),
}));

const longCrumbs: readonly NavItemArg[] = [
  { key: "root", label: "Главная", href: "#/" },
  { key: "workspace", label: "Рабочее пространство «Платформа»", href: "#/ws" },
  { key: "team", label: "Команда дизайн-системы", href: "#/ws/team" },
  { key: "library", label: "Библиотека компонентов", href: "#/ws/team/lib" },
  { key: "navigation", label: "Навигация и оверлеи", href: "#/ws/team/lib/nav" },
  { key: "spec", label: "Спецификация API Breadcrumbs" },
];

function Paragraphs(props: { readonly count: number }): Node {
  return (
    <Stack gap={2}>
      {Array.from({ length: props.count }, (_value, index) => (
        <Text key={`paragraph-${index}`}>
          Строка {index + 1}. Проверяем sticky-шапку, прокрутку и сохранение
          отступов safe-area.
        </Text>
      ))}
    </Stack>
  );
}

function DarkFrame(props: { readonly children: Node; readonly minHeight?: string }): Node {
  return (
    <div
      data-theme="dark"
      style={{
        minHeight: props.minHeight ?? "18rem",
        padding: "var(--sui-space-5)",
        background: "var(--sui-color-surface)",
        color: "var(--sui-color-on-surface)",
        borderRadius: "var(--sui-radius-lg)",
      }}
    >
      {props.children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tabs                                                                */
/* ------------------------------------------------------------------ */

export const TabsPlayground: Story = {
  name: "Tabs",
  args: { value: "overview", label: "Разделы проекта" },
  argTypes: {
    value: {
      control: "inline-radio",
      options: ["overview", "details", "settings"],
      description: "Активная вкладка (controlled `value`)",
    },
    defaultValue: {
      control: false,
      description: "Используется в uncontrolled-режиме",
    },
    orientation: {
      control: "inline-radio",
      options: ["horizontal", "vertical"],
      description: "Ориентация списка и стрелки",
      table: { defaultValue: { summary: "horizontal" } },
    },
    activationMode: {
      control: "inline-radio",
      options: ["automatic", "manual"],
      description: "Стрелки активируют вкладку сразу или только фокусируют",
      table: { defaultValue: { summary: "automatic" } },
    },
    size: {
      control: "inline-radio",
      options: ["sm", "md", "lg"],
      description: "Высота вкладок",
      table: { defaultValue: { summary: "md" } },
    },
    lazy: {
      control: "boolean",
      description: "Монтировать панель только при активации",
      table: { defaultValue: { summary: "true" } },
    },
    label: { control: "text", description: "Доступное имя списка вкладок" },
    onValueChange: { action: "tab-change", description: "Смена вкладки" },
  },
  render: silentStory<NavigationArgs>((args) => {
    const [tab, setTab] = createSignal(args.value);
    return (
      <Tabs
        items={tabItems}
        value={tab()}
        onValueChange={(next) => {
          setTab(next);
          args.onValueChange(next);
        }}
        orientation={args.orientation}
        activationMode={args.activationMode}
        size={args.size}
        lazy={args.lazy}
        label={args.label}
      />
    );
  }),
};

export const TabsUncontrolled: Story = {
  name: "Tabs: uncontrolled (defaultValue)",
  args: { defaultValue: "overview", label: "Разделы проекта" },
  argTypes: {
    defaultValue: {
      control: "inline-radio",
      options: ["overview", "details", "settings"],
      description: "Начальная вкладка без `value`",
    },
    value: { control: false, description: "В uncontrolled-режиме не используется" },
    label: { control: "text", description: "Доступное имя списка вкладок" },
    orientation: {
      control: "inline-radio",
      options: ["horizontal", "vertical"],
      description: "Ориентация",
    },
    activationMode: {
      control: "inline-radio",
      options: ["automatic", "manual"],
      description: "Режим активации",
    },
    size: {
      control: "inline-radio",
      options: ["sm", "md", "lg"],
      description: "Размер",
    },
    lazy: { control: "boolean", description: "Ленивые панели" },
    onValueChange: { action: "tab-change", description: "Наблюдатель смены" },
  },
  render: silentStory<NavigationArgs>((args) => (
    <Tabs
      items={tabItems}
      defaultValue={args.defaultValue}
      onValueChange={args.onValueChange}
      orientation={args.orientation}
      activationMode={args.activationMode}
      size={args.size}
      lazy={args.lazy}
      label={args.label}
    />
  )),
};

export const TabsSizes: Story = {
  name: "Tabs: размеры и ориентация",
  parameters: { controls: { disable: true } },
  render: silentStory(() => (
    <Stack gap={5}>
      <Stack gap={4}>
        <Text variant="label-large" tone="muted">
          sm / md / lg
        </Text>
        <Tabs items={tabItems} defaultValue="overview" size="sm" label="Small" />
        <Tabs items={tabItems} defaultValue="details" size="md" label="Medium" />
        <Tabs items={tabItems} defaultValue="settings" size="lg" label="Large" />
      </Stack>
      <Stack gap={3}>
        <Text variant="label-large" tone="muted">
          vertical
        </Text>
        <Tabs
          items={tabItems}
          defaultValue="overview"
          orientation="vertical"
          label="Вертикальные вкладки"
        />
      </Stack>
    </Stack>
  )),
};

export const TabsKeyboard: Story = {
  name: "Tabs: клавиатура",
  parameters: { controls: { disable: true } },
  render: silentStory(() => (
    <Stack gap={5}>
      <Stack gap={3}>
        <Text variant="label-large">automatic</Text>
        <Text variant="body-small" tone="muted">
          Стрелки сразу переключают вкладку, Home/End — к краям.
        </Text>
        <Tabs items={tabItems} defaultValue="overview" label="Automatic" />
      </Stack>
      <Stack gap={3}>
        <Text variant="label-large">manual</Text>
        <Text variant="body-small" tone="muted">
          Стрелки только фокусируют, Enter/Space активирует.
        </Text>
        <Tabs
          items={tabItems}
          defaultValue="details"
          activationMode="manual"
          label="Manual"
        />
      </Stack>
    </Stack>
  )),
};

export const TabsOverflow: Story = {
  name: "Tabs: много вкладок (overflow)",
  parameters: { controls: { disable: true } },
  render: silentStory(() => (
    <Stack gap={3}>
      <Text variant="body-small" tone="muted">
        18 вкладок в контейнере 34rem: список скроллится, край получает fade,
        активная вкладка прокручивается в видимую область.
      </Text>
      <Tabs
        items={manyTabItems}
        defaultValue="section-10"
        label="Много разделов"
        style={{ maxWidth: "34rem" }}
      />
    </Stack>
  )),
};

export const TabsDark: Story = {
  name: "Tabs: тёмная тема",
  parameters: { controls: { disable: true } },
  render: silentStory(() => (
    <DarkFrame>
      <Tabs items={tabItems} defaultValue="overview" label="Тёмные вкладки" />
    </DarkFrame>
  )),
};

/* ------------------------------------------------------------------ */
/* TopAppBar                                                           */
/* ------------------------------------------------------------------ */

export const TopAppBarPlayground: Story = {
  name: "TopAppBar",
  argTypes: {
    variant: {
      control: "inline-radio",
      options: ["small", "medium", "large"],
      description: "Вариант панели",
      table: { defaultValue: { summary: "small" } },
    },
    title: { control: "text", description: "Заголовок панели" },
    titleLevel: {
      control: "select",
      options: [1, 2, 3, 4, 5, 6],
      description: "Уровень `aria-level` заголовка",
      table: { category: "Доступность", defaultValue: { summary: "1" } },
    },
    elevated: {
      control: "boolean",
      description: "Подъём: тень + surface-container",
      table: { defaultValue: { summary: "false" } },
    },
    sticky: {
      control: "boolean",
      description: "`position: sticky` сверху",
      table: { defaultValue: { summary: "false" } },
    },
    safeArea: {
      control: "boolean",
      description: "Учитывать `safe-area-inset-top`",
      table: { defaultValue: { summary: "true" } },
    },
    showLeading: { control: "boolean", description: "Показать слот навигации" },
    showActions: { control: "boolean", description: "Показать слот действий" },
    onLeadingClick: { action: "leading-click", description: "Клик по leading" },
    onActionClick: { action: "action-click", description: "Клик по действию" },
  },
  render: silentStory<NavigationArgs>((args) => (
    <TopAppBar
      variant={args.variant as TopAppBarVariant}
      title={args.title}
      titleLevel={args.titleLevel}
      elevated={args.elevated}
      sticky={args.sticky}
      safeArea={args.safeArea}
      leading={
        args.showLeading ? (
          <IconButton label="Назад" onClick={args.onLeadingClick}>
            <ArrowBackIcon />
          </IconButton>
        ) : null
      }
      actions={
        args.showActions ? (
          <IconButton label="Ещё" onClick={args.onActionClick}>
            <MoreVertIcon />
          </IconButton>
        ) : null
      }
    />
  )),
};

export const TopAppBarVariants: Story = {
  name: "TopAppBar: small / medium / large",
  parameters: { controls: { disable: true } },
  render: silentStory(() => (
    <Stack gap={5}>
      <TopAppBar
        variant="small"
        title="Small — одна строка"
        leading={
          <IconButton label="Назад">
            <ArrowBackIcon />
          </IconButton>
        }
        actions={
          <IconButton label="Поиск">
            <SearchIcon />
          </IconButton>
        }
      />
      <TopAppBar
        variant="medium"
        title="Medium — две строки, elevated"
        elevated
        leading={
          <IconButton label="Назад">
            <ArrowBackIcon />
          </IconButton>
        }
        actions={
          <IconButton label="Скачать">
            <DownloadIcon />
          </IconButton>
        }
      />
      <TopAppBar
        variant="large"
        title="Large"
        actions={
          <IconButton label="Ещё">
            <MoreVertIcon />
          </IconButton>
        }
      />
    </Stack>
  )),
};

export const TopAppBarSticky: Story = {
  name: "TopAppBar: sticky при прокрутке",
  parameters: { controls: { disable: true } },
  render: silentStory(() => (
    <Stack gap={2}>
      <Text variant="body-small" tone="muted">
        Прокрутите контейнер: elevated-состояние включает приложение, sticky
        делает шапку липкой.
      </Text>
      <div
        tabindex="0"
        style={{
          blockSize: "18rem",
          overflowY: "auto",
          border: "var(--sui-hairline) solid var(--sui-color-outline-variant)",
          borderRadius: "var(--sui-radius-lg)",
        }}
      >
        <TopAppBar variant="small" title="Липкая шапка" sticky elevated />
        <div style={{ padding: "var(--sui-space-4)" }}>
          <Paragraphs count={12} />
        </div>
      </div>
    </Stack>
  )),
};

export const TopAppBarLongTitle: Story = {
  name: "TopAppBar: длинный заголовок",
  parameters: { controls: { disable: true } },
  render: silentStory(() => (
    <Stack gap={4}>
      <TopAppBar
        variant="small"
        title="Очень длинный заголовок панели, который должен обрезаться многоточием и не выдавливать действия"
        leading={
          <IconButton label="Назад">
            <ArrowBackIcon />
          </IconButton>
        }
        actions={
          <IconButton label="Ещё">
            <MoreVertIcon />
          </IconButton>
        }
      />
      <TopAppBar
        variant="medium"
        title="Средний вариант с длинным заголовком в две строки"
        leading={
          <IconButton label="Назад">
            <ArrowBackIcon />
          </IconButton>
        }
        actions={
          <IconButton label="Ещё">
            <MoreVertIcon />
          </IconButton>
        }
      />
    </Stack>
  )),
};

export const TopAppBarDark: Story = {
  name: "TopAppBar: тёмная тема",
  parameters: { controls: { disable: true } },
  render: silentStory(() => (
    <DarkFrame>
      <TopAppBar
        variant="small"
        title="Тёмная шапка"
        elevated
        leading={
          <IconButton label="Назад">
            <ArrowBackIcon />
          </IconButton>
        }
        actions={
          <IconButton label="Ещё">
            <MoreVertIcon />
          </IconButton>
        }
      />
    </DarkFrame>
  )),
};

/* ------------------------------------------------------------------ */
/* NavigationBar                                                       */
/* ------------------------------------------------------------------ */

export const NavigationBarPlayground: Story = {
  name: "NavigationBar",
  argTypes: {
    items: {
      control: "object",
      description: "Пункты: `{ key, label, badge?, href? }`",
    },
    value: { control: "text", description: "Выбранный пункт (controlled)" },
    defaultValue: {
      control: false,
      description: "Uncontrolled `defaultValue` (не используется при `value`)",
    },
    safeArea: {
      control: "boolean",
      description: "Учитывать `safe-area-inset-bottom`",
      table: { defaultValue: { summary: "true" } },
    },
    label: { control: "text", description: "Доступное имя навигации" },
    onValueChange: { action: "value-change", description: "Смена пункта" },
    onItemClick: { action: "item-click", description: "Клик по пункту" },
  },
  render: silentStory<NavigationArgs>((args) => {
    const [value, setValue] = createSignal(args.value);
    return (
      <Stack gap={3}>
        <NavigationBar
          items={navItems(args.items)}
          value={value()}
          onValueChange={(next) => {
            setValue(next);
            args.onValueChange(next);
          }}
          safeArea={args.safeArea}
          label={args.label}
        />
        <Text variant="body-small" tone="muted">
          Выбрано: {value()}. Выбранный пункт получает `aria-current="page"`.
        </Text>
      </Stack>
    );
  }),
};

export const NavigationBarStates: Story = {
  name: "NavigationBar: состояния и пять пунктов",
  parameters: { controls: { disable: true } },
  render: silentStory(() => (
    <Stack gap={6}>
      <Stack gap={2}>
        <Text variant="label-large">С бейджем и ссылкой</Text>
        <NavigationBar
          items={navItems([
            { key: "home", label: "Главная" },
            { key: "search", label: "Поиск", badge: "12" },
            { key: "saved", label: "Сохранённое" },
            { key: "profile", label: "Профиль", href: "#profile" },
          ])}
          defaultValue="search"
          label="Четыре пункта"
        />
      </Stack>
      <Stack gap={2}>
        <Text variant="label-large">Пять пунктов, длинные подписи</Text>
        <NavigationBar
          items={navItems([
            { key: "feed", label: "Лента" },
            { key: "explore", label: "Обзор" },
            { key: "create", label: "Создать", badge: "новое" },
            { key: "inbox", label: "Входящие", badge: "99+" },
            { key: "profile", label: "Профиль" },
          ])}
          defaultValue="inbox"
          label="Пять пунктов"
        />
      </Stack>
    </Stack>
  )),
};

export const NavigationBarMobile: Story = {
  name: "NavigationBar: mobile 360px",
  globals: { viewport: "mobile360" },
  parameters: { controls: { disable: true } },
  render: silentStory(() => (
    <Stack gap={3}>
      <Text variant="body-small" tone="muted">
        На мобильной ширине подписи остаются видимыми, safe-area добавляет
        отступ снизу.
      </Text>
      <NavigationBar
        items={navItems([
          { key: "home", label: "Главная" },
          { key: "search", label: "Поиск" },
          { key: "add", label: "Создать" },
          { key: "profile", label: "Профиль" },
        ])}
        defaultValue="home"
        label="Мобильная навигация"
      />
    </Stack>
  )),
};

export const NavigationBarDark: Story = {
  name: "NavigationBar: тёмная тема",
  parameters: { controls: { disable: true } },
  render: silentStory(() => (
    <DarkFrame minHeight="10rem">
      <NavigationBar
        items={navItems([
          { key: "home", label: "Главная" },
          { key: "search", label: "Поиск", badge: "3" },
          { key: "profile", label: "Профиль" },
        ])}
        defaultValue="home"
        label="Тёмная навигация"
      />
    </DarkFrame>
  )),
};

/* ------------------------------------------------------------------ */
/* NavigationRail                                                      */
/* ------------------------------------------------------------------ */

export const NavigationRailPlayground: Story = {
  name: "NavigationRail",
  args: {
    items: [
      { key: "inbox", label: "Входящие", badge: "7" },
      { key: "archive", label: "Архив" },
      { key: "settings", label: "Настройки", href: "#settings" },
    ],
    value: "inbox",
    label: "Боковая навигация",
  },
  argTypes: {
    items: {
      control: "object",
      description: "Пункты: `{ key, label, badge?, href? }`",
    },
    value: { control: "text", description: "Выбранный пункт (controlled)" },
    defaultValue: {
      control: false,
      description: "Uncontrolled `defaultValue` (не используется при `value`)",
    },
    expanded: {
      control: "boolean",
      description: "Развёрнутый рейл с подписями",
      table: { defaultValue: { summary: "false" } },
    },
    showFab: { control: "boolean", description: "Показать FAB в верхнем слоте" },
    label: { control: "text", description: "Доступное имя навигации" },
    onValueChange: { action: "value-change", description: "Смена пункта" },
    onCreate: { action: "create", description: "Клик по FAB" },
  },
  render: silentStory<NavigationArgs>((args) => {
    const [value, setValue] = createSignal(args.value);
    return (
      <div
        style={{
          display: "flex",
          gap: "var(--sui-space-4)",
          alignItems: "stretch",
          minHeight: "20rem",
        }}
      >
        <NavigationRail
          items={railItems(args.items)}
          value={value()}
          onValueChange={(next) => {
            setValue(next);
            args.onValueChange(next);
          }}
          expanded={args.expanded}
          label={args.label}
          fab={
            args.showFab ? (
              <IconButton label="Создать" variant="filled" onClick={args.onCreate}>
                <AddIcon />
              </IconButton>
            ) : null
          }
        />
        <Surface tone="surface-container-low" padding={4} radius="md">
          <Stack gap={2}>
            <Text variant="label-large">Выбрано: {value()}</Text>
            <Text variant="body-small" tone="muted">
              В свёрнутом рейле подписи визуально скрыты, но остаются в DOM для
              скринридера.
            </Text>
          </Stack>
        </Surface>
      </div>
    );
  }),
};

export const NavigationRailStates: Story = {
  name: "NavigationRail: свёрнутый и развёрнутый",
  parameters: { controls: { disable: true } },
  render: silentStory(() => (
    <div style={{ display: "flex", gap: "var(--sui-space-5)", alignItems: "stretch" }}>
      <Stack gap={2}>
        <Text variant="label-large" tone="muted">
          collapsed
        </Text>
        <NavigationRail
          items={railItems([
            { key: "inbox", label: "Входящие", badge: "7" },
            { key: "archive", label: "Архив" },
            { key: "settings", label: "Настройки" },
          ])}
          defaultValue="inbox"
          label="Свёрнутый рейл"
          fab={
            <IconButton label="Создать" variant="filled">
              <AddIcon />
            </IconButton>
          }
        />
      </Stack>
      <Stack gap={2}>
        <Text variant="label-large" tone="muted">
          expanded
        </Text>
        <NavigationRail
          items={railItems([
            { key: "inbox", label: "Входящие", badge: "7" },
            { key: "archive", label: "Архив" },
            { key: "settings", label: "Настройки" },
          ])}
          defaultValue="archive"
          expanded
          label="Развёрнутый рейл"
        />
      </Stack>
    </div>
  )),
};

export const NavigationRailMany: Story = {
  name: "NavigationRail: много пунктов",
  parameters: { controls: { disable: true } },
  render: silentStory(() => (
    <div style={{ display: "flex", gap: "var(--sui-space-4)", alignItems: "stretch", height: "24rem" }}>
      <NavigationRail
        items={railItems(
          Array.from({ length: 12 }, (_value, index) => ({
            key: `rail-${index + 1}`,
            label: `Раздел ${index + 1}`,
            ...(index === 2 ? { badge: "5" } : {}),
          })),
        )}
        defaultValue="rail-1"
        label="Длинный рейл"
        fab={
          <IconButton label="Создать" variant="filled">
            <AddIcon />
          </IconButton>
        }
      />
      <Surface tone="surface-container-low" padding={4} radius="md">
        <Text variant="body-small" tone="muted">
          Список пунктов прокручивается, FAB остаётся в верхнем слоте.
        </Text>
      </Surface>
    </div>
  )),
};

export const NavigationShell: Story = {
  name: "NavigationShell: шапка + рейл + контент",
  parameters: { controls: { disable: true } },
  render: silentStory(() => {
    const [value, setValue] = createSignal("overview");
    return (
      <Stack gap={0}>
        <TopAppBar
          variant="small"
          title="Рабочее пространство"
          elevated
          leading={
            <IconButton label="Назад">
              <ArrowBackIcon />
            </IconButton>
          }
          actions={
            <IconButton label="Поиск">
              <SearchIcon />
            </IconButton>
          }
        />
        <div style={{ display: "flex", alignItems: "stretch", minHeight: "22rem" }}>
          <NavigationRail
            items={railItems([
              { key: "overview", label: "Обзор" },
              { key: "members", label: "Участники", badge: "12" },
              { key: "settings", label: "Настройки" },
            ])}
            value={value()}
            onValueChange={setValue}
            label="Разделы workspace"
            fab={
              <IconButton label="Создать" variant="filled">
                <AddIcon />
              </IconButton>
            }
          />
          <div style={{ flex: "1 1 0", padding: "var(--sui-space-4)" }}>
            <Stack gap={3}>
              <Breadcrumbs
                items={breadcrumbItems(
                  [
                    { key: "ws", label: "Workspace", href: "#/ws" },
                    { key: "section", label: value() },
                  ],
                  () => undefined,
                )}
              />
              <Surface tone="surface-container-low" padding={5} radius="lg">
                <Stack gap={2}>
                  <Text variant="title-medium">Раздел: {value()}</Text>
                  <Text tone="muted">
                    Типовая раскладка: верхняя панель, боковой рейл, контент и
                    постраничная навигация.
                  </Text>
                </Stack>
              </Surface>
              <Pagination page={1} pageCount={5} />
            </Stack>
          </div>
        </div>
      </Stack>
    );
  }),
};

export const NavigationRailDark: Story = {
  name: "NavigationRail: тёмная тема",
  parameters: { controls: { disable: true } },
  render: silentStory(() => (
    <DarkFrame>
      <NavigationRail
        items={railItems([
          { key: "overview", label: "Обзор" },
          { key: "members", label: "Участники", badge: "12" },
          { key: "settings", label: "Настройки" },
        ])}
        defaultValue="overview"
        expanded
        label="Тёмный рейл"
      />
    </DarkFrame>
  )),
};

/* ------------------------------------------------------------------ */
/* Drawer                                                              */
/* ------------------------------------------------------------------ */

export const DrawerPlayground: Story = {
  name: "Drawer",
  argTypes: {
    open: { control: "boolean", description: "Открыта ли панель" },
    variant: {
      control: "inline-radio",
      options: ["modal", "standard"],
      description: "Модальная или встроенная в раскладку",
      table: { defaultValue: { summary: "modal" } },
    },
    side: {
      control: "inline-radio",
      options: ["start", "end"],
      description: "Сторона панели",
      table: { defaultValue: { summary: "start" } },
    },
    header: { control: "text", description: "Заголовок панели" },
    label: {
      control: "text",
      description: "Доступное имя без заголовка",
      table: { category: "Доступность" },
    },
    showCloseButton: { control: "boolean", description: "Кнопка закрытия в шапке" },
    closeOnScrimClick: {
      control: "boolean",
      description: "Закрывать modal по клику на скрим",
      table: { defaultValue: { summary: "true" } },
    },
    showDrawerFooter: { control: "boolean", description: "Показать футер" },
    onOpenChange: { action: "open-change", description: "Escape/скрим/крестик" },
  },
  args: {
    open: false,
    variant: "modal",
    side: "start",
    header: "Меню приложения",
    label: "",
  },
  render: silentStory<NavigationArgs>((args) => {
    const [open, setOpen] = createSignal(args.open);
    const change = (next: boolean): void => {
      setOpen(next);
      args.onOpenChange(next);
    };
    return (
      <Stack gap={3}>
        <Inline gap={2}>
          <Button onClick={() => change(true)}>Открыть панель</Button>
        </Inline>
        <Drawer
          open={open()}
          onOpenChange={change}
          variant={args.variant as DrawerVariant}
          side={args.side}
          header={args.header === "" ? undefined : args.header}
          label={args.label === "" ? undefined : args.label}
          showCloseButton={args.showCloseButton}
          closeOnScrimClick={args.closeOnScrimClick}
          footer={
            args.showDrawerFooter ? (
              <Button fullWidth onClick={() => change(false)}>
                Готово
              </Button>
            ) : undefined
          }
        >
          <Stack gap={2}>
            <Text>Навигация, фильтры и настройки рабочего пространства.</Text>
            <Button variant="text" onClick={() => args.onItemClick("profile")}>
              Профиль
            </Button>
            <Button variant="text">Уведомления</Button>
            <Button variant="text">Безопасность</Button>
          </Stack>
        </Drawer>
      </Stack>
    );
  }),
};

export const DrawerStandard: Story = {
  name: "Drawer: standard в раскладке",
  parameters: { controls: { disable: true } },
  render: silentStory(() => {
    const [value, setValue] = createSignal("overview");
    return (
      <div
        style={{
          display: "flex",
          gap: "var(--sui-space-4)",
          alignItems: "stretch",
          minHeight: "22rem",
        }}
      >
        <div style={{ inlineSize: "17rem" }}>
          <Drawer
            open
            variant="standard"
            header="Разделы"
            footer={<Button fullWidth>Создать раздел</Button>}
          >
            <Stack gap={1}>
              <Button variant={value() === "overview" ? "tonal" : "text"} fullWidth onClick={() => setValue("overview")}>
                Обзор
              </Button>
              <Button variant={value() === "archive" ? "tonal" : "text"} fullWidth onClick={() => setValue("archive")}>
                Архив
              </Button>
              <Button variant={value() === "trash" ? "tonal" : "text"} fullWidth onClick={() => setValue("trash")}>
                Корзина
              </Button>
            </Stack>
          </Drawer>
        </div>
        <Surface tone="surface-container-low" padding={4} radius="md">
          <Stack gap={2}>
            <Text variant="title-medium">Раздел: {value()}</Text>
            <Text tone="muted">
              Standard-панель встроена в раскладку, не перекрывает контент и не
              запирает фокус.
            </Text>
          </Stack>
        </Surface>
      </div>
    );
  }),
};

export const DrawerEndMobile: Story = {
  name: "Drawer: modal end на мобильном",
  globals: { viewport: "mobile360" },
  parameters: { controls: { disable: true } },
  render: silentStory(() => {
    const [open, setOpen] = createSignal(true);
    return (
      <Stack gap={3}>
        <Inline gap={2}>
          <Button onClick={() => setOpen(true)}>Открыть справа</Button>
        </Inline>
        <Drawer
          open={open()}
          onOpenChange={setOpen}
          variant="modal"
          side="end"
          header="Фильтры"
          showCloseButton
          footer={
            <Button fullWidth onClick={() => setOpen(false)}>
              Применить
            </Button>
          }
        >
          <Stack gap={3}>
            <Text>Панель открывается справа и занимает почти всю ширину экрана.</Text>
            <Button variant="text">Статус</Button>
            <Button variant="text">Автор</Button>
            <Button variant="text">Дата</Button>
          </Stack>
        </Drawer>
      </Stack>
    );
  }),
};

export const DrawerLongContent: Story = {
  name: "Drawer: длинное содержимое",
  parameters: { controls: { disable: true } },
  render: silentStory(() => {
    const [open, setOpen] = createSignal(true);
    return (
      <Drawer
        open={open()}
        onOpenChange={setOpen}
        header="История изменений за последние 12 месяцев"
        showCloseButton
        footer={<Button fullWidth onClick={() => setOpen(false)}>Закрыть</Button>}
      >
        <Paragraphs count={20} />
      </Drawer>
    );
  }),
};

export const DrawerFocusRestore: Story = {
  name: "Drawer: возврат фокуса и Escape",
  parameters: { controls: { disable: true } },
  render: silentStory(() => {
    const [open, setOpen] = createSignal(false);
    return (
      <Stack gap={3}>
        <Inline gap={2}>
          <Button onClick={() => setOpen(true)}>Открыть и проверить фокус</Button>
          <Button variant="outlined">Соседний элемент</Button>
        </Inline>
        <Drawer open={open()} onOpenChange={setOpen} header="Фокус" showCloseButton>
          <Stack gap={2}>
            <Button>Первое действие</Button>
            <Button>Второе действие</Button>
          </Stack>
        </Drawer>
        <Text variant="body-small" tone="muted">
          Modal-панель запирает Tab внутри, Escape вызывает `onOpenChange(false)`,
          после закрытия фокус возвращается на кнопку-триггер.
        </Text>
      </Stack>
    );
  }),
};

export const DrawerDark: Story = {
  name: "Drawer: тёмная тема",
  parameters: { controls: { disable: true } },
  render: silentStory(() => (
    <DarkFrame>
      <div style={{ inlineSize: "16rem" }}>
        <Drawer open variant="standard" header="Тёмные разделы">
          <Stack gap={1}>
            <Button variant="text" fullWidth>
              Обзор
            </Button>
            <Button variant="text" fullWidth>
              Архив
            </Button>
          </Stack>
        </Drawer>
      </div>
    </DarkFrame>
  )),
};

/* ------------------------------------------------------------------ */
/* Breadcrumbs                                                         */
/* ------------------------------------------------------------------ */

export const BreadcrumbsPlayground: Story = {
  name: "Breadcrumbs",
  args: {
    items: [
      { key: "home", label: "Главная", href: "#/" },
      { key: "projects", label: "Проекты", href: "#/projects" },
      { key: "design", label: "Дизайн", href: "#/projects/design" },
      { key: "nav", label: "Навигация", href: "#/projects/design/nav" },
      { key: "spec", label: "Спецификация" },
    ],
    label: "Хлебные крошки",
  },
  argTypes: {
    items: {
      control: "object",
      description: "Пункты: `{ key, label, href? }`; последний — текущий",
    },
    maxItems: {
      control: { type: "number", min: 0, max: 8 },
      description: "`maxItems` (0 — без сворачивания)",
      table: { defaultValue: { summary: "undefined" } },
    },
    separator: { control: "text", description: "Разделитель между пунктами" },
    label: { control: "text", description: "Доступное имя `nav`" },
    onItemClick: { action: "crumb-click", description: "Клик по крошке" },
  },
  render: silentStory<NavigationArgs>((args) => (
    <Breadcrumbs
      items={breadcrumbItems(args.items, args.onItemClick)}
      maxItems={args.maxItems > 0 ? args.maxItems : undefined}
      separator={args.separator}
      label={args.label}
    />
  )),
};

export const BreadcrumbsCollapsed: Story = {
  name: "Breadcrumbs: сворачивание",
  parameters: { controls: { disable: true } },
  render: silentStory(() => {
    const items = breadcrumbItems(longCrumbs, () => undefined);
    return (
      <Stack gap={4}>
        <Stack gap={1}>
          <Text variant="label-large">maxItems=3</Text>
          <Breadcrumbs items={items} maxItems={3} />
        </Stack>
        <Stack gap={1}>
          <Text variant="label-large">maxItems=4</Text>
          <Breadcrumbs items={items} maxItems={4} separator="›" />
        </Stack>
        <Stack gap={1}>
          <Text variant="label-large">maxItems=5</Text>
          <Breadcrumbs items={items} maxItems={5} />
        </Stack>
        <Stack gap={1}>
          <Text variant="label-large">без сворачивания</Text>
          <Breadcrumbs items={items} />
        </Stack>
      </Stack>
    );
  }),
};

export const BreadcrumbsLongLabels: Story = {
  name: "Breadcrumbs: длинные подписи",
  parameters: { controls: { disable: true } },
  render: silentStory(() => (
    <div style={{ maxWidth: "22rem" }}>
      <Breadcrumbs items={breadcrumbItems(longCrumbs, () => undefined)} maxItems={4} />
    </div>
  )),
};

export const BreadcrumbsManual: Story = {
  name: "Breadcrumbs: ручная сборка и иконки",
  parameters: { controls: { disable: true } },
  render: silentStory(() => (
    <Stack gap={4}>
      <Breadcrumbs
        items={breadcrumbItems(
          [
            { key: "home", label: "Главная", href: "#/" },
            { key: "library", label: "Библиотека", href: "#/library" },
            { key: "component", label: "Breadcrumbs" },
          ],
          () => undefined,
        )}
        separator={<ArrowForwardIcon />}
        label="Путь до компонента"
      />
      <Breadcrumbs
        items={breadcrumbItems(
          [
            { key: "root", label: "Корень", href: "#/" },
            { key: "current", label: "Текущая страница" },
          ],
          () => undefined,
        )}
        label="Короткий путь"
      />
    </Stack>
  )),
};

export const BreadcrumbsDark: Story = {
  name: "Breadcrumbs: тёмная тема",
  parameters: { controls: { disable: true } },
  render: silentStory(() => (
    <DarkFrame minHeight="8rem">
      <Breadcrumbs items={breadcrumbItems(longCrumbs, () => undefined)} maxItems={4} />
    </DarkFrame>
  )),
};

/* ------------------------------------------------------------------ */
/* Pagination                                                          */
/* ------------------------------------------------------------------ */

export const PaginationPlayground: Story = {
  name: "Pagination",
  args: { disabled: false, label: "Постраничная навигация" },
  argTypes: {
    page: { control: { type: "number", min: 1, max: 40 }, description: "Текущая страница" },
    pageCount: {
      control: { type: "number", min: 1, max: 200 },
      description: "Всего страниц",
    },
    siblingCount: {
      control: { type: "range", min: 0, max: 3, step: 1 },
      description: "Соседних страниц слева и справа",
      table: { defaultValue: { summary: "1" } },
    },
    disabled: { control: "boolean", description: "Отключить навигацию" },
    label: { control: "text", description: "Доступное имя `nav`" },
    onChange: { action: "page-change", description: "Запрос перехода на страницу" },
  },
  render: silentStory<NavigationArgs>((args) => {
    const [page, setPage] = createSignal(args.page);
    return (
      <Stack gap={2}>
        <Pagination
          page={page()}
          pageCount={args.pageCount}
          siblingCount={args.siblingCount}
          disabled={args.disabled}
          label={args.label}
          onChange={(next) => {
            setPage(next);
            args.onChange(next);
          }}
        />
        <Text variant="body-small" tone="muted">
          Текущая страница: {page()} из {args.pageCount}
        </Text>
      </Stack>
    );
  }),
};

export const PaginationManyPages: Story = {
  name: "Pagination: много страниц",
  parameters: { controls: { disable: true } },
  render: silentStory(() => (
    <Stack gap={3}>
      <Pagination page={1} pageCount={100} />
      <Pagination page={50} pageCount={100} siblingCount={0} />
      <Pagination page={50} pageCount={100} siblingCount={2} />
      <Pagination page={100} pageCount={100} />
    </Stack>
  )),
};

export const PaginationEdges: Story = {
  name: "Pagination: края и отключение",
  parameters: { controls: { disable: true } },
  render: silentStory(() => (
    <Stack gap={3}>
      <Pagination page={1} pageCount={20} />
      <Pagination page={10} pageCount={20} />
      <Pagination page={20} pageCount={20} />
      <Pagination page={1} pageCount={1} />
      <Pagination page={2} pageCount={5} disabled />
    </Stack>
  )),
};

export const PaginationSiblings: Story = {
  name: "Pagination: siblingCount",
  parameters: { controls: { disable: true } },
  render: silentStory(() => (
    <Stack gap={3}>
      <Text variant="body-small" tone="muted">
        Число кнопок стабильно: `2 * siblingCount + 5`.
      </Text>
      <Pagination page={8} pageCount={30} siblingCount={0} />
      <Pagination page={8} pageCount={30} siblingCount={1} />
      <Pagination page={8} pageCount={30} siblingCount={2} />
      <Pagination page={8} pageCount={30} siblingCount={3} />
    </Stack>
  )),
};

export const PaginationMobile: Story = {
  name: "Pagination: mobile 360px",
  globals: { viewport: "mobile360" },
  parameters: { controls: { disable: true } },
  render: silentStory(() => (
    <Stack gap={3}>
      <Text variant="body-small" tone="muted">
        На узком экране хвост диапазона сжимается многоточием, стрелки остаются
        доступными.
      </Text>
      <Pagination page={6} pageCount={40} siblingCount={1} />
    </Stack>
  )),
};

export const PaginationDark: Story = {
  name: "Pagination: тёмная тема",
  parameters: { controls: { disable: true } },
  render: silentStory(() => (
    <DarkFrame minHeight="8rem">
      <Pagination page={4} pageCount={12} />
    </DarkFrame>
  )),
};

/* ------------------------------------------------------------------ */
/* Комбинированный сценарий                                            */
/* ------------------------------------------------------------------ */

export const NavigationScenario: Story = {
  name: "Сценарий: мобильная навигация и вкладки",
  parameters: { controls: { disable: true } },
  render: silentStory(() => {
    const [tab, setTab] = createSignal("overview");
    const [nav, setNav] = createSignal("home");
    return (
      <Stack gap={4}>
        <TopAppBar
          variant="small"
          title="Проект «Платформа»"
          leading={
            <IconButton label="Назад">
              <ArrowBackIcon />
            </IconButton>
          }
          actions={
            <IconButton label="Ещё">
              <MoreVertIcon />
            </IconButton>
          }
        />
        <Breadcrumbs
          items={breadcrumbItems(
            [
              { key: "home", label: "Главная", href: "#/" },
              { key: "projects", label: "Проекты", href: "#/projects" },
              { key: "platform", label: "Платформа" },
            ],
            () => undefined,
          )}
          maxItems={3}
        />
        <Tabs items={tabItems} value={tab()} onValueChange={setTab} label="Разделы" />
        <Pagination page={2} pageCount={9} />
        <NavigationBar
          items={navItems([
            { key: "home", label: "Главная" },
            { key: "search", label: "Поиск" },
            { key: "saved", label: "Сохранённое" },
            { key: "profile", label: "Профиль" },
          ])}
          value={nav()}
          onValueChange={setNav}
          label="Нижняя навигация"
        />
        <Text variant="body-small" tone="muted">
          Активная вкладка: {tab()}, нижний пункт: {nav()}.
        </Text>
      </Stack>
    );
  }),
};
