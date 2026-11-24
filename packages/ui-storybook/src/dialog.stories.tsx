import type { Meta, StoryObj } from "@storybook/html-vite";
import { fn } from "storybook/test";
import { createSignal, type Children } from "@ivlev-dev/silent-core";
import { Button, Inline, Stack, Text, TextField } from "@ivlev-dev/silent-ui";
import { Dialog } from "../../ui/src/components/dialog/index.js";
import { silentStory } from "./silent-story.js";

interface DialogArgs {
  readonly open: boolean;
  readonly title: string;
  readonly description: string;
  readonly hideClose: boolean;
  readonly closeLabel: string;
  readonly onOpenChange: (open: boolean) => void;
}

const meta = {
  title: "Components/Dialog",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: [
          "Модальный диалог на нативном `<dialog>`: `showModal()` после",
          "монтирования, Escape и backdrop закрывают, фокус заперт внутри и",
          "возвращается на триггер. `open` — controlled, `defaultOpen` —",
          "uncontrolled. SSR рендерит inline `<dialog open>` без Portal.",
        ].join(" "),
      },
      canvas: { sourceState: "shown" },
    },
  },
  argTypes: {
    open: {
      control: "boolean",
      description: "Controlled-состояние открытия",
      table: { defaultValue: { summary: "false" } },
    },
    title: { control: "text", description: "Заголовок (`aria-labelledby`)" },
    description: {
      control: "text",
      description: "Пояснение (`aria-describedby`)",
    },
    hideClose: {
      control: "boolean",
      description: "Скрыть крестик — закрытие только через actions",
      table: { defaultValue: { summary: "false" } },
    },
    closeLabel: {
      control: "text",
      description: "Доступное имя крестика (переопределяет RU-строку)",
      table: { category: "Доступность" },
    },
    onOpenChange: {
      action: "open-change",
      description: "Запрос смены состояния (Escape/backdrop/крестик)",
    },
  },
  args: {
    open: true,
    title: "Заголовок диалога",
    description: "Короткое пояснение для пользователя.",
    hideClose: false,
    closeLabel: "Закрыть",
    onOpenChange: fn(),
  },
} satisfies Meta<DialogArgs>;

export default meta;

type Story = StoryObj<DialogArgs>;

function body(text: string): Children {
  return (
    <Stack gap={3}>
      <Text>{text}</Text>
      <Text tone="muted" variant="body-small">
        Фокус остаётся внутри оверлея, Escape закрывает, фон получает inert.
      </Text>
    </Stack>
  );
}

function DialogDemo(args: DialogArgs): Node {
  const [open, setOpen] = createSignal(args.open);
  return (
    <>
      <Inline gap={2}>
        <Button onClick={() => setOpen(true)}>Открыть диалог</Button>
      </Inline>
      <Dialog
        open={open()}
        onOpenChange={(next) => {
          setOpen(next);
          args.onOpenChange(next);
        }}
        title={args.title}
        description={args.description}
        hideClose={args.hideClose}
        closeLabel={args.closeLabel}
        actions={
          <>
            <Button variant="text" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button onClick={() => setOpen(false)}>Сохранить</Button>
          </>
        }
      >
        {body("Содержимое диалога: форма, текст или список.")}
      </Dialog>
    </>
  );
}

export const Playground: Story = {
  render: silentStory<DialogArgs>((args) => DialogDemo(args)),
};

export const FormInDialog: Story = {
  parameters: { controls: { disable: true } },
  render: silentStory<DialogArgs>(() => {
    const [open, setOpen] = createSignal(true);
    return (
      <>
        <Inline gap={2}>
          <Button onClick={() => setOpen(true)}>Редактировать профиль</Button>
        </Inline>
        <Dialog
          open={open()}
          onOpenChange={setOpen}
          title="Профиль"
          description="Изменения применяются после сохранения."
          actions={
            <>
              <Button variant="text" onClick={() => setOpen(false)}>
                Отмена
              </Button>
              <Button onClick={() => setOpen(false)}>Сохранить</Button>
            </>
          }
        >
          <Stack gap={3}>
            <TextField label="Имя" placeholder="Ада Ловлейс" />
            <TextField label="Email" type="email" placeholder="ada@example.com" />
          </Stack>
        </Dialog>
      </>
    );
  }),
};

export const WithoutClose: Story = {
  args: { hideClose: true, title: "Только явный выбор" },
  render: silentStory<DialogArgs>((args) => DialogDemo(args)),
};
