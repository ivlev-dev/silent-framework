import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal, For, onCleanup, Show } from "@ivlev-dev/silent-core";
import {
  Alert,
  Avatar,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Divider,
  FieldGroup,
  FormActions,
  Grid,
  Heading,
  Inline,
  MenuIcon,
  NavigationBar,
  NavigationRail,
  SearchIcon,
  Select,
  Stack,
  Surface,
  Switch,
  Table,
  Tabs,
  Tag,
  Text,
  TextField,
  TopAppBar,
  type NavigationBarItemData,
  type NavigationRailItemData,
  type TableColumn,
  type TableSortDirection,
  type TabItem,
  type TagVariant,
} from "@ivlev-dev/silent-ui";
import { AlertDialog } from "../../ui/src/components/alert-dialog/index.js";
import { Dialog } from "../../ui/src/components/dialog/index.js";
import { InviteForm, LoginForm, SettingsForm } from "./pattern-demo.models.js";
import { silentStory } from "./silent-story.js";

/**
 * Patterns — готовые экраны из компонентов дизайн-системы. Controls здесь
 * отключены: это композиционные примеры, а не playground отдельного
 * компонента. Формы внутри паттернов построены на настоящем
 * `@ivlev-dev/silent-form` (`@Field`/`@Label`/`@Required`/`@IsEmail`), поэтому
 * ошибки, `touched` и `isSubmitting` приходят из формы, а не из локальной
 * проверки по месту. Пакет импортируется собранным (`dist`) — так тип `Form`
 * совпадает с тем, что использует `@ivlev-dev/silent-ui/form`.
 */
const meta = {
  title: "Patterns",
  tags: ["autodocs"],
  parameters: {
    controls: { disable: true },
    docs: {
      description: {
        component: [
          "Композиционные экраны: форма с реальной `@ivlev-dev/silent-form`,",
          "dashboard (nav rail + cards + table), settings (tabs + form), auth,",
          "двухшаговый dialog flow, адаптивный экран (360/840) и широкая",
          "4K-витрина (2560). Каждый паттерн монтируется тем же рантаймом, что и",
          "приложение, и освобождает форму/эффекты при размонтировании.",
        ].join(" "),
      },
      canvas: { sourceState: "shown" },
    },
  },
} satisfies Meta;

export default meta;

type Story = StoryObj;

/* ------------------------------------------------------------------ */
/* Общий CSS паттернов                                                 */
/* ------------------------------------------------------------------ */

/**
 * Адаптив паттернов держим в story, а не в компонентах: на ≤840px
 * dashboard меняет rail на нижнюю навигацию, а у form/settings подвал
 * становится одноколоночным. Все значения — токены темы.
 */
