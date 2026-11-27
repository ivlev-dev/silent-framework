import { For, Show } from "@ivlev-dev/silent-core";
import type { Resource } from "@ivlev-dev/silent-core";
import {
  Avatar,
  Card,
  EmptyState,
  Heading,
  Inline,
  Skeleton,
  Stack,
  Tag,
  Text,
} from "@ivlev-dev/silent-ui";
import type { ProjectMeta } from "../api/types.js";
import { errorMessage } from "../api/client.js";
import { initialsOf } from "../lib/format.js";
import { ErrorState, PageHeader } from "../ui/states.js";
import { TeamIcon } from "../ui/icons.js";

const ROLES = [
  "Дизайн-система",
  "Фронтенд",
  "Платформа",
  "Исследования",
  "Инфраструктура",
  "Мобильный",
  "Безопасность",
  "Данные",
] as const;

const AVAILABILITY = [
  { label: "В сети", variant: "success" as const, status: "online" as const },
  { label: "В сети", variant: "success" as const, status: "online" as const },
  { label: "Отошёл", variant: "warning" as const, status: "away" as const },
  { label: "Не в сети", variant: "neutral" as const, status: "offline" as const },
] as const;

export interface TeamPageProps {
  readonly meta: Resource<ProjectMeta>;
}

export function TeamPage(props: TeamPageProps): Node {
  const owners = (): readonly string[] => props.meta.data()?.owners ?? [];
  const tags = (): readonly string[] => props.meta.data()?.tags ?? [];
  const loading = (): boolean =>
    props.meta.pending() && props.meta.data() === undefined;

  return (
    <Stack gap={5} class="app-page">
      <PageHeader
        title="Команда"
        description="Владельцы проектов и рабочие теги из GET /api/meta."
      />

      <Show when={props.meta.error() !== undefined}>
        <ErrorState
          message={errorMessage(props.meta.error())}
          onRetry={() => {
            props.meta.refetch().catch(() => undefined);
          }}
        />
      </Show>

      <Show when={props.meta.error() === undefined}>
        <div class="app-metrics app-metrics--team">
          <Card variant="outlined" padding={4}>
            <Inline gap={3} align="center">
              <span class="app-stat__icon" data-tone="primary" aria-hidden="true">
                <TeamIcon />
              </span>
              <Stack gap={1}>
                <Text variant="label-medium" tone="muted">
                  Участников
                </Text>
                <Heading level={3}>
                  {loading() ? <Skeleton variant="text" width={48} /> : String(owners().length)}
                </Heading>
              </Stack>
            </Inline>
          </Card>
          <Card variant="outlined" padding={4}>
            <Stack gap={2}>
              <Text variant="label-medium" tone="muted">
                Сквозные теги
              </Text>
              <Inline gap={1} wrap>
                <Show
                  when={!loading()}
                  fallback={<Skeleton variant="text" width="72%" />}
                >
                  <For each={tags()}>
                    {(tag) => (
                      <Tag size="sm" variant="info">
                        #{tag}
                      </Tag>
                    )}
                  </For>
                </Show>
              </Inline>
            </Stack>
          </Card>
        </div>

        <Show
          when={!loading()}
          fallback={
            <div class="app-members" aria-hidden="true">
              <For each={[0, 1, 2, 3, 4, 5, 6, 7]}>
                {() => (
                  <Card variant="outlined" padding={4}>
                    <Stack gap={3}>
                      <Skeleton variant="circle" width={48} height={48} />
                      <Skeleton variant="text" width="68%" />
                      <Skeleton variant="text" width="46%" />
                    </Stack>
                  </Card>
                )}
              </For>
            </div>
          }
        >
          <Show
            when={owners().length > 0}
            fallback={
              <Card variant="outlined" padding={5}>
                <EmptyState
                  icon={<TeamIcon />}
                  title="Команда пока пуста"
                  description="Владельцы появятся после создания проектов."
                />
              </Card>
            }
          >
            <div class="app-members">
              <For each={owners()}>
                {(owner, index) => {
                  const availability = AVAILABILITY[index() % AVAILABILITY.length] ?? AVAILABILITY[0];
                  const role = ROLES[index() % ROLES.length] ?? ROLES[0];
                  return (
                    <Card variant="outlined" padding={4} class="app-member-card">
                      <Stack gap={3}>
                        <Inline justify="between" align="start" gap={2}>
                          <Avatar
                            initials={initialsOf(owner)}
                            alt={owner}
                            size="lg"
                            status={availability.status}
                            statusLabel={availability.label}
                          />
                          <Tag variant={availability.variant} size="sm">
                            {availability.label}
                          </Tag>
                        </Inline>
                        <Stack gap={1}>
                          <Text variant="title-small">{owner}</Text>
                          <Text variant="body-small" tone="muted">
                            {role}
                          </Text>
                        </Stack>
                        <Inline gap={1} wrap>
                          <Tag variant="secondary" size="sm">
                            Владелец проектов
                          </Tag>
                          <Tag variant="neutral" size="sm">
                            ID {String(index() + 1)}
                          </Tag>
                        </Inline>
                      </Stack>
                    </Card>
                  );
                }}
              </For>
            </div>
          </Show>
        </Show>
      </Show>
    </Stack>
  );
}
