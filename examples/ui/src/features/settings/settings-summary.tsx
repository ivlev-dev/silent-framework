import { Show, createMemo } from "@ivlev-dev/silent-core";
import { SuccessIcon } from "@ivlev-dev/silent-ui";
import type { SettingsForm } from "./settings-form.js";

export interface SettingsSummaryProps {
  readonly form: SettingsForm;
}

interface ReadinessField {
  readonly key: string;
  readonly label: string;
  readonly target: string;
  readonly value: () => unknown;
}

const FOCUSABLE =
  "input:not([type='hidden']):not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex='-1'])";

function isFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function focusField(target: string): void {
  if (typeof document === "undefined") return;
  const element = document.querySelector<HTMLElement>(
    `.app-settings-form [data-field="${target}"]`,
  );
  if (element === null) return;
  const rect = element.getBoundingClientRect();
  const section = rect.width === 0 && rect.height === 0
    ? element.closest<HTMLElement>(".sui-card") ?? element
    : element;
  const reduce = typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  section.scrollIntoView({
    behavior: reduce ? "auto" : "smooth",
    block: "start",
    inline: "nearest",
  });
  const control = element.matches(FOCUSABLE)
    ? element
    : element.querySelector<HTMLElement>(FOCUSABLE);
  control?.focus({ preventScroll: true });
}

export function SettingsSummary(props: SettingsSummaryProps): Node {
  const form = props.form;
  const fields: readonly ReadinessField[] = [
    { key: "fullName", label: "Полное имя", target: "fullName", value: () => form.fullName },
    { key: "email", label: "Email", target: "email", value: () => form.email },
    { key: "role", label: "Должность", target: "role", value: () => form.role },
    { key: "team", label: "Команда", target: "team", value: () => form.team },
    { key: "location", label: "Город", target: "location", value: () => form.location },
    { key: "timezone", label: "Часовой пояс", target: "timezone", value: () => form.timezone },
    { key: "website", label: "Сайт", target: "website", value: () => form.website },
    { key: "bio", label: "О себе", target: "bio", value: () => form.bio },
    { key: "accent", label: "Акцентный цвет", target: "accent", value: () => form.accent },
    { key: "birthDate", label: "День рождения", target: "birthDate", value: () => form.birthDate },
    { key: "planFrom", label: "Период планирования", target: "plan", value: () => form.planFrom },
    { key: "planTo", label: "Дата окончания", target: "plan", value: () => form.planTo },
    { key: "tags", label: "Рабочие теги", target: "tags", value: () => form.tags },
    { key: "notifications", label: "Уведомления", target: "notifications", value: () => form.notifications },
    { key: "publicProfile", label: "Публичный профиль", target: "publicProfile", value: () => form.publicProfile },
  ];
  const total = fields.length;
  const filled = createMemo(
    () => fields.filter((field) => isFilled(field.value())).length,
  );
  const percent = createMemo(
    () => (total === 0 ? 100 : Math.round((filled() / total) * 100)),
  );

  return (
    <section class="app-form-aside app-form-aside--readiness">
      <h2 class="app-form-aside__title">Готовность формы</h2>
      <div class="app-form-aside__body">
        <div class="app-form-readiness">
          <div class="app-form-readiness__head">
            <span class="app-form-readiness__percent">{`${String(percent())}%`}</span>
            <span class="app-form-readiness__count">
              {`Заполнено ${String(filled())} из ${String(total)}`}
            </span>
          </div>
          <div class="app-form-readiness__track" aria-hidden="true">
            <span
              class="app-form-readiness__fill"
              style={{ width: `${String(percent())}%` }}
            />
          </div>
          <ul class="app-form-readiness__list">
            {fields.map((field) => (
              <li class="app-form-readiness__entry">
                <button
                  type="button"
                  class="app-form-readiness__item"
                  data-field={field.key}
                  data-done={isFilled(field.value()) ? "" : undefined}
                  onClick={() => {
                    focusField(field.target);
                  }}
                >
                  <Show
                    when={isFilled(field.value())}
                    fallback={<span class="app-form-readiness__circle" aria-hidden="true" />}
                  >
                    <SuccessIcon size="sm" class="app-form-readiness__icon" />
                  </Show>
                  <span>{field.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