const PATTERN_CSS = `
  /* Dashboard: rail → bottom navigation на мобильных. */
  .pattern-dashboard {
    display: flex;
    min-block-size: 100dvh;
    background: var(--sui-color-surface);
    color: var(--sui-color-on-surface);
  }

  .pattern-dashboard__rail {
    flex: 0 0 auto;
  }

  .pattern-dashboard__main {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-inline-size: 0;
  }

  .pattern-dashboard__content {
    flex: 1 1 auto;
    min-inline-size: 0;
    padding: var(--sui-space-4);
  }

  .pattern-dashboard__bottom {
    display: none;
  }

  .pattern-dashboard__stats {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--sui-space-3);
  }

  .pattern-dashboard__stats > * {
    min-inline-size: 0;
  }

  @media (min-width: 600px) {
    .pattern-dashboard__stats {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (min-width: 840px) {
    .pattern-dashboard__stats {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }

  @media (max-width: 840px) {
    .pattern-dashboard {
      display: block;
    }

    .pattern-dashboard__rail {
      display: none;
    }

    .pattern-dashboard__main {
      min-block-size: 100dvh;
      padding-block-end: calc(
        var(--sui-space-10) + var(--sui-space-8) + env(safe-area-inset-bottom, 0px)
      );
    }

    .pattern-dashboard__bottom {
      display: block;
      position: fixed;
      inset-inline: 0;
      inset-block-end: 0;
      z-index: 4;
    }
  }

  @media (max-width: 380px) {
    .pattern-dashboard__content {
      padding: var(--sui-space-3);
    }
  }

  /*
   * Projects: пока карточка уже табличного минимума (36rem), вместо таблицы
   * показываем список. Переключение — только CSS (container query + display),
   * поэтому оно работает и для мок-экранов фиксированной ширины.
   */
  .pattern-projects {
    container-type: inline-size;
  }

  .pattern-projects__table {
    display: none;
  }

  .pattern-projects__list {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
    min-inline-size: 0;
  }

  .pattern-projects__item {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      "name status"
      "owner status";
    align-items: center;
    gap: var(--sui-space-1) var(--sui-space-3);
    min-inline-size: 0;
    padding-block: var(--sui-space-2);
    border-block-end: var(--sui-hairline) solid var(--sui-color-outline-variant);
  }

  .pattern-projects__item:last-child {
    border-block-end: 0;
  }

  .pattern-projects__name {
    grid-area: name;
    min-inline-size: 0;
    overflow-wrap: anywhere;
  }

  .pattern-projects__owner {
    grid-area: owner;
    min-inline-size: 0;
    overflow-wrap: anywhere;
  }

  .pattern-projects__status {
    grid-area: status;
    justify-self: end;
  }

  @container (min-width: 36rem) {
    .pattern-projects__table {
      display: block;
    }

    .pattern-projects__list {
      display: none;
    }
  }

  /* Form: подвал на мобильном — сброс над submit на всю ширину. */
  .pattern-form {
    inline-size: 100%;
    margin-inline: auto;
  }

  .pattern-form__actions {
    margin-block-start: var(--sui-space-1);
  }

  @media (max-width: 480px) {
    .pattern-form[data-padding] {
      --sui-box-padding: var(--sui-space-4);
    }

    .pattern-form__actions {
      gap: var(--sui-space-2);
    }

    .pattern-form__actions > .sui-button {
      inline-size: 100%;
    }
  }

  @media (max-width: 380px) {
    .pattern-form[data-padding] {
      --sui-box-padding: var(--sui-space-3);
    }
  }

  /* Settings: подсказка о прокрутке вкладок и ровный подвал. */
  .pattern-settings {
    inline-size: 100%;
    margin-inline: auto;
  }

  .pattern-settings__tabs-wrap {
    position: relative;
    min-inline-size: 0;
    margin-block-end: var(--sui-space-1);
  }

  .pattern-settings__hint {
    display: none;
  }

  .pattern-settings__footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--sui-space-3);
  }

  .pattern-settings__actions {
    margin-block-start: 0;
  }

  @media (max-width: 600px) {
    .pattern-settings[data-padding] {
      --sui-box-padding: var(--sui-space-4);
    }

    .pattern-settings__tabs-wrap::after {
      content: "→";
      position: absolute;
      inset-block-start: calc(
        (var(--sui-control-height-lg) * var(--sui-density) - var(--sui-space-6)) / 2
      );
      inset-inline-end: 0;
      display: grid;
      place-items: center;
      inline-size: var(--sui-space-8);
      block-size: var(--sui-space-6);
      background: linear-gradient(to right, rgba(0, 0, 0, 0), var(--sui-color-surface) 60%);
      color: var(--sui-color-on-surface-variant);
      font-size: 1rem;
      pointer-events: none;
    }

    .pattern-settings__hint {
      display: block;
    }

    .pattern-settings__footer {
      flex-direction: column;
      align-items: stretch;
    }

    .pattern-settings__actions {
      inline-size: 100%;
    }

    .pattern-settings__actions > .sui-button {
      inline-size: 100%;
    }
  }

  @media (max-width: 380px) {
    .pattern-settings[data-padding] {
      --sui-box-padding: var(--sui-space-3);
    }
  }

  /* Wide: ограниченная мера на 4K, карточки не растягиваются. */
  .pattern-wide {
    inline-size: 100%;
    max-inline-size: var(--sui-content-wide-max);
    margin-inline: auto;
  }

  .pattern-wide__stats {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--sui-space-3);
  }

  .pattern-wide__stats > * {
    min-inline-size: 0;
  }

  @media (min-width: 600px) {
    .pattern-wide__stats {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (min-width: 1200px) {
    .pattern-wide__stats {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }

  .pattern-wide__split {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--sui-space-4);
  }

  /* Витрина responsive: рамки устройств по центру, без пустого края. */
  .pattern-responsive__screens {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: center;
    gap: var(--sui-space-6);
  }

  .pattern-wide__primary {
    flex: 3 1 30rem;
    min-inline-size: 0;
  }

  .pattern-wide__side {
    flex: 1 1 17.5rem;
    min-inline-size: 0;
  }
`;

