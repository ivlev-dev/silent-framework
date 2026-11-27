import type { Meta, StoryObj } from "@storybook/html-vite";
import { fn, userEvent, within } from "storybook/test";
import { createSignal, onCleanup } from "@ivlev-dev/silent-core";
import { Box, Stack } from "@ivlev-dev/silent-ui";
import {
  FileUpload,
  type FileUploadItem,
  type FileUploadResult,
} from "@ivlev-dev/silent-ui/file-upload";
import { silentStory } from "./silent-story.js";

interface FileUploadArgs {
  readonly label: string;
  readonly hint: string;
  readonly error: string;
  readonly multiple: boolean;
  readonly accept: string;
  readonly maxSize: number;
  readonly maxFiles: number;
  readonly autoUpload: boolean;
  readonly variant: "zone" | "compact";
  readonly size: "sm" | "md" | "lg";
  readonly disabled: boolean;
  readonly readOnly: boolean;
  readonly chooseLabel: string;
  readonly dropLabel: string;
  readonly onFilesChange: (files: readonly FileUploadItem[]) => void;
}

const IMAGE = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="%23dbe4ff"/><circle cx="40" cy="32" r="14" fill="%235b6ee8"/><rect x="18" y="52" width="44" height="8" rx="4" fill="%235b6ee8"/></svg>',
)}`;

const PRESET: readonly FileUploadItem[] = [
  {
    id: "preset-photo",
    name: "catalog-photo.png",
    size: 184_320,
    type: "image/png",
    status: "success",
    progress: 100,
    previewUrl: IMAGE,
    url: IMAGE,
  },
  {
    id: "preset-contract",
    name: "contract.pdf",
    size: 1_248_576,
    type: "application/pdf",
    status: "error",
    progress: 64,
    error: "Сервер отклонил файл",
  },
];

function simulateUpload(
  _file: File,
  context: { onProgress: (percent: number) => void; signal: AbortSignal },
  timers: Set<ReturnType<typeof setInterval>>,
): Promise<FileUploadResult> {
  return new Promise((resolve, reject) => {
    let progress = 0;
    const timer = setInterval(() => {
      progress += 20;
      context.onProgress(progress);
      if (progress >= 100) {
        clearInterval(timer);
        timers.delete(timer);
        resolve({ id: `media-${String(Date.now())}`, url: IMAGE });
      }
    }, 220);
    timers.add(timer);
    context.signal.addEventListener(
      "abort",
      () => {
        clearInterval(timer);
        timers.delete(timer);
        reject(new DOMException("Загрузка отменена", "AbortError"));
      },
      { once: true },
    );
  });
}

const meta = {
  title: "Components/FileUpload",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: [
          "Загрузка файлов с drag&drop, лимитами и прогрессом. `upload`",
          "получает `{ onProgress, signal }`, поэтому отмена и повтор",
          "работают без внешних зависимостей; `createXhrUpload` — готовый",
          "загрузчик на `XMLHttpRequest` с upload-progress. Список показывает",
          "размер, MIME, статус и превью изображений.",
        ].join(" "),
      },
      canvas: { sourceState: "shown" },
    },
  },
  argTypes: {
    label: { control: "text", description: "Подпись поля" },
    hint: { control: "text", description: "Подсказка" },
    error: { control: "text", description: "Ошибка поля" },
    multiple: { control: "boolean", description: "Несколько файлов" },
    accept: { control: "text", description: "MIME/расширения" },
    maxSize: { control: "number", description: "Максимум байт на файл" },
    maxFiles: { control: "number", description: "Максимум файлов" },
    autoUpload: { control: "boolean", description: "Загружать сразу" },
    variant: {
      control: "inline-radio",
      options: ["zone", "compact"],
      description: "Зона или компактная строка",
    },
    size: {
      control: "inline-radio",
      options: ["sm", "md", "lg"],
      description: "Размер",
    },
    disabled: { control: "boolean", description: "Недоступно" },
    readOnly: { control: "boolean", description: "Только чтение" },
    chooseLabel: { control: "text", description: "Кнопка выбора" },
    dropLabel: { control: "text", description: "Подпись drag&drop" },
    onFilesChange: { action: "filesChange", description: "Список изменился" },
  },
  args: {
    label: "Медиа",
    hint: "Изображения и PDF, до 5 МБ",
    error: "",
    multiple: true,
    accept: "image/*,application/pdf",
    maxSize: 5 * 1024 * 1024,
    maxFiles: 8,
    autoUpload: true,
    variant: "zone",
    size: "md",
    disabled: false,
    readOnly: false,
    chooseLabel: "Выбрать файлы",
    dropLabel: "Перетащите файлы сюда или нажмите",
    onFilesChange: fn(),
  },
} satisfies Meta<FileUploadArgs>;

export default meta;

type Story = StoryObj<FileUploadArgs>;

export const Playground: Story = {
  name: "FileUpload / playground",
  render: silentStory<FileUploadArgs>((args) => {
    const [files, setFiles] = createSignal<readonly FileUploadItem[]>([]);
    const timers = new Set<ReturnType<typeof setInterval>>();
    onCleanup(() => {
      for (const timer of timers) clearInterval(timer);
      timers.clear();
    });
    return (
      <Box padding={4} style={{ "max-inline-size": "520px" }}>
        <FileUpload
          label={args.label}
          hint={args.hint === "" ? undefined : args.hint}
          error={args.error === "" ? undefined : args.error}
          multiple={args.multiple}
          accept={args.accept}
          maxSize={args.maxSize}
          maxFiles={args.maxFiles}
          autoUpload={args.autoUpload}
          variant={args.variant}
          size={args.size}
          disabled={args.disabled}
          readOnly={args.readOnly}
          chooseLabel={args.chooseLabel}
          dropLabel={args.dropLabel}
          files={files()}
          upload={(file, context) => simulateUpload(file, context, timers)}
          onFilesChange={(next) => {
            setFiles(next);
            args.onFilesChange(next);
          }}
        />
      </Box>
    );
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const zone = canvas.getByRole("button", { name: /Выбрать файлы/ });
    await userEvent.hover(zone);
    const input = canvasElement.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("не найден input[type=file]");
    }
  },
};

export const Compact: Story = {
  name: "FileUpload / компактный",
  parameters: { controls: { disable: true } },
  render: silentStory(() => (
    <Box padding={4} style={{ "max-inline-size": "520px" }}>
      <FileUpload
        label="Вложения"
        variant="compact"
        size="sm"
        multiple
        accept="application/pdf"
        chooseLabel="Прикрепить PDF"
        dropLabel="или перетащите"
      />
    </Box>
  )),
};

export const WithFiles: Story = {
  name: "FileUpload / статусы и превью",
  parameters: { controls: { disable: true } },
  render: silentStory(() => (
    <Box padding={4} style={{ "max-inline-size": "520px" }}>
      <FileUpload
        label="Галерея"
        hint="Успех, ошибка и очередь"
        multiple
        defaultFiles={[
          ...PRESET,
          {
            id: "preset-queued",
            name: "instructions.docx",
            size: 48_128,
            type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            status: "queued",
            progress: 0,
          },
        ]}
      />
    </Box>
  )),
};

export const States: Story = {
  name: "FileUpload / размеры и состояния",
  parameters: { controls: { disable: true } },
  render: silentStory(() => (
    <Box padding={4} style={{ "max-inline-size": "520px" }}>
      <Stack gap={4}>
        <FileUpload label="sm" size="sm" chooseLabel="Выбрать" />
        <FileUpload label="md" chooseLabel="Выбрать" />
        <FileUpload label="lg" size="lg" chooseLabel="Выбрать" />
        <FileUpload label="Ошибка" error="Файл слишком большой" chooseLabel="Выбрать" />
        <FileUpload label="disabled" disabled chooseLabel="Выбрать" />
        <FileUpload label="readOnly" readOnly defaultFiles={PRESET.slice(0, 1)} />
      </Stack>
    </Box>
  )),
};
