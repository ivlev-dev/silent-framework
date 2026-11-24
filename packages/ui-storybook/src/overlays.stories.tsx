import type { Meta, StoryObj } from "@storybook/html-vite";
import { fn } from "storybook/test";
import { createSignal, type Children } from "@ivlev-dev/silent-core";
import {
  AddIcon,
  AlertDialog,
  Button,
  CheckIcon,
  Dialog,
  DownloadIcon,
  Inline,
  Menu,
  MenuItem,
  MenuSeparator,
  Popover,
  SearchIcon,
  Sheet,
  Snackbar,
  Stack,
  Surface,
  Text,
  TextField,
  Tooltip,
  WarningIcon,
  type PopoverPlacement,
  type SheetSide,
} from "@ivlev-dev/silent-ui";
import { silentStory } from "./silent-story.js";

/*
 * Витрина оверлеев: Dialog, AlertDialog, Sheet, Popover, Menu, Tooltip и
 * Snackbar. Все взаимодействия показаны в двух режимах:
 *  - Playground — состояния читаются из args (controls перерисовывают story);
 *  - примеры — wrapper-компонент с сигналом, чтобы клик/клавиатура работали
 *    без ручного переключения controls.
 */

interface OverlayArgs {
  readonly open: boolean;
  readonly defaultOpen: boolean;
  readonly title: string;
  readonly description: string;
  readonly children: string;
  readonly closeLabel: string;
  readonly hideClose: boolean;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly hideCancel: boolean;
  readonly destructive: boolean;
  readonly side: SheetSide;
  readonly modal: boolean;
  readonly placement: PopoverPlacement;
  readonly disabled: boolean;
  readonly label: string;
  readonly trigger: string;
  readonly content: string;
  readonly delay: number;
  readonly message: string;
  readonly action: boolean;
  readonly autoHideDuration: number;
  readonly onOpenChange: (open: boolean) => void;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly onSelect: (value: string) => void;
}

const meta = {
  title: "Components/Overlays",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: [
          "Семейство оверлеев дизайн-системы.",
          "**Dialog** — модальный `<dialog>` с focus trap и возвратом фокуса;",
          "**AlertDialog** — подтверждение (`role=\"alertdialog\"`, backdrop не закрывает);",
          "**Sheet** — панель с четырёх сторон, modal/standard;",
          "**Popover** и **Menu** — inline-панели (без Portal) с закрытием по клику",
          "вне и Escape; **Tooltip** — подсказка по hover/focus с задержкой;",
          "**Snackbar** — controlled-уведомление `role=\"status\"` с автоскрытием.",
          "Escape закрывает, фокус возвращается на триггер, фон получает `inert`",
          "у modal-оверлеев. Все состояния управляются `open`/`defaultOpen`.",
        ].join(" "),
      },
      canvas: { sourceState: "shown" },
    },
  },
  argTypes: {
    /*
     * Полный union props семейства — для autodocs/args table. Controls
     * включаются на уровне конкретной story: иначе панель Controls
     * показывала бы props чужих компонентов.
     */
    open: {
      control: false,
      description: "Controlled-состояние открытия",
      table: { category: "Состояние", defaultValue: { summary: "false" } },
    },
    defaultOpen: {
      control: false,
      description: "Начальное состояние для uncontrolled-режима",
      table: { category: "Состояние", defaultValue: { summary: "false" } },
    },
    title: {
      control: false,
      description: "Заголовок (`aria-labelledby`)",
    },
    description: {
      control: false,
      description: "Пояснение (`aria-describedby`)",
    },
    children: {
      control: false,
      description: "Тело оверлея / дополнительный текст",
    },
    trigger: {
      control: false,
      description: "Слот триггера (Popover/Menu)",
    },
    label: {
      control: false,
      description: "Доступное имя панели (Popover/Menu)",
      table: { category: "Доступность" },
    },
    content: {
      control: false,
      description: "Текст подсказки Tooltip",
    },
    closeLabel: {
      control: false,
      description: "Доступное имя крестика (переопределяет RU-строку)",
      table: { category: "Доступность" },
    },
    hideClose: {
      control: false,
      description: "Скрыть крестик — закрытие только через actions",
      table: { defaultValue: { summary: "false" } },
    },
    disabled: {
      control: false,
      description: "Блокирует открытие оверлея",
      table: { defaultValue: { summary: "false" } },
    },
    side: {
      control: false,
      description: "Сторона Sheet: top/right/bottom/left",
      table: { defaultValue: { summary: "right" } },
    },
    modal: {
      control: false,
      description: "Блокировать фон (`inert` + focus trap)",
      table: { defaultValue: { summary: "true" } },
    },
    placement: {
      control: false,
      description: "Сторона Popover/Tooltip",
      table: { defaultValue: { summary: "bottom" } },
    },
    delay: {
      control: false,
      description: "Задержка Tooltip в мс",
      table: { defaultValue: { summary: "500" } },
    },
    destructive: {
      control: false,
      description: "Красная кнопка подтверждения AlertDialog",
      table: { defaultValue: { summary: "false" } },
    },
    confirmLabel: { control: false, description: "Текст подтверждения" },
    cancelLabel: { control: false, description: "Текст отмены" },
    hideCancel: {
      control: false,
      description: "Оставить только подтверждение",
      table: { defaultValue: { summary: "false" } },
    },
    message: { control: false, description: "Текст сообщения Snackbar" },
    action: { control: false, description: "Слот действия снекбара" },
    autoHideDuration: {
      control: false,
      description: "Автоскрытие снекбара, мс; 0 — не скрывать",
      table: { defaultValue: { summary: "5000" } },
    },
    onOpenChange: {
      action: "open-change",
      description: "Запрос смены состояния (Escape, backdrop, крестик, выбор)",
      table: { category: "События" },
    },
    onClose: {
      action: "close",
      description: "Закрытие снекбара — кнопкой или по таймеру",
      table: { category: "События" },
    },
    onConfirm: {
      action: "confirm",
      description: "Подтверждение в AlertDialog",
      table: { category: "События" },
    },
    onCancel: {
      action: "cancel",
      description: "Отмена/Escape в AlertDialog",
      table: { category: "События" },
    },
    onSelect: {
      action: "select",
      description: "Выбор пункта меню",
      table: { category: "События" },
    },
  },
  args: {
    open: true,
    defaultOpen: false,
    title: "Настройки публикации",
    description: "Изменения вступят в силу после подтверждения.",
    children: "Содержимое оверлея: форма, текст или список.",
    closeLabel: "Закрыть",
    hideClose: false,
    confirmLabel: "Удалить",
    cancelLabel: "Отмена",
    hideCancel: false,
    destructive: false,
    side: "right",
    modal: true,
    placement: "bottom",
    disabled: false,
    label: "Действия",
    trigger: "Открыть",
    content: "Сохранить черновик (⌘S)",
    delay: 300,
    message: "Изменения сохранены",
    action: true,
    autoHideDuration: 5000,
    onOpenChange: fn(),
    onClose: fn(),
    onConfirm: fn(),
    onCancel: fn(),
    onSelect: fn(),
  },
} satisfies Meta<OverlayArgs>;