function PatternCss(): Node {
  return <style>{PATTERN_CSS}</style>;
}

/* ------------------------------------------------------------------ */
/* 1. Форма на настоящей @ivlev-dev/silent-form                        */
/* ------------------------------------------------------------------ */

function FormPattern(): Node {
  const form = new InviteForm({ formId: "story-invite" });
  onCleanup(() => form.dispose());

  const [sent, setSent] = createSignal("");

  const submit = form.onSubmit(async (instance) => {
    if (instance.email === "taken@example.com") {
      instance.setFieldErrors("email", "Этот адрес уже занят");
      return;
    }
    setSent(`${instance.name} получит письмо на ${instance.email}.`);
  });

  const name = form.getFieldProps("name");
  const email = form.getFieldProps("email");
  const role = form.getFieldProps("role");
  const consent = form.getFieldProps("consent");

  return (
    <Box class="pattern-form" padding={5} style={{ "max-inline-size": "640px" }}>
      <PatternCss />
      <form onSubmit={submit} novalidate>
        <Stack gap={4}>
          <Stack gap={1}>
            <Heading level={2}>Пригласить участника</Heading>
            <Text tone="muted">
              Поля проверяет silent-form: ошибки появляются после blur или
              submit, а кнопка получает isSubmitting.
            </Text>
          </Stack>

          <Show when={sent() !== ""}>
            <Alert variant="success" title="Приглашение отправлено" dismissible={false}>
              {sent()}
            </Alert>
          </Show>
          <FieldGroup legend="Данные участника" columns={2} maxWidth="default">
            <TextField field={name} placeholder="Ада Ловлейс" />
            <TextField
              field={email}
              type="email"
              placeholder="ada@example.com"
              hint="На этот адрес уйдёт приглашение"
            />
            <Select
              field={role}
              placeholder="Выберите роль"
              options={[
                { value: "member", label: "Участник" },
                { value: "admin", label: "Администратор" },
                { value: "guest", label: "Гость", disabled: true },
              ]}
            />
            <Checkbox
              field={consent}
              description="Сразу добавить участника в команду"
            />
          </FieldGroup>

          <Divider />

          <FormActions
            class="pattern-form__actions"
            align="end"
            resetLabel="Сбросить"
            submitLabel="Отправить приглашение"
            loading={form.isSubmitting}
            onReset={() => {
              setSent("");
            }}
            onSubmit={() => undefined}
          />
        </Stack>
      </form>
    </Box>
  );
}

export const Form: Story = {
  name: "Form (real silent-form)",
  parameters: { layout: "fullscreen" },
  render: silentStory(() => FormPattern()),
};

/* ------------------------------------------------------------------ */
/* 2. Dashboard: nav rail + cards + table                              */
/* ------------------------------------------------------------------ */

interface Project {
  readonly id: number;
  readonly name: string;
  readonly owner: string;
  readonly status: "В работе" | "Ревью" | "Готово";
}

const PROJECTS: readonly Project[] = [
  { id: 1, name: "Дизайн-система", owner: "Ада", status: "В работе" },
  { id: 2, name: "Storybook", owner: "Грейс", status: "Ревью" },
  { id: 3, name: "SSR-пул", owner: "Алан", status: "Готово" },
];

