import { Show, createMemo, createSignal } from "@ivlev-dev/silent-core";
import type { Resource } from "@ivlev-dev/silent-core";
import {
  Button,
  Card,
  ColorPicker,
  DatePicker,
  DateRangePicker,
  FieldGroup,
  FileUpload,
  FormActions,
  Heading,
  Inline,
  Progress,
  SegmentedButton,
  Spinner,
  Stack,
  Switch,
  Tag,
  Text,
  Textarea,
  TextField,
  TreeSelect,
  UploadIcon,
  createXhrUpload,
  type FileUploadItem,
  type ThemeMode,
  type TreeSelectNode,
  type TreeSelectValue,
} from "@ivlev-dev/silent-ui";
import { UPLOAD_URL, errorMessage } from "../api/client.js";
import type { ProjectMeta } from "../api/types.js";
import {
  parseIsoDate,
  toIsoDate,
} from "../lib/format.js";
import { SettingsForm } from "../settings-form.js";
import { showToast } from "../ui/toast.js";
import { PageHeader, ErrorState } from "../ui/states.js";

export type AppDensity = "standard" | "compact";

export interface SettingsPageProps {
  readonly meta: Resource<ProjectMeta>;
  readonly theme: () => ThemeMode;
  readonly onThemeChange: (theme: ThemeMode) => void;
  readonly density: () => AppDensity;
  readonly onDensityChange: (density: AppDensity) => void;
}

function tagTree(meta: ProjectMeta | undefined): readonly TreeSelectNode[] {
  const tags = meta?.tags ?? [];
  return [
    {
      value: "workspace",
      label: "Рабочее пространство",
      children: [
        {
          value: "tags",
          label: "Теги проектов",
          children: tags.map((tag) => ({
            value: tag,
            label: `#${tag}`,
            keywords: [tag],
          })),
        },
      ],
    },
  ];
}

function treeValues(value: TreeSelectValue): readonly string[] {
  const values = Array.isArray(value) ? value : [value];
  return values
    .map((entry) => String(entry))
    .filter((entry) => entry !== "workspace" && entry !== "tags");
}

const uploadHandler = createXhrUpload(UPLOAD_URL);