export default meta;

type Story = StoryObj<OverlayArgs>;

/* ------------------------------------------------------------------ */
/* Общие хелперы                                                       */
/* ------------------------------------------------------------------ */

/** Пара «сигнал + проброс action»: клики работают, controls не ломаются. */
function controlledOpen(args: OverlayArgs): readonly [
  () => boolean,
  (next: boolean) => void,
] {
  const [open, setOpen] = createSignal(args.open);
  const change = (next: boolean): void => {
    setOpen(next);
    args.onOpenChange(next);
  };
  return [open, change] as const;
}

function Paragraphs(props: { readonly count: number; readonly prefix?: string }): Node {
  const prefix = props.prefix ?? "Абзац";
  return (
    <Stack gap={3}>
      {Array.from({ length: props.count }, (_value, index) => (
        <Text key={`${prefix}-${index}`}>
          {prefix} {index + 1}. Оверлей прокручивает длинное содержимое, сохраняя
          шапку и действия на месте. Проверьте поведение фокуса и Escape.
        </Text>
      ))}
    </Stack>
  );
}

function DarkFrame(props: { readonly children: Children; readonly minHeight?: string }): Node {
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

const openControl = {
  open: { control: "boolean", description: "Controlled-состояние открытия" },
} as const;

/* ------------------------------------------------------------------ */
/* Dialog                                                              */
/* ------------------------------------------------------------------ */

function DialogDemo(args: OverlayArgs): Node {
  const [open, setOpen] = controlledOpen(args);
  return (
    <Stack gap={3}>
      <Inline gap={2}>
        <Button onClick={() => setOpen(true)}>{args.trigger}</Button>
      </Inline>
      <Dialog
        open={open()}
        onOpenChange={setOpen}
        title={args.title}
        description={args.description}
        closeLabel={args.closeLabel}
        hideClose={args.hideClose}
        actions={
          <>
            <Button variant="text" onClick={() => setOpen(false)}>
              {args.cancelLabel}
            </Button>
            <Button onClick={() => setOpen(false)}>Сохранить</Button>
          </>
        }
      >
        <Stack gap={3}>
          <Text>{args.children}</Text>
          <TextField label="Название" placeholder="Черновик спецификации" />
          <Text variant="body-small" tone="muted">
            Escape и backdrop закрывают; фокус остаётся внутри и возвращается на
            триггер.
          </Text>
        </Stack>
      </Dialog>
    </Stack>
  );
}

export const DialogPlayground: Story = {
  name: "Dialog",
  argTypes: {
    ...openControl,
    defaultOpen: {
      control: false,
      description: "Uncontrolled-режим — см. story «Dialog: uncontrolled»",
    },
    title: { control: "text", description: "Заголовок (`aria-labelledby`)" },
    description: { control: "text", description: "Пояснение (`aria-describedby`)" },
    children: { control: "text", description: "Текст тела диалога" },
    trigger: { control: "text", description: "Текст кнопки-триггера" },
    closeLabel: {
      control: "text",
      description: "Доступное имя крестика",
      table: { category: "Доступность" },
    },
    hideClose: { control: "boolean", description: "Скрыть крестик" },
    onOpenChange: { action: "open-change", description: "Escape/backdrop/крестик" },
  },
  render: silentStory<OverlayArgs>((args) => DialogDemo(args)),
};

export const DialogUncontrolled: Story = {
  name: "Dialog: uncontrolled (defaultOpen)",
  args: { defaultOpen: true },
  argTypes: {
    defaultOpen: { control: "boolean", description: "Начальное состояние без `open`" },
    title: { control: "text", description: "Заголовок" },
    description: { control: "text", description: "Пояснение" },
    closeLabel: {
      control: "text",
      description: "Доступное имя крестика",
      table: { category: "Доступность" },
    },
    hideClose: { control: "boolean", description: "Скрыть крестик" },
    onOpenChange: { action: "open-change", description: "Observer закрытия" },
  },
  render: silentStory<OverlayArgs>((args) => {
    let dialog: HTMLDialogElement | null = null;
    return (
      <Stack gap={3}>
        <Dialog
          defaultOpen={args.defaultOpen}
          onOpenChange={args.onOpenChange}
          ref={(node) => {
            dialog = node as HTMLDialogElement | null;
          }}
          title={args.title}
          description={args.description}
          closeLabel={args.closeLabel}
          hideClose={args.hideClose}
          actions={
            <Button
              onClick={() => {
                dialog?.close();
              }}
            >
              Закрыть
            </Button>
          }
        >
          <Text>
            Uncontrolled-режим: состояние живёт внутри компонента (`defaultOpen`),
            `onOpenChange` остаётся наблюдателем. Переключите control
            `defaultOpen`, чтобы перемонтировать story и открыть диалог снова.
          </Text>
        </Dialog>
      </Stack>
    );
  }),
};

export const DialogLongContent: Story = {
  name: "Dialog: длинный заголовок и прокрутка",
  parameters: { controls: { disable: true } },
  render: silentStory<OverlayArgs>((args) => {
    const [open, setOpen] = createSignal(true);
    return (
      <Stack gap={3}>
        <Inline gap={2}>
          <Button onClick={() => setOpen(true)}>Открыть длинный диалог</Button>
        </Inline>
        <Dialog
          open={open()}
          onOpenChange={setOpen}
          title="Публикация регламента обработки инцидентов информационной безопасности"
          description="Длинный заголовок переносится, тело прокручивается, а действия остаются видимыми."
          actions={
            <>
              <Button variant="text" onClick={() => setOpen(false)}>
                Позже
              </Button>
              <Button onClick={() => setOpen(false)}>Опубликовать</Button>
            </>
          }
        >
          <Paragraphs count={8} prefix="Раздел регламента" />
        </Dialog>
        <Text variant="body-small" tone="muted">
          {args.children}
        </Text>
      </Stack>
    );
  }),
};

export const DialogNested: Story = {
  name: "Dialog: вложенные оверлеи",
  parameters: { controls: { disable: true } },
  render: silentStory(() => {
    const [dialogOpen, setDialogOpen] = createSignal(false);
    const [alertOpen, setAlertOpen] = createSignal(false);
    const [popoverOpen, setPopoverOpen] = createSignal(false);
    return (
      <Stack gap={3}>
        <Inline gap={2}>
          <Button onClick={() => setDialogOpen(true)}>Открыть диалог</Button>
        </Inline>
        <Dialog
          open={dialogOpen()}
          onOpenChange={setDialogOpen}
          title="Экспорт проекта"
          description="Внутри диалога открываются поповер и подтверждение — каждый слой управляет фокусом сам."
          actions={
            <>
              <Button variant="text" onClick={() => setAlertOpen(true)}>
                Сбросить настройки
              </Button>
              <Button onClick={() => setDialogOpen(false)}>Готово</Button>
            </>
          }
        >
          <Stack gap={3}>
            <Popover
              open={popoverOpen()}
              onOpenChange={setPopoverOpen}
              placement="bottom"
              label="Параметры экспорта"
              trigger={<Button variant="outlined">Параметры экспорта</Button>}
            >
              <Stack gap={2}>
                <Text variant="title-small">Формат файла</Text>
                <Text variant="body-small" tone="muted">
                  Поповер закрывается по Escape и возвращает фокус на триггер.
                </Text>
                <Inline gap={2} justify="end">
                  <Button size="sm" variant="text" onClick={() => setPopoverOpen(false)}>
                    Отмена
                  </Button>
                  <Button size="sm" onClick={() => setPopoverOpen(false)}>
                    Выбрать
                  </Button>
                </Inline>
              </Stack>
            </Popover>
            <Text variant="body-small" tone="muted">
              AlertDialog — следующий слой: backdrop его не закрывает, Escape
              работает как отмена.
            </Text>
          </Stack>
        </Dialog>
        <AlertDialog
          open={alertOpen()}
          onOpenChange={setAlertOpen}
          destructive
          title="Сбросить настройки экспорта?"
          description="Действие необратимо: параметры вернутся к значениям по умолчанию."
          confirmLabel="Сбросить"
          onConfirm={() => setAlertOpen(false)}
          onCancel={() => setAlertOpen(false)}
        />
      </Stack>
    );
  }),
};

export const DialogFocusRestore: Story = {
  name: "Dialog: возврат фокуса",
  parameters: { controls: { disable: true } },
  render: silentStory(() => {
    const [open, setOpen] = createSignal(false);
    return (
      <Stack gap={3}>
        <Inline gap={2}>
          <Button onClick={() => setOpen(true)}>Открыть и проверить фокус</Button>
          <Button variant="outlined">Соседняя кнопка</Button>
        </Inline>
        <Dialog
          open={open()}
          onOpenChange={setOpen}
          title="Проверка focus management"
          description="Откройте, перейдите по Tab, закройте Escape — фокус вернётся на кнопку-триггер."
          actions={<Button onClick={() => setOpen(false)}>Понятно</Button>}
        >
          <Stack gap={2}>
            <TextField label="Поле внутри диалога" />
            <Text variant="body-small" tone="muted">
              Tab циклически ходит по фокусируемым элементам панели.
            </Text>
          </Stack>
        </Dialog>
      </Stack>
    );
  }),
};

export const DialogDark: Story = {
  name: "Dialog: тёмная тема",
  parameters: { controls: { disable: true } },
  render: silentStory(() => {
    const [open, setOpen] = createSignal(true);
    return (
      <DarkFrame>
        <Inline gap={2}>
          <Button onClick={() => setOpen(true)}>Открыть диалог</Button>
        </Inline>
        <Dialog
          open={open()}
          onOpenChange={setOpen}
          title="Тёмная тема"
          description={'Панель и скрим наследуют токены обёртки `data-theme="dark"`.'}
          actions={<Button onClick={() => setOpen(false)}>Закрыть</Button>}
        >
          <Paragraphs count={2} prefix="Абзац" />
        </Dialog>
      </DarkFrame>
    );
  }),
};

/* ------------------------------------------------------------------ */
/* AlertDialog                                                         */
/* ------------------------------------------------------------------ */

function AlertDialogDemo(args: OverlayArgs): Node {
  const [open, setOpen] = controlledOpen(args);
  return (
    <Stack gap={3}>
      <Inline gap={2}>
        <Button variant={args.destructive ? "filled" : "tonal"} onClick={() => setOpen(true)}>
          {args.trigger}
        </Button>
      </Inline>
      <AlertDialog
        open={open()}
        onOpenChange={setOpen}
        destructive={args.destructive}
        title={args.title}
        description={args.description}
        confirmLabel={args.confirmLabel}
        cancelLabel={args.cancelLabel}
        hideCancel={args.hideCancel}
        onConfirm={() => {
          args.onConfirm();
          setOpen(false);
        }}
        onCancel={() => {
          args.onCancel();
          setOpen(false);
        }}
      >
        <Text variant="body-small" tone="muted">
          {args.children}
        </Text>
      </AlertDialog>
    </Stack>
  );
}

export const AlertDialogPlayground: Story = {
  name: "AlertDialog",
  argTypes: {
    ...openControl,
    destructive: { control: "boolean", description: "Красная кнопка подтверждения" },
    title: { control: "text", description: "Заголовок" },
    description: { control: "text", description: "Пояснение" },
    children: { control: "text", description: "Дополнительный текст" },
    trigger: { control: "text", description: "Текст кнопки-триггера" },
    confirmLabel: { control: "text", description: "Текст подтверждения" },
    cancelLabel: { control: "text", description: "Текст отмены" },
    hideCancel: {
      control: "boolean",
      description: "Оставить только подтверждение",
      table: { defaultValue: { summary: "false" } },
    },
    onOpenChange: { action: "open-change", description: "Escape = отмена" },
    onConfirm: { action: "confirm", description: "Подтверждение действия" },
    onCancel: { action: "cancel", description: "Отмена или Escape" },
  },
  render: silentStory<OverlayArgs>((args) => AlertDialogDemo(args)),
};

export const AlertDialogDestructive: Story = {
  name: "AlertDialog: необратимое действие",
  parameters: { controls: { disable: true } },
  render: silentStory(() => {
    const [open, setOpen] = createSignal(false);
    return (
      <Stack gap={3}>
        <Inline gap={2}>
          <Button onClick={() => setOpen(true)}>Удалить проект</Button>
        </Inline>
        <AlertDialog
          open={open()}
          onOpenChange={setOpen}
          destructive
          title="Удалить проект «Платформа» без возможности восстановления?"
          description="Будут удалены все документы, история изменений и приглашения участников. Резервная копия хранится 30 дней."
          confirmLabel="Удалить навсегда"
          cancelLabel="Оставить проект"
          onConfirm={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        >
          <Text variant="body-small" tone="muted">
            Фокус изначально ставится на действия; клик по фону не закрывает
            диалог, Escape работает как отмена.
          </Text>
        </AlertDialog>
      </Stack>
    );
  }),
};

export const AlertDialogSingleAction: Story = {
  name: "AlertDialog: одно действие",
  parameters: { controls: { disable: true } },
  render: silentStory(() => {
    const [open, setOpen] = createSignal(false);
    return (
      <Stack gap={3}>
        <Inline gap={2}>
          <Button variant="tonal" onClick={() => setOpen(true)}>
            Показать информационное подтверждение
          </Button>
        </Inline>
        <AlertDialog
          open={open()}
          onOpenChange={setOpen}
          hideCancel
          title="Сессия истекает через 5 минут"
          description="Сохраните изменения, чтобы не потерять прогресс."
          confirmLabel="Продолжить работу"
          onConfirm={() => setOpen(false)}
        />
      </Stack>
    );
  }),
};

export const AlertDialogLong: Story = {
  name: "AlertDialog: длинный текст",
  parameters: { controls: { disable: true } },
  render: silentStory(() => {
    const [open, setOpen] = createSignal(true);
    return (
      <Stack gap={3}>
        <Inline gap={2}>
          <Button onClick={() => setOpen(true)}>Открыть</Button>
        </Inline>
        <AlertDialog
          open={open()}
          onOpenChange={setOpen}
          destructive
          title="Отозвать доступ у всех приглашённых участников рабочего пространства?"
          description="Отзыв затронет 128 участников из 14 команд. Активные сессии завершатся немедленно, незавершённые задачи останутся в общем пуле."
          confirmLabel="Отозвать доступ"
          onConfirm={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        >
          <Paragraphs count={4} prefix="Последствие" />
        </AlertDialog>
      </Stack>
    );
  }),
};

export const AlertDialogDark: Story = {
  name: "AlertDialog: тёмная тема",
  parameters: { controls: { disable: true } },
  render: silentStory(() => {
    const [open, setOpen] = createSignal(true);
    return (
      <DarkFrame>
        <Inline gap={2}>
          <Button onClick={() => setOpen(true)}>Удалить</Button>
        </Inline>
        <AlertDialog
          open={open()}
          onOpenChange={setOpen}
          destructive
          title="Удалить комментарий?"
          description="Комментарий исчезнет из обсуждения без возможности восстановления."
          confirmLabel="Удалить"
          onConfirm={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      </DarkFrame>
    );
  }),
};

/* ------------------------------------------------------------------ */
/* Sheet                                                               */
/* ------------------------------------------------------------------ */

function SheetDemo(args: OverlayArgs): Node {
  const [open, setOpen] = controlledOpen(args);
  return (
    <Stack gap={3}>
      <Inline gap={2}>
        <Button onClick={() => setOpen(true)}>{args.trigger}</Button>
      </Inline>
      <Sheet
        open={open()}
        onOpenChange={setOpen}
        side={args.side}
        modal={args.modal}
        title={args.title}
        description={args.description}
        closeLabel={args.closeLabel}
        hideClose={args.hideClose}
        actions={
          <>
            <Button variant="text" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button onClick={() => setOpen(false)}>Применить</Button>
          </>
        }
      >
        <Stack gap={3}>
          <Text>{args.children}</Text>
          <Text variant="body-small" tone="muted">
            Панель выезжает с выбранной стороны; ручка — affordance без drag-жеста
            в v1.
          </Text>
        </Stack>
      </Sheet>
    </Stack>
  );
}

export const SheetPlayground: Story = {
  name: "Sheet",
  argTypes: {
    ...openControl,
    side: {
      control: "inline-radio",
      options: ["top", "right", "bottom", "left"],
      description: "Сторона выезда панели",
      table: { defaultValue: { summary: "right" } },
    },
    modal: {
      control: "boolean",
      description: "Блокировать фон (`inert` + focus trap)",
      table: { defaultValue: { summary: "true" } },
    },
    title: { control: "text", description: "Заголовок панели" },
    description: { control: "text", description: "Пояснение" },
    children: { control: "text", description: "Текст тела панели" },
    trigger: { control: "text", description: "Текст кнопки-триггера" },
    closeLabel: {
      control: "text",
      description: "Доступное имя крестика",
      table: { category: "Доступность" },
    },
    hideClose: { control: "boolean", description: "Скрыть крестик" },
    onOpenChange: { action: "open-change", description: "Escape/скрим/крестик" },
  },
  render: silentStory<OverlayArgs>((args) => SheetDemo(args)),
};

export const SheetSides: Story = {
  name: "Sheet: все стороны",
  parameters: { controls: { disable: true } },
  render: silentStory(() => {
    const [open, setOpen] = createSignal(false);
    const [side, setSide] = createSignal<SheetSide>("right");
    const show = (next: SheetSide): void => {
      setSide(next);
      setOpen(true);
    };
    return (
      <Stack gap={3}>
        <Inline gap={2} wrap>
          <Button onClick={() => show("top")}>Сверху</Button>
          <Button onClick={() => show("right")}>Справа</Button>
          <Button onClick={() => show("bottom")}>Снизу</Button>
          <Button onClick={() => show("left")}>Слева</Button>
        </Inline>
        <Text variant="body-small" tone="muted">
          Сторона меняется на лету: одна панель, четыре `data-side`.
        </Text>
        <Sheet
          open={open()}
          onOpenChange={setOpen}
          side={side()}
          title={`Панель: ${side()}`}
          description="Заголовок и описание обновляются при смене стороны."
        >
          <Paragraphs count={3} prefix="Раздел" />
        </Sheet>
      </Stack>
    );
  }),
};

export const SheetNonModal: Story = {
  name: "Sheet: non-modal (без блокировки фона)",
  parameters: { controls: { disable: true } },
  render: silentStory(() => {
    const [open, setOpen] = createSignal(true);
    const [count, setCount] = createSignal(0);
    return (
      <Stack gap={3}>
        <Inline gap={2}>
          <Button onClick={() => setOpen(true)}>Открыть standard-лист</Button>
          <Button variant="outlined" onClick={() => setCount(count() + 1)}>
            Фон активен: {count()}
          </Button>
        </Inline>
        <Text variant="body-small" tone="muted">
          Без `modal` фон не получает `inert`: кнопка выше остаётся доступной,
          Tab не запирается, скрим не рендерится.
        </Text>
        <Sheet
          open={open()}
          onOpenChange={setOpen}
          modal={false}
          side="right"
          title="Инспектор свойств"
          description="Не блокирует работу с холстом."
          actions={<Button onClick={() => setOpen(false)}>Свернуть</Button>}
        >
          <Paragraphs count={4} prefix="Свойство" />
        </Sheet>
      </Stack>
    );
  }),
};

export const SheetLongContent: Story = {
  name: "Sheet: длинное содержимое",
  parameters: { controls: { disable: true } },
  render: silentStory(() => {
    const [open, setOpen] = createSignal(true);
    return (
      <Stack gap={3}>
        <Inline gap={2}>
          <Button onClick={() => setOpen(true)}>Открыть лист</Button>
        </Inline>
        <Sheet
          open={open()}
          onOpenChange={setOpen}
          side="right"
          title="История изменений проекта за последние 12 месяцев"
          description="Длинный заголовок и десятки записей: тело прокручивается, шапка и действия остаются на месте."
          actions={
            <>
              <Button variant="text" onClick={() => setOpen(false)}>
                Закрыть
              </Button>
              <Button onClick={() => setOpen(false)}>Экспорт истории</Button>
            </>
          }
        >
          <Paragraphs count={12} prefix="Запись" />
        </Sheet>
      </Stack>
    );
  }),
};

export const SheetNested: Story = {
  name: "Sheet: вложенные оверлеи",
  parameters: { controls: { disable: true } },
  render: silentStory(() => {
    const [open, setOpen] = createSignal(true);
    const [popoverOpen, setPopoverOpen] = createSignal(false);
    const [menuOpen, setMenuOpen] = createSignal(false);
    return (
      <Stack gap={3}>
        <Inline gap={2}>
          <Button onClick={() => setOpen(true)}>Открыть панель</Button>
        </Inline>
        <Sheet
          open={open()}
          onOpenChange={setOpen}
          side="left"
          title="Слои внутри панели"
          description="Popover и Menu рендерятся inline внутри панели, поэтому фокус и Escape работают послойно."
          actions={<Button onClick={() => setOpen(false)}>Готово</Button>}
        >
          <Stack gap={4}>
            <Popover
              open={popoverOpen()}
              onOpenChange={setPopoverOpen}
              placement="bottom"
              label="Сортировка"
              trigger={<Button variant="outlined">Сортировка</Button>}
            >
              <Stack gap={2}>
                <Text variant="title-small">Порядок</Text>
                <Text variant="body-small" tone="muted">
                  Сначала новые записи. Escape закроет только поповер.
                </Text>
                <Button size="sm" onClick={() => setPopoverOpen(false)}>
                  Применить
                </Button>
              </Stack>
            </Popover>
            <Menu
              open={menuOpen()}
              onOpenChange={setMenuOpen}
              label="Действия с записью"
              trigger={<Button variant="tonal">Действия</Button>}
            >
              <MenuItem>Открыть</MenuItem>
              <MenuItem>Дублировать</MenuItem>
              <MenuItem disabled>В архив</MenuItem>
            </Menu>
          </Stack>
        </Sheet>
      </Stack>
    );
  }),
};

export const SheetMobile: Story = {
  name: "Sheet: мобильная нижняя панель",
  globals: { viewport: "mobile360" },
  parameters: { controls: { disable: true } },
  render: silentStory(() => {
    const [open, setOpen] = createSignal(true);
    return (
      <Stack gap={3}>
        <Inline gap={2}>
          <Button onClick={() => setOpen(true)}>Открыть снизу</Button>
        </Inline>
        <Sheet
          open={open()}
          onOpenChange={setOpen}
          side="bottom"
          title="Фильтры"
          description="На мобильном нижний лист занимает почти весь экран и учитывает safe-area."
          actions={
            <>
              <Button variant="text" onClick={() => setOpen(false)}>
                Сбросить
              </Button>
              <Button fullWidth onClick={() => setOpen(false)}>
                Показать результаты
              </Button>
            </>
          }
        >
          <Paragraphs count={3} prefix="Фильтр" />
        </Sheet>
      </Stack>
    );
  }),
};

export const SheetDark: Story = {
  name: "Sheet: тёмная тема",
  parameters: { controls: { disable: true } },
  render: silentStory(() => {
    const [open, setOpen] = createSignal(true);
    return (
      <DarkFrame>
        <Inline gap={2}>
          <Button onClick={() => setOpen(true)}>Открыть лист</Button>
        </Inline>
        <Sheet
          open={open()}
          onOpenChange={setOpen}
          side="right"
          title="Тёмная панель"
          description="Токены наследуются от обёртки."
        >
          <Paragraphs count={2} prefix="Абзац" />
        </Sheet>
      </DarkFrame>
    );
  }),
};

/* ------------------------------------------------------------------ */
/* Popover                                                             */
/* ------------------------------------------------------------------ */

function PopoverDemo(args: OverlayArgs): Node {
  const [open, setOpen] = controlledOpen(args);
  return (
    <Popover
      open={open()}
      onOpenChange={setOpen}
      placement={args.placement}
      label={args.label}
      disabled={args.disabled}
      trigger={<Button variant="outlined">{args.trigger}</Button>}
    >
      <Stack gap={2}>
        <Text variant="title-small">{args.title}</Text>
        <Text variant="body-small" tone="muted">
          {args.description}
        </Text>
        <Inline gap={2} justify="end">
          <Button size="sm" variant="text" onClick={() => setOpen(false)}>
            Отмена
          </Button>
          <Button size="sm" onClick={() => setOpen(false)}>
            ОК
          </Button>
        </Inline>
      </Stack>
    </Popover>
  );
}

export const PopoverPlayground: Story = {
  name: "Popover",
  argTypes: {
    ...openControl,
    placement: {
      control: "inline-radio",
      options: ["top", "bottom", "start", "end"],
      description: "Предпочтительная сторона (flip у краёв)",
      table: { defaultValue: { summary: "bottom" } },
    },
    label: {
      control: "text",
      description: "Доступное имя панели (`aria-label`)",
    },
    title: { control: "text", description: "Заголовок содержимого" },
    description: { control: "text", description: "Пояснение" },
    trigger: { control: "text", description: "Текст триггера" },
    disabled: { control: "boolean", description: "Триггер не открывает панель" },
    onOpenChange: { action: "open-change", description: "Escape/клик вне" },
  },
  render: silentStory<OverlayArgs>((args) => PopoverDemo(args)),
};

export const PopoverPlacements: Story = {
  name: "Popover: все размещения",
  parameters: { controls: { disable: true } },
  render: silentStory(() => (
    <Stack gap={4}>
      <Text variant="body-small" tone="muted">
        Триггеры открыты по умолчанию: видно, как панель позиционируется
        относительно anchor. У краёв placement переворачивается (flip).
      </Text>
      <div
        style={{
          display: "grid",
          "grid-template-columns": "repeat(auto-fit, minmax(min(100%, 18rem), 1fr))",
          gap: "1rem",
          "align-items": "start",
          "max-inline-size": "100%",
          "min-inline-size": "0",
        }}
      >
        {(["top", "bottom", "start", "end"] as const).map((placement) => (
          <Surface
            key={placement}
            tone="surface-container-low"
            padding={4}
            radius="md"
            style={{ "min-inline-size": "0", "max-inline-size": "100%" }}
          >
            <Stack gap={3}>
              <Text variant="label-large">{placement}</Text>
              <Popover
                open
                placement={placement}
                label={`Поповер ${placement}`}
                trigger={<Button variant="outlined">Открыть</Button>}
              >
                <Text>Панель {placement}</Text>
              </Popover>
            </Stack>
          </Surface>
        ))}
      </div>
    </Stack>
  )),
};

export const PopoverNested: Story = {
  name: "Popover: вложенные слои",
  parameters: { controls: { disable: true } },
  render: silentStory(() => {
    const [outerOpen, setOuterOpen] = createSignal(true);
    const [innerOpen, setInnerOpen] = createSignal(true);
    return (
      <Stack gap={3}>
        <Text variant="body-small" tone="muted">
          Клик внутри вложенного поповера не считается «кликом вне» — внешний
          слой остаётся открыт. Escape закрывает верхний слой.
        </Text>
        <Popover
          open={outerOpen()}
          onOpenChange={setOuterOpen}
          placement="bottom"
          label="Внешний слой"
          trigger={<Button>Открыть внешний</Button>}
        >
          <Stack gap={3}>
            <Text variant="title-small">Внешний поповер</Text>
            <Popover
              open={innerOpen()}
              onOpenChange={setInnerOpen}
              placement="end"
              label="Внутренний слой"
              trigger={<Button size="sm" variant="outlined">Ещё</Button>}
            >
              <Stack gap={2}>
                <Text>Внутренний поповер</Text>
                <Button size="sm" onClick={() => setInnerOpen(false)}>
                  Понятно
                </Button>
              </Stack>
            </Popover>
          </Stack>
        </Popover>
      </Stack>
    );
  }),
};

export const PopoverKeyboard: Story = {
  name: "Popover: клавиатура и фокус",
  parameters: { controls: { disable: true } },
  render: silentStory(() => {
    const [open, setOpen] = createSignal(false);
    return (
      <Stack gap={3}>
        <Inline gap={2}>
          <Button variant="outlined">Соседний элемент</Button>
          <Popover
            open={open()}
            onOpenChange={setOpen}
            placement="bottom"
            label="Клавиатурный поповер"
            trigger={<Button>Триггер поповера</Button>}
          >
            <Stack gap={2}>
              <Text>Фокус перешёл в панель.</Text>
              <TextField label="Поле" />
              <Button size="sm" onClick={() => setOpen(false)}>
                Закрыть
              </Button>
            </Stack>
          </Popover>
        </Inline>
        <Text variant="body-small" tone="muted">
          Открытие кликом/Enter, фокус уходит на первый элемент панели, Escape
          закрывает и возвращает фокус на триггер. Клик вне закрывает без
          возврата фокуса.
        </Text>
      </Stack>
    );
  }),
};

export const PopoverLongContent: Story = {
  name: "Popover: длинное содержимое",
  parameters: { controls: { disable: true } },
  render: silentStory(() => {
    const [open, setOpen] = createSignal(true);
    return (
      <Popover
        open={open()}
        onOpenChange={setOpen}
        placement="bottom"
        label="Параметры уведомлений"
        trigger={<Button variant="outlined">Настроить уведомления</Button>}
      >
        <Stack gap={3} style={{ maxWidth: "22rem" }}>
          <Text variant="title-small">
            Уведомления о комментариях, упоминаниях и изменениях статуса задачи
          </Text>
          <Paragraphs count={4} prefix="Пункт" />
          <Inline gap={2} justify="end">
            <Button size="sm" variant="text" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button size="sm" onClick={() => setOpen(false)}>
              Сохранить
            </Button>
          </Inline>
        </Stack>
      </Popover>
    );
  }),
};

export const PopoverDark: Story = {
  name: "Popover: тёмная тема",
  parameters: { controls: { disable: true } },
  render: silentStory(() => {
    const [open, setOpen] = createSignal(true);
    return (
      <DarkFrame>
        <Popover
          open={open()}
          onOpenChange={setOpen}
          label="Тёмный поповер"
          trigger={<Button variant="outlined">Поповер</Button>}
        >
          <Stack gap={2}>
            <Text variant="title-small">Тёмная панель</Text>
            <Text variant="body-small" tone="muted">
              Панель наследует токены обёртки.
            </Text>
          </Stack>
        </Popover>
      </DarkFrame>
    );
  }),
};

/* ------------------------------------------------------------------ */
/* Menu                                                                */
/* ------------------------------------------------------------------ */

function MenuDemo(args: OverlayArgs): Node {
  const [open, setOpen] = controlledOpen(args);
  return (
    <Menu
      open={open()}
      onOpenChange={setOpen}
      label={args.label}
      disabled={args.disabled}
      trigger={<Button variant="tonal">{args.trigger}</Button>}
    >
      <MenuItem leading={<AddIcon />} onSelect={() => args.onSelect("create")}>
        Создать
      </MenuItem>
      <MenuItem leading={<DownloadIcon />} onSelect={() => args.onSelect("download")}>
        Скачать
      </MenuItem>
      <MenuItem trailing={<Text variant="label-small" tone="muted">⌘D</Text>} onSelect={() => args.onSelect("duplicate")}>
        Дублировать
      </MenuItem>
      <MenuSeparator />
      <MenuItem disabled>Удалить</MenuItem>
    </Menu>
  );
}

export const MenuPlayground: Story = {
  name: "Menu",
  argTypes: {
    ...openControl,
    label: { control: "text", description: "Доступное имя меню" },
    trigger: { control: "text", description: "Текст триггера" },
    disabled: { control: "boolean", description: "Триггер не открывает меню" },
    onOpenChange: { action: "open-change", description: "Escape/клик вне/выбор" },
    onSelect: { action: "select", description: "Выбор пункта" },
  },
  render: silentStory<OverlayArgs>((args) => MenuDemo(args)),
};

export const MenuKeyboard: Story = {
  name: "Menu: клавиатура",
  parameters: { controls: { disable: true } },
  render: silentStory(() => (
    <Stack gap={3}>
      <Menu label="Действия с документом" trigger={<Button variant="outlined">Действия</Button>}>
        <MenuItem>Открыть</MenuItem>
        <MenuItem leading={<AddIcon />}>Добавить в избранное</MenuItem>
        <MenuItem trailing={<Text variant="label-small">⌘C</Text>}>Копировать ссылку</MenuItem>
        <MenuItem disabled>В архив</MenuItem>
        <MenuSeparator />
        <MenuItem>Экспорт</MenuItem>
      </Menu>
      <Text variant="body-small" tone="muted">
        Enter/Space/ArrowDown открывают меню; стрелки и Home/End двигают roving
        tabindex; Enter выбирает; Escape и Tab закрывают и возвращают фокус.
      </Text>
    </Stack>
  )),
};

export const MenuLong: Story = {
  name: "Menu: длинный список",
  parameters: { controls: { disable: true } },
  render: silentStory<OverlayArgs>((args) => (
    <Menu open label="Длинное меню" onOpenChange={() => undefined}>
      {Array.from({ length: 24 }, (_value, index) => (
        <MenuItem
          key={`menu-item-${index}`}
          onSelect={() => args.onSelect(`item-${index + 1}`)}
        >
          Пункт {index + 1} — действие с длинным названием
        </MenuItem>
      ))}
    </Menu>
  )),
};

export const MenuWithIcons: Story = {
  name: "Menu: иконки и разделители",
  parameters: { controls: { disable: true } },
  render: silentStory(() => (
    <Menu label="Файл" trigger={<Button variant="tonal">Файл</Button>}>
      <MenuItem leading={<AddIcon />}>Создать</MenuItem>
      <MenuItem leading={<DownloadIcon />}>Скачать</MenuItem>
      <MenuItem leading={<SearchIcon />}>Найти</MenuItem>
      <MenuSeparator />
      <MenuItem disabled leading={<WarningIcon />}>
        Удалить безвозвратно
      </MenuItem>
    </Menu>
  )),
};

export const MenuDark: Story = {
  name: "Menu: тёмная тема",
  parameters: { controls: { disable: true } },
  render: silentStory(() => (
    <DarkFrame>
      <Menu open label="Тёмное меню" onOpenChange={() => undefined} trigger={<Button variant="outlined">Меню</Button>}>
        <MenuItem leading={<CheckIcon />}>Выбрано</MenuItem>
        <MenuItem>Обычный пункт</MenuItem>
        <MenuSeparator />
        <MenuItem disabled>Недоступный пункт</MenuItem>
      </Menu>
    </DarkFrame>
  )),
};

/* ------------------------------------------------------------------ */
/* Tooltip                                                             */
/* ------------------------------------------------------------------ */

export const TooltipPlayground: Story = {
  name: "Tooltip",
  argTypes: {
    content: { control: "text", description: "Текст подсказки" },
    placement: {
      control: "inline-radio",
      options: ["top", "bottom", "start", "end"],
      description: "Сторона подсказки",
      table: { defaultValue: { summary: "top" } },
    },
    delay: {
      control: { type: "range", min: 0, max: 1000, step: 50 },
      description: "Задержка показа, мс",
      table: { defaultValue: { summary: "500" } },
    },
    disabled: {
      control: "boolean",
      description: "Не показывать подсказку",
      table: { defaultValue: { summary: "false" } },
    },
  },
  render: silentStory<OverlayArgs>((args) => (
    <Inline gap={3}>
      <Tooltip
        content={args.content}
        placement={args.placement}
        delay={args.delay}
        disabled={args.disabled}
      >
        <Button variant="outlined">Наведи или сфокусируй</Button>
      </Tooltip>
    </Inline>
  )),
};

export const TooltipPlacements: Story = {
  name: "Tooltip: все размещения",
  parameters: { controls: { disable: true } },
  render: silentStory(() => (
    <Stack gap={5}>
      <Text variant="body-small" tone="muted">
        Наведите курсор или перейдите Tab: подсказка появляется без задержки
        (`delay=0`) и скрывается Escape/blur.
      </Text>
      <Inline gap={6} wrap>
        {(["top", "bottom", "start", "end"] as const).map((placement) => (
          <Tooltip key={placement} content={`Подсказка ${placement}`} placement={placement} delay={0}>
            <Button variant="outlined">{placement}</Button>
          </Tooltip>
        ))}
      </Inline>
    </Stack>
  )),
};

export const TooltipLongContent: Story = {
  name: "Tooltip: длинный текст",
  parameters: { controls: { disable: true } },
  render: silentStory(() => (
    <Inline gap={3}>
      <Tooltip
        delay={0}
        placement="bottom"
        content="Сохранение доступно только при заполненных обязательных полях: название, владелец и срок."
      >
        <Button variant="outlined">Почему кнопка неактивна?</Button>
      </Tooltip>
    </Inline>
  )),
};

export const TooltipKeyboard: Story = {
  name: "Tooltip: клавиатура и отключение",
  parameters: { controls: { disable: true } },
  render: silentStory(() => (
    <Stack gap={4}>
      <Inline gap={3} wrap>
        <Tooltip content="Появляется по focus" delay={0}>
          <Button variant="outlined">Фокусируемый триггер</Button>
        </Tooltip>
        <Tooltip content="Отключённая подсказка" delay={0} disabled>
          <Button variant="outlined">Disabled tooltip</Button>
        </Tooltip>
      </Inline>
      <Text variant="body-small" tone="muted">
        На touch подсказка не показывается; Escape скрывает открытую.
      </Text>
    </Stack>
  )),
};

export const TooltipDark: Story = {
  name: "Tooltip: тёмная тема",
  parameters: { controls: { disable: true } },
  render: silentStory(() => (
    <DarkFrame minHeight="10rem">
      <Inline gap={3}>
        <Tooltip content="Тёмная подсказка" delay={0} placement="bottom">
          <Button variant="outlined">Наведи</Button>
        </Tooltip>
      </Inline>
    </DarkFrame>
  )),
};

/* ------------------------------------------------------------------ */
/* Snackbar                                                            */
/* ------------------------------------------------------------------ */

function SnackbarDemo(args: OverlayArgs): Node {
  const [open, setOpen] = controlledOpen(args);
  return (
    <Stack gap={3}>
      <Inline gap={2}>
        <Button onClick={() => setOpen(true)}>Показать снекбар</Button>
      </Inline>
      <Snackbar
        open={open()}
        message={args.message}
        autoHideDuration={args.autoHideDuration}
        closeLabel={args.closeLabel}
        onClose={() => {
          args.onClose();
          setOpen(false);
        }}
        action={
          args.action ? (
            <Button variant="text" size="sm" onClick={() => setOpen(false)}>
              Отменить
            </Button>
          ) : null
        }
      />
    </Stack>
  );
}

export const SnackbarPlayground: Story = {
  name: "Snackbar",
  argTypes: {
    ...openControl,
    message: { control: "text", description: "Текст сообщения" },
    action: {
      control: "boolean",
      description: "Показать действие «Отменить»",
      table: { defaultValue: { summary: "true" } },
    },
    autoHideDuration: {
      control: { type: "range", min: 0, max: 10000, step: 500 },
      description: "Автоскрытие, мс; 0 — не скрывать",
      table: { defaultValue: { summary: "5000" } },
    },
    closeLabel: {
      control: "text",
      description: "Доступное имя кнопки закрытия",
      table: { category: "Доступность" },
    },
    onClose: { action: "close", description: "Кнопка закрытия или таймер" },
  },
  render: silentStory<OverlayArgs>((args) => SnackbarDemo(args)),
};

export const SnackbarWithAction: Story = {
  name: "Snackbar: действие и закрытие",
  parameters: { controls: { disable: true } },
  render: silentStory(() => {
    const [open, setOpen] = createSignal(true);
    return (
      <Stack gap={3}>
        <Inline gap={2}>
          <Button onClick={() => setOpen(true)}>Отправить в архив</Button>
        </Inline>
        <Snackbar
          open={open()}
          message="Задача перемещена в архив"
          autoHideDuration={0}
          action={
            <Button variant="text" size="sm" onClick={() => setOpen(false)}>
              Вернуть
            </Button>
          }
          onClose={() => setOpen(false)}
        />
      </Stack>
    );
  }),
};

export const SnackbarLongMessage: Story = {
  name: "Snackbar: длинное сообщение",
  parameters: { controls: { disable: true } },
  render: silentStory(() => {
    const [open, setOpen] = createSignal(true);
    return (
      <Snackbar
        open={open()}
        message="Не удалось синхронизировать 3 из 128 документов: проверьте подключение к сети и повторите попытку — изменения сохранены локально."
        autoHideDuration={0}
        action={
          <Button variant="text" size="sm" onClick={() => setOpen(false)}>
            Повторить
          </Button>
        }
        onClose={() => setOpen(false)}
      />
    );
  }),
};

export const SnackbarMobile: Story = {
  name: "Snackbar: mobile full-width",
  globals: { viewport: "mobile360" },
  parameters: { controls: { disable: true } },
  render: silentStory(() => {
    const [open, setOpen] = createSignal(true);
    return (
      <Stack gap={3}>
        <Text variant="body-small" tone="muted">
          На ширине 360px снекбар растягивается почти на всю ширину и учитывает
          safe-area снизу.
        </Text>
        <Snackbar
          open={open()}
          message="Черновик сохранён"
          autoHideDuration={0}
          action={
            <Button variant="text" size="sm" onClick={() => setOpen(false)}>
              Отменить
            </Button>
          }
          onClose={() => setOpen(false)}
        />
      </Stack>
    );
  }),
};

export const SnackbarDesktop: Story = {
  name: "Snackbar: desktop compact",
  globals: { viewport: "desktop1200" },
  parameters: { controls: { disable: true } },
  render: silentStory(() => {
    const [open, setOpen] = createSignal(true);
    return (
      <Stack gap={3}>
        <Text variant="body-small" tone="muted">
          От 600px снекбар становится компактной капсулой по центру.
        </Text>
        <Snackbar
          open={open()}
          message="Черновик сохранён"
          autoHideDuration={0}
          action={
            <Button variant="text" size="sm" onClick={() => setOpen(false)}>
              Отменить
            </Button>
          }
          onClose={() => setOpen(false)}
        />
      </Stack>
    );
  }),
};

export const SnackbarDark: Story = {
  name: "Snackbar: тёмная тема",
  parameters: { controls: { disable: true } },
  render: silentStory(() => {
    const [open, setOpen] = createSignal(true);
    return (
      <DarkFrame>
        <Snackbar
          open={open()}
          message="Тёмная тема"
          autoHideDuration={0}
          onClose={() => setOpen(false)}
        />
      </DarkFrame>
    );
  }),
};

/* ------------------------------------------------------------------ */
/* Combined showcase                                                   */
/* ------------------------------------------------------------------ */

export const OverlayStack: Story = {
  name: "Все оверлеи: сценарий публикации",
  parameters: { controls: { disable: true } },
  render: silentStory(() => {
    const [dialogOpen, setDialogOpen] = createSignal(true);
    const [alertOpen, setAlertOpen] = createSignal(false);
    const [snackbarOpen, setSnackbarOpen] = createSignal(false);
    return (
      <Stack gap={3}>
        <Inline gap={2} wrap>
          <Button onClick={() => setDialogOpen(true)}>Открыть диалог</Button>
          <Button variant="outlined" onClick={() => setAlertOpen(true)}>
            Открыть подтверждение
          </Button>
        </Inline>
        <Dialog
          open={dialogOpen()}
          onOpenChange={setDialogOpen}
          title="Публикация изменений"
          description="Диалог → подтверждение → снекбар: типичная последовательность."
          actions={
            <>
              <Button
                variant="text"
                onClick={() => {
                  setDialogOpen(false);
                  setAlertOpen(true);
                }}
              >
                Отменить публикацию
              </Button>
              <Button
                onClick={() => {
                  setDialogOpen(false);
                  setSnackbarOpen(true);
                }}
              >
                Опубликовать
              </Button>
            </>
          }
        >
          <Stack gap={2}>
            <Menu label="Что публикуем" trigger={<Button variant="outlined">Что публикуем</Button>}>
              <MenuItem>Все изменения</MenuItem>
              <MenuItem>Только черновики</MenuItem>
            </Menu>
            <Tooltip content="Публикация доступна роли «Редактор»" delay={0}>
              <Text variant="body-small" tone="muted">
                Доступные действия зависят от роли.
              </Text>
            </Tooltip>
          </Stack>
        </Dialog>
        <AlertDialog
          open={alertOpen()}
          onOpenChange={setAlertOpen}
          destructive
          title="Отменить публикацию?"
          description="Несохранённые правки останутся в черновике."
          confirmLabel="Отменить публикацию"
          onConfirm={() => {
            setAlertOpen(false);
            setSnackbarOpen(true);
          }}
          onCancel={() => setAlertOpen(false)}
        />
        <Snackbar
          open={snackbarOpen()}
          message="Публикация отменена"
          autoHideDuration={5000}
          onClose={() => setSnackbarOpen(false)}
          action={
            <Button variant="text" size="sm" onClick={() => setSnackbarOpen(false)}>
              Вернуть
            </Button>
          }
        />
      </Stack>
    );
  }),
};