const PROJECT_COLUMNS: readonly TableColumn<Project>[] = [
  { key: "name", header: "Проект", sortable: true, truncate: true },
  { key: "owner", header: "Владелец" },
  { key: "status", header: "Статус", align: "end" },
];

const RAIL_ITEMS: readonly NavigationRailItemData[] = [
  { key: "overview", label: "Обзор", icon: () => <MenuIcon /> },
  { key: "search", label: "Поиск", icon: () => <SearchIcon />, badge: "3" },
  { key: "team", label: "Команда", icon: () => <Avatar initials="АЛ" alt="Ада Ловлейс" size="sm" /> },
];

/** Те же 3 пункта для нижней навигации на ≤840px. */
const BAR_ITEMS: readonly NavigationBarItemData[] = RAIL_ITEMS;

function statCard(title: string, value: string, hint: string): Node {
  return (
    <Card variant="outlined" padding={4}>
      <Stack gap={1}>
        <Text variant="label-medium" tone="muted">
          {title}
        </Text>
        <Heading level={3}>{value}</Heading>
        <Text variant="body-small" tone="muted">
          {hint}
        </Text>
      </Stack>
    </Card>
  );
}

function sortedProjects(
  sort: { key: string; direction: TableSortDirection } | null,
): readonly Project[] {
  if (sort === null) return PROJECTS;
  const direction = sort.direction === "ascending" ? 1 : -1;
  return [...PROJECTS].sort(
    (left, right) =>
      String(left[sort.key as keyof Project]).localeCompare(
        String(right[sort.key as keyof Project]),
        "ru",
      ) * direction,
  );
}

function projectStatusVariant(status: Project["status"]): TagVariant {
  if (status === "Готово") return "success";
  if (status === "Ревью") return "warning";
  return "info";
}

function ProjectsCard(props: {
  readonly caption: string;
  readonly sort: { key: string; direction: TableSortDirection } | null;
  readonly onSort: (key: string, direction: TableSortDirection) => void;
}): Node {
  const rows = sortedProjects(props.sort);

  return (
    <Card
      class="pattern-projects"
      header={
        <Inline justify="between" align="center" wrap>
          <Heading level={3}>Проекты</Heading>
          <Button size="sm" variant="tonal">
            Создать
          </Button>
        </Inline>
      }
    >
      <div
        class="pattern-projects__table"
        style={{ overflowX: "auto" }}
        tabindex={0}
        role="region"
        aria-label="Проекты команды, таблица с горизонтальной прокруткой"
      >
        <Table
          caption={props.caption}
          columns={PROJECT_COLUMNS}
          rows={rows}
          rowKey={(row) => row.id}
          dense
          sortKey={props.sort?.key}
          sortDirection={props.sort?.direction}
          onSort={props.onSort}
        />
      </div>

      {/* Узкая карточка: та же таблица данных списком, без горизонтального скролла. */}
      <ul class="pattern-projects__list" aria-label="Проекты команды, список">
        <For each={rows} keyOf={(row) => row.id}>
          {(row) => (
            <li class="pattern-projects__item">
              <Text class="pattern-projects__name" variant="title-small">
                {row.name}
              </Text>
              <Text class="pattern-projects__owner" variant="body-small" tone="muted">
                Владелец: {row.owner}
              </Text>
              <Tag class="pattern-projects__status" variant={projectStatusVariant(row.status)}>
                {row.status}
              </Tag>
            </li>
          )}
        </For>
      </ul>
    </Card>
  );
}