export function SettingsPage(props: SettingsPageProps): Node {
  const form = new SettingsForm();
  const [files, setFiles] = createSignal<readonly FileUploadItem[]>([]);
  const completion = createMemo(() => form.completion());

  const save = form.onSubmit(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 650);
    });
    showToast("Настройки профиля сохранены", "success");
  });

  const reset = (): void => {
    form.reset();
    form.clearFieldErrors();
    setFiles([]);
    showToast("Изменения отменены");
  };

  return (
    <Stack gap={6} class="app-page">
      <PageHeader
        title="Настройки"
        description="Витрина контролов Silent UI и форма профиля на @ivlev-dev/silent-form."
      />

      <Show when={props.meta.error() !== undefined}>
        <ErrorState
          title="Теги недоступны"
          message={errorMessage(props.meta.error())}
          onRetry={() => {
            props.meta.refetch().catch(() => undefined);
          }}
        />
      </Show>

      <div class="app-settings-layout">
        <aside class="app-settings-aside">
          <Card variant="outlined" padding={4} class="app-completion">
            <div class="app-completion__line">
              <Text variant="label-medium">Заполнение профиля</Text>
              <Tag variant="primary" size="sm">
                {String(completion().percent)}%
              </Tag>
            </div>
            <Progress
              label={`Заполнено ${String(completion().percent)}%`}
              value={completion().percent}
              size="md"
            />
            <Text variant="body-small" tone="muted">
              Обязательные {String(completion().requiredFilled)} из{" "}
              {String(completion().requiredTotal)} · поля{" "}
              {String(completion().filled)} из {String(completion().total)}
            </Text>
          </Card>
        </aside>

        <form class="app-settings-form" novalidate onSubmit={save}>
          <Card
            variant="outlined"
            padding={5}
            header={<Heading level={3}>Личные данные</Heading>}
          >
            <FieldGroup columns={3} class="app-settings-grid">
              <TextField field={form.getFieldProps("fullName")} />
              <TextField type="email" field={form.getFieldProps("email")} />
              <TextField field={form.getFieldProps("role")} />
              <TextField field={form.getFieldProps("team")} />
              <TextField field={form.getFieldProps("location")} />
              <TextField field={form.getFieldProps("timezone")} />
            </FieldGroup>
          </Card>

          <Card
            variant="outlined"
            padding={5}
            header={<Heading level={3}>О себе</Heading>}
          >
            <FieldGroup columns={2} class="app-settings-grid">
              <TextField field={form.getFieldProps("website")} />
              <Textarea
                field={form.getFieldProps("bio")}
                rows={4}
                counter
                maxLength={280}
              />
            </FieldGroup>
          </Card>

          <Card
            variant="outlined"
            padding={5}
            header={<Heading level={3}>Оформление</Heading>}
          >
            <FieldGroup columns={2} class="app-settings-grid">
              <ColorPicker
                label="Акцентный цвет"
                value={form.accent}
                onValueChange={(value) => {
                  form.getFieldProps("accent").setValue(value);
                }}
                clearable={false}
              />
              <DatePicker
                label="День рождения"
                value={parseIsoDate(form.birthDate)}
                onValueChange={(date) => {
                  form.getFieldProps("birthDate").setValue(toIsoDate(date));
                }}
                clearable
              />
              <DateRangePicker
                label="Период планирования"
                value={{
                  start: parseIsoDate(form.planFrom),
                  end: parseIsoDate(form.planTo),
                }}
                onValueChange={(range) => {
                  form.getFieldProps("planFrom").setValue(toIsoDate(range.start));
                  form.getFieldProps("planTo").setValue(toIsoDate(range.end));
                }}
                error={
                  form.getFieldProps("planTo").error ??
                  form.getFieldProps("planFrom").error
                }
              />
              <TreeSelect
                nodes={tagTree(props.meta.data())}
                value={form.tags}
                multiple
                checkable
                searchable
                clearable
                label="Рабочие теги"
                hint="Категории и теги из справочника"
                placeholder="Выберите теги"
                loading={props.meta.pending()}
                onValueChange={(value) => {
                  form.getFieldProps("tags").setValue(treeValues(value));
                }}
              />
            </FieldGroup>
          </Card>

          <Card
            variant="outlined"
            padding={5}
            header={<Heading level={3}>Предпочтения</Heading>}
          >
            <FieldGroup columns={2} class="app-settings-grid">
              <Switch
                field={form.getFieldProps("notifications")}
                label="Уведомления"
                description="Сообщения о ревью, упоминания и изменения статусов"
              />
              <Switch
                field={form.getFieldProps("publicProfile")}
                label="Публичный профиль"
                description="Показывать карточку участника другим командам"
              />
            </FieldGroup>
          </Card>

          <Card
            variant="outlined"
            padding={5}
            header={<Heading level={3}>Интерфейс</Heading>}
          >
            <FieldGroup columns={2} class="app-settings-grid">
              <Stack gap={2}>
                <Text variant="label-medium">Тема</Text>
                <SegmentedButton
                  value={props.theme()}
                  label="Тема интерфейса"
                  options={[
                    { key: "light", label: "Светлая" },
                    { key: "dark", label: "Тёмная" },
                    { key: "auto", label: "Системная" },
                  ]}
                  onValueChange={(value) => {
                    props.onThemeChange(value as ThemeMode);
                  }}
                />
              </Stack>
              <Stack gap={2}>
                <Text variant="label-medium">Плотность</Text>
                <SegmentedButton
                  value={props.density()}
                  label="Плотность интерфейса"
                  options={[
                    { key: "standard", label: "Стандартная" },
                    { key: "compact", label: "Компактная" },
                  ]}
                  onValueChange={(value) => {
                    props.onDensityChange(value === "compact" ? "compact" : "standard");
                  }}
                />
              </Stack>
            </FieldGroup>
          </Card>

          <Card
            variant="outlined"
            padding={5}
            header={
              <Inline gap={2} align="center">
                <UploadIcon />
                <Heading level={3}>Файлы</Heading>
              </Inline>
            }
          >
            <Stack gap={3}>
              <FileUpload
                label="Аватар и документы"
                hint="PNG, JPG или PDF до 5 МБ — загрузка идёт в POST /api/uploads"
                accept="image/*,application/pdf"
                maxSize={5 * 1024 * 1024}
                multiple
                maxFiles={5}
                variant="zone"
                files={files()}
                upload={uploadHandler}
                onFilesChange={setFiles}
                onReject={(rejections) => {
                  const first = rejections[0];
                  if (first !== undefined) showToast(first.message, "error");
                }}
                onUploadError={(error) => {
                  showToast(errorMessage(error, "Не удалось загрузить файл"), "error");
                }}
              />
              <Text variant="body-small" tone="muted">
                Загружено файлов: {String(files().filter((file) => file.status === "success").length)}
              </Text>
            </Stack>
          </Card>

          <Card variant="outlined" padding={4} class="app-settings-actions">
            <FormActions
              align="between"
              actions={
                <>
                  <Button variant="text" onClick={reset} type="button">
                    Сбросить
                  </Button>
                  <Button type="submit" loading={form.isSubmitting}>
                    Сохранить настройки
                  </Button>
                </>
              }
            />
          </Card>

          <Show when={form.isSubmitting}>
            <div class="app-form-overlay" role="status" aria-live="polite">
              <Spinner size="lg" label="Сохранение" />
              <Text>Сохраняем настройки…</Text>
            </div>
          </Show>
        </form>
      </div>
    </Stack>
  );
}
