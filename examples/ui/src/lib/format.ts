import type { TagVariant } from "@ivlev-dev/silent-ui";
import type { ProjectStatus } from "../api/types.js";

export const PROJECT_STATUSES: readonly ProjectStatus[] = [
  "active",
  "review",
  "done",
  "paused",
];

const STATUS_LABELS: Readonly<Record<ProjectStatus, string>> = {
  active: "В работе",
  review: "Ревью",
  done: "Готово",
  paused: "Пауза",
};

const STATUS_VARIANTS: Readonly<Record<ProjectStatus, TagVariant>> = {
  active: "success",
  review: "warning",
  done: "primary",
  paused: "neutral",
};

export function isProjectStatus(value: unknown): value is ProjectStatus {
  return (
    typeof value === "string" &&
    (PROJECT_STATUSES as readonly string[]).includes(value)
  );
}

export function statusLabel(status: ProjectStatus): string {
  return STATUS_LABELS[status] ?? status;
}

export function statusVariant(status: ProjectStatus): TagVariant {
  return STATUS_VARIANTS[status] ?? "neutral";
}

const BUDGET_FORMAT = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

export function formatBudget(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return BUDGET_FORMAT.format(value);
}

const DATE_FORMAT = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function normalizeIso(value: string): string {
  return value.replace(/\.(\d{3})\d+/, ".$1");
}

export function formatDate(value: string): string {
  const date = new Date(normalizeIso(value));
  if (Number.isNaN(date.getTime())) return value;
  return DATE_FORMAT.format(date);
}

const DATE_TIME_FORMAT = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDateTime(value: string): string {
  const date = new Date(normalizeIso(value));
  if (Number.isNaN(date.getTime())) return value;
  return DATE_TIME_FORMAT.format(date);
}

export function initialsOf(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/u)
    .filter((part) => part !== "");
  const first = parts[0]?.[0] ?? "?";
  const second = parts.length > 1 ? (parts[1]?.[0] ?? "") : "";
  return `${first}${second}`.toUpperCase();
}

export function pluralRu(
  count: number,
  one: string,
  few: string,
  many: string,
): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function formatPercent(part: number, total: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.round((part / total) * 100);
}

export function toIsoDate(date: Date | null): string {
  if (date === null) return "";
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

export function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 1))}…`;
}