function DashboardPattern(): Node {
  const [section, setSection] = createSignal("overview");
  const [sort, setSort] = createSignal<{ key: string; direction: TableSortDirection } | null>(null);

  return (
    <div class="pattern-dashboard">
      <PatternCss />
      <NavigationRail
        class="pattern-dashboard__rail"
        items={RAIL_ITEMS}
        value={section()}
        onValueChange={setSection}
        expanded
        label="Разделы dashboard"
      />
      <div class="pattern-dashboard__main">
        <TopAppBar
          title="Обзор проектов"
          sticky
          actions={
            <Inline gap={2} align="center">
              <Badge count={3} label="Требуют внимания" />
              <Avatar initials="АЛ" alt="Ада Ловлейс" size="sm" status="online" />
            </Inline>
          }
        />
        <div class="pattern-dashboard__content">
          <Stack gap={4}>
            <div class="pattern-dashboard__stats">
              {statCard("Активные", "12", "+3 за неделю")}
              {statCard("В ревью", "4", "2 ждут вас")}
              {statCard("Ср. время", "1,8 д", "−12% к прошлому спринту")}
            </div>

            <ProjectsCard
              caption="Проекты команды"
              sort={sort()}
              onSort={(key, direction) => setSort({ key, direction })}
            />
          </Stack>
        </div>
      </div>
      <NavigationBar
        class="pattern-dashboard__bottom"
        items={BAR_ITEMS}
        value={section()}
        onValueChange={setSection}
        label="Разделы dashboard на мобильном"
      />
    </div>
  );
}

export const Dashboard: Story = {
  name: "Dashboard",
  parameters: { layout: "fullscreen" },
  render: silentStory(() => DashboardPattern()),
};

/* ------------------------------------------------------------------ */
/* 3. Auth screen                                                      */
/* ------------------------------------------------------------------ */

function AuthPattern(): Node {
  const form = new LoginForm({ formId: "story-login" });
  onCleanup(() => form.dispose());

  const [pending, setPending] = createSignal(false);
  const [rejected, setRejected] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    if (timer !== undefined) clearTimeout(timer);
  });

  // Демонстрация асинхронного входа без сети: имитируем ответ сервера.
  const submit = form.onSubmit((instance) => {
    setRejected(false);
    if (instance.password !== "password") {
      setRejected(true);
      return;
    }
    setPending(true);
    timer = setTimeout(() => {
      setPending(false);
      setRejected(true);
    }, 900);
  });

  const email = form.getFieldProps("email");
  const password = form.getFieldProps("password");
  const remember = form.getFieldProps("remember");

  return (
    <Box
      padding={4}
      background="surface-container"
      style={{ display: "grid", "place-items": "center", "min-block-size": "100vh" }}
    >
      <Surface
        tone="surface"
        radius="lg"
        border="outline-variant"
        padding={6}
        style={{ width: "min(100%, 420px)" }}
      >
        <form onSubmit={submit} novalidate>
          <Stack gap={4}>
            <Stack gap={1}>
              <Heading level={2}>Вход в Silent</Heading>
              <Text tone="muted">Используйте рабочую почту и пароль.</Text>
            </Stack>

            <Show when={rejected()}>
              <Alert variant="error" title="Не удалось войти" dismissible={false}>
                Неверный email или пароль. Попробуйте ещё раз.
              </Alert>
            </Show>

            <TextField field={email} type="email" hint="Рабочая почта" />
            <TextField field={password} type="password" hint="Минимум 8 символов" />
            <Checkbox field={remember} description="Не спрашивать 30 дней" />

            <Button type="submit" fullWidth loading={pending()}>
              Войти
            </Button>
            <Text variant="body-small" tone="muted">
              Нет аккаунта? Запросите доступ у администратора.
            </Text>
          </Stack>
        </form>
      </Surface>
    </Box>
  );
}

export const AuthScreen: Story = {
  name: "Auth screen",
  parameters: { layout: "fullscreen" },
  render: silentStory(() => AuthPattern()),
};

/* ------------------------------------------------------------------ */
/* 4. Settings: tabs + real form                                       */
/* ------------------------------------------------------------------ */

function SettingsPattern(): Node {
  const form = new SettingsForm({ formId: "story-settings" });
  onCleanup(() => form.dispose());

  const [tab, setTab] = createSignal("profile");
  const [saved, setSaved] = createSignal("");

  const displayName = form.getFieldProps("displayName");
  const digest = form.getFieldProps("digest");
  const push = form.getFieldProps("push");
  const density = form.getFieldProps("density");

  const submit = form.onSubmit((instance) => {
    setSaved(`Настройки сохранены для «${instance.displayName}».`);
  });

  const items: readonly TabItem[] = [
    {
      key: "profile",
      label: "Профиль",
      content: () => (
        <Stack gap={4}>
          <TextField field={displayName} hint="Видно участникам команды" />
          <TextField
            id="settings-email"
            label="Почта"
            value="ada@example.com"
            readOnly
            hint="Почту меняет администратор"
          />
        </Stack>
      ),
    },
    {
      key: "notifications",
      label: "Уведомления",
      content: () => (
        <Stack gap={4}>
          <Switch
            field={digest}
            description="Раз в неделю: изменения, ревью и упоминания"
          />
          <Switch field={push} description="Только упоминания и назначенные задачи" />
        </Stack>
      ),
    },
    {
      key: "appearance",
      label: "Внешний вид",
      content: () => (
        <Stack gap={4}>
          <Select
            field={density}
            options={[
              { value: "compact", label: "Компактная" },
              { value: "default", label: "Обычная" },
              { value: "comfortable", label: "Просторная" },
            ]}
          />
          <Text variant="body-small" tone="muted">
            Плотность влияет на отступы контролов, но не на типографику.
          </Text>
        </Stack>
      ),
    },
  ];

  return (
    <Box class="pattern-settings" padding={5} style={{ "max-inline-size": "760px" }}>
      <PatternCss />
      <form onSubmit={submit} novalidate>
        <Stack gap={4}>
          <Stack gap={1}>
            <Heading level={2}>Настройки</Heading>
            <Text tone="muted">Изменения применяются после сохранения.</Text>
          </Stack>

          <Show when={saved() !== ""}>
            <Alert variant="success" title="Сохранено" dismissible={false}>
              {saved()}
            </Alert>
          </Show>

          <div class="pattern-settings__tabs-wrap">
            <Tabs items={items} value={tab()} onValueChange={setTab} label="Разделы настроек" />
          </div>
          <Text variant="body-small" tone="muted" class="pattern-settings__hint">
            Разделы прокручиваются вбок →
          </Text>

          <Divider />

          <div class="pattern-settings__footer">
            <Text variant="body-small" tone="muted">
              {form.isDirty ? "Есть несохранённые изменения" : "Все изменения сохранены"}
            </Text>
            <FormActions
              class="pattern-settings__actions"
              align="end"
              resetLabel="Сбросить"
              submitLabel="Сохранить"
              loading={form.isSubmitting}
              onReset={() => {
                setSaved("");
              }}
              onSubmit={() => undefined}
            />
          </div>
        </Stack>
      </form>
    </Box>
  );
}

export const Settings: Story = {
  name: "Settings (tabs + form)",
  parameters: { layout: "fullscreen" },
  render: silentStory(() => SettingsPattern()),
};

/* ------------------------------------------------------------------ */
/* 5. Dialog flow: confirm → delete → result                           */
/* ------------------------------------------------------------------ */

function DialogFlowPattern(): Node {
  const [editing, setEditing] = createSignal(false);
  const [confirming, setConfirming] = createSignal(false);
  const [name, setName] = createSignal("Дизайн-система");
  const [status, setStatus] = createSignal<"idle" | "deleted">("idle");

  return (
    <Box padding={5}>
      <Stack gap={4} style={{ "max-inline-size": "560px" }}>
        <Stack gap={1}>
          <Heading level={2}>Управление проектом</Heading>
          <Text tone="muted">
            Двухшаговый сценарий: редактирование в диалоге, затем подтверждение
            необратимого действия.
          </Text>
        </Stack>

        <Show when={status() === "deleted"}>
          <Alert variant="warning" title="Проект удалён" dismissible={false}>
            «{name()}» перемещён в корзину. Восстановить можно в течение 30 дней.
          </Alert>
        </Show>

        <Card variant="outlined">
          <Inline justify="between" align="center" wrap gap={3}>
            <Stack gap={1}>
              <Heading level={3}>{name()}</Heading>
              <Text variant="body-small" tone="muted">
                Владелец: Ада Ловлейс · 12 участников
              </Text>
            </Stack>
            <Inline gap={2} wrap>
              <Button variant="tonal" onClick={() => setEditing(true)}>
                Переименовать
              </Button>
              <Button variant="text" onClick={() => setConfirming(true)}>
                Удалить
              </Button>
            </Inline>
          </Inline>
        </Card>
      </Stack>

      <Dialog
        open={editing()}
        onOpenChange={setEditing}
        title="Переименовать проект"
        description="Название видно всем участникам команды."
        actions={
          <>
            <Button variant="text" onClick={() => setEditing(false)}>
              Отмена
            </Button>
            <Button onClick={() => setEditing(false)}>Сохранить</Button>
          </>
        }
      >
        <TextField
          id="dialog-project-name"
          label="Название"
          required
          value={name()}
          onInput={(event) => setName((event.currentTarget as HTMLInputElement).value)}
        />
      </Dialog>

      <AlertDialog
        open={confirming()}
        onOpenChange={setConfirming}
        destructive
        title="Удалить проект?"
        description="Проект и его история переместятся в корзину."
        confirmLabel="Удалить"
        onConfirm={() => {
          setConfirming(false);
          setStatus("deleted");
        }}
        onCancel={() => setConfirming(false)}
      />
    </Box>
  );
}

export const DialogFlow: Story = {
  name: "Dialog flow",
  parameters: { layout: "fullscreen" },
  render: silentStory(() => DialogFlowPattern()),
};

/* ------------------------------------------------------------------ */
/* 6. Responsive: 360 / 840                                            */
/* ------------------------------------------------------------------ */

function PhoneScreen(): Node {
  return (
    <div
      style={{
        inlineSize: "360px",
        "max-inline-size": "100%",
        overflow: "hidden",
        border: "1px solid var(--sui-color-outline-variant)",
        "border-radius": "var(--sui-radius-lg)",
        background: "var(--sui-color-surface)",
      }}
      role="group"
      aria-label="Мобильный экран 360px"
    >
      <TopAppBar title="Профиль" />
      <Stack gap={4} style={{ padding: "var(--sui-space-4)" }}>
        <Inline gap={3} align="center">
          <Avatar initials="АЛ" alt="Ада Ловлейс" status="online" />
          <Stack gap={0}>
            <Text variant="title-small">Ада Ловлейс</Text>
            <Text variant="body-small" tone="muted">
              Администратор
            </Text>
          </Stack>
        </Inline>
        <TextField id="phone-name" label="Имя" value="Ада" />
        <TextField id="phone-email" label="Почта" type="email" value="ada@example.com" />
        <Select
          id="phone-role"
          label="Роль"
          value="admin"
          options={[
            { value: "member", label: "Участник" },
            { value: "admin", label: "Администратор" },
          ]}
        />
        <Checkbox id="phone-digest" label="Дайджест" description="Раз в неделю" checked />
        <FormActions align="between" submitLabel="Сохранить" />
        <ProjectsCard caption="Проекты (phone)" sort={null} onSort={() => undefined} />
      </Stack>
    </div>
  );
}

function TabletScreen(): Node {
  const [sort, setSort] = createSignal<{ key: string; direction: TableSortDirection } | null>(null);
  return (
    <div
      style={{
        inlineSize: "840px",
        "max-inline-size": "100%",
        overflow: "hidden",
        border: "1px solid var(--sui-color-outline-variant)",
        "border-radius": "var(--sui-radius-lg)",
        background: "var(--sui-color-surface)",
      }}
      role="group"
      aria-label="Планшетный экран 840px"
    >
      <TopAppBar title="Рабочий стол" />
      <Box padding={4}>
        <Stack gap={4}>
          <Grid columns={3} gap={3}>
            {statCard("Активные", "12", "+3 за неделю")}
            {statCard("В ревью", "4", "2 ждут вас")}
            {statCard("Ср. время", "1,8 д", "−12%")}
          </Grid>
          <FieldGroup legend="Быстрое действие" columns={2}>
            <TextField id="tablet-name" label="Имя" placeholder="Ада" />
            <TextField id="tablet-email" label="Почта" type="email" placeholder="ada@example.com" />
          </FieldGroup>
          <ProjectsCard
            caption="Проекты (tablet)"
            sort={sort()}
            onSort={(key, direction) => setSort({ key, direction })}
          />
        </Stack>
      </Box>
    </div>
  );
}

export const Responsive: Story = {
  name: "Responsive (360 / 840)",
  parameters: { layout: "fullscreen" },
  render: silentStory(() => (
    <Box padding={4} background="surface-container">
      <PatternCss />
      <Stack gap={4}>
        <Stack gap={1}>
          <Heading level={2}>Адаптивная композиция</Heading>
          <Text tone="muted">
            Один набор компонентов: 360px — стек и Full-width контролы, 840px —
            сетка из трёх карточек и двухколоночная форма. Горизонтальные
            таблицы скроллятся внутри своих карточек.
          </Text>
        </Stack>
        <div class="pattern-responsive__screens">
          <PhoneScreen />
          <TabletScreen />
        </div>
      </Stack>
    </Box>
  )),
};

/* ------------------------------------------------------------------ */
/* 7. Wide 4K                                                          */
/* ------------------------------------------------------------------ */

export const Wide4K: Story = {
  name: "Wide 4K (2560)",
  parameters: { layout: "fullscreen", viewport: { defaultViewport: "wide2560" } },
  render: silentStory(() => (
    <Box padding={6} class="pattern-wide">
      <PatternCss />
      <Stack gap={5}>
        <Inline justify="between" align="center" wrap gap={3}>
          <Stack gap={1}>
            <Heading level={1}>Обзор платформы</Heading>
            <Text tone="muted">
              Широкая витрина: 4 метрики в ряд, таблица и вспомогательные панели.
              На 2560px ширина ограничена токеном контента, поэтому строки
              текста и карточки не растягиваются на весь 4K-экран.
            </Text>
          </Stack>
          <Inline gap={2} wrap align="center">
            <Badge count={12} label="События" />
            <Avatar initials="АЛ" alt="Ада Ловлейс" status="online" />
            <Button>Создать проект</Button>
          </Inline>
        </Inline>

        <div class="pattern-wide__stats">
          {statCard("Активные проекты", "12", "+3 за неделю")}
          {statCard("В ревью", "4", "2 ждут вас")}
          {statCard("Среднее время", "1,8 д", "−12% к спринту")}
          {statCard("Участники", "48", "6 онлайн")}
        </div>

        <div class="pattern-wide__split">
          <Card
            variant="outlined"
            header={<Heading level={3}>Проекты</Heading>}
            class="pattern-wide__primary"
          >
            <Table
              caption="Все проекты"
              columns={[
                { key: "name", header: "Проект", sortable: true, truncate: true },
                { key: "owner", header: "Владелец" },
                { key: "status", header: "Статус", align: "end", width: 140 },
              ]}
              rows={PROJECTS}
              rowKey={(row) => row.id}
              stickyHeader
            />
          </Card>
          <Stack gap={4} class="pattern-wide__side">
            <Card variant="outlined" header={<Heading level={3}>Активность</Heading>}>
              <Stack gap={3}>
                <Text variant="body-small">Грейс завершила ревью «Storybook».</Text>
                <Divider />
                <Text variant="body-small">Алан обновил SSR-пул.</Text>
                <Divider />
                <Text variant="body-small">Ада создала проект «Дизайн-система».</Text>
              </Stack>
            </Card>
            <Card variant="outlined">
              <EmptyStateLite />
            </Card>
          </Stack>
        </div>
      </Stack>
    </Box>
  )),
};

function EmptyStateLite(): Node {
  return (
    <Stack gap={2} align="center">
      <Badge variant="info" label="Идеи" count={0} dot />
      <Text variant="title-small">Идей пока нет</Text>
      <Text variant="body-small" tone="muted" align="center">
        Добавьте первую идею — она появится в этом списке.
      </Text>
      <Button size="sm" variant="tonal">
        Добавить
      </Button>
    </Stack>
  );
}
