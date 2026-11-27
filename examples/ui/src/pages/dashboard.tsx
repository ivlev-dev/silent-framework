import { For, Show, createResource } from "@ivlev-dev/silent-core";
import type { Resource } from "@ivlev-dev/silent-core";
import {
  Button,
  Card,
  EmptyState,
  Heading,
  Inline,
  Progress,
  Skeleton,
  Stack,
  Table,
  Tag,
  Text,
  type TableColumn,
} from "@ivlev-dev/silent-ui";
import { errorMessage, listProjects } from "../api/client.js";
import type {
  Project,
  ProjectMeta,
  ProjectPage,
  ProjectStatus,
} from "../api/types.js";
import {
  PROJECT_STATUSES,
  formatBudget,
  formatDate,
  formatPercent,
  statusLabel,
  statusVariant,
} from "../lib/format.js";
import { SkeletonCards, ErrorState, PageHeader } from "../ui/states.js";
import { StatCard } from "../ui/stat-card.js";
import {
  ChartIcon,
  FolderIcon,
  SparkIcon,
  TeamIcon,
  WalletIcon,
} from "../ui/icons.js";

interface DashboardStats {
  readonly total: number;
  readonly counts: Readonly<Record<ProjectStatus, number>>;
  readonly recent: readonly Project[];
}

const RECENT_COLUMNS: readonly TableColumn<Project>[] = [
  { key: "name", header: "Проект", truncate: true, lines: 1 },
  { key: "owner", header: "Владелец", truncate: true },
  {
    key: "status",
    header: "Статус",
    renderCell: (project) => (
      <Tag variant={statusVariant(project.status)} size="sm">
        {statusLabel(project.status)}
      </Tag>
    ),
  },
  {
    key: "budget",
    header: "Бюджет",
    align: "end",
    renderCell: (project) => formatBudget(project.budget),
  },
  {
    key: "createdAt",
    header: "Создан",
    align: "end",
    renderCell: (project) => formatDate(project.createdAt),
  },
];

function basePage(status?: ProjectStatus): Promise<ProjectPage> {
  return listProjects({
    page: 1,
    pageSize: 10,
    sort: "createdAt",
    order: "desc",
    ...(status !== undefined ? { status } : {}),
  });
}

async function loadStats(): Promise<DashboardStats> {
  const [all, active, review, done, paused, recent] = await Promise.all([
    basePage(),
    basePage("active"),
    basePage("review"),
    basePage("done"),
    basePage("paused"),
    listProjects({ page: 1, pageSize: 10, sort: "createdAt", order: "desc" }),
  ]);
  return {
    total: all.total,
    counts: {
      active: active.total,
      review: review.total,
      done: done.total,
      paused: paused.total,
    },
    recent: recent.items.slice(0, 5),
  };
}

export interface DashboardPageProps {
  readonly meta: Resource<ProjectMeta>;
  readonly onOpenProjects: () => void;
}

export function DashboardPage(props: DashboardPageProps): Node {
  const stats = createResource(loadStats, { cache: false });

  const total = (): number => stats.data()?.total ?? 0;
  const counts = (): Readonly<Record<ProjectStatus, number>> =>
    stats.data()?.counts ?? { active: 0, review: 0, done: 0, paused: 0 };
  const loading = (): boolean =>
    stats.pending() && stats.data() === undefined;
  const failed = (): boolean => stats.error() !== undefined;

  const retry = (): void => {
    void stats.refetch().catch(() => undefined);
    props.meta.refetch().catch(() => undefined);
  };

  const metaReady = (): ProjectMeta | undefined => props.meta.data();

  return (
    <Stack gap={5} class="app-page">
      <PageHeader
        title="Dashboard"
        description="Сводка портфеля проектов: статусы, владельцы и теги из реального API."
        actions={
          <Button variant="tonal" onClick={props.onOpenProjects}>
            Все проекты
          </Button>
        }
      />

      <Show when={failed()}>
        <ErrorState
          message={errorMessage(
            stats.error(),
            "Сервер недоступен. Проверьте, запущен ли backend на порту 6108.",
          )}
          onRetry={retry}
        />
      </Show>

      <Show when={!failed()}>
        <Show
          when={!loading()}
          fallback={
            <Stack gap={4}>
              <SkeletonCards count={6} />
              <Card variant="outlined" padding={4}>
                <Stack gap={3}>
                  <Skeleton variant="text" width="32%" />
                  <Skeleton variant="rect" width="100%" height={160} />
                </Stack>
              </Card>
            </Stack>
          }
        >
          <div class="app-metrics">
            <StatCard
              title="Всего проектов"
              value={String(total())}
              hint={`${String(total())} в портфеле · ${String(counts().review)} ждут ревью`}
              icon={<FolderIcon />}
              tone="primary"
            />
            <StatCard
              title="В работе"
              value={String(counts().active)}
              hint={`${String(formatPercent(counts().active, total()))}% портфеля`}
              icon={<ChartIcon />}
              tone="success"
            />
            <StatCard
              title="На ревью"
              value={String(counts().review)}
              hint={`${String(formatPercent(counts().review, total()))}% ждут решения`}
              icon={<SparkIcon />}
              tone="warning"
            />
            <StatCard
              title="Завершено"
              value={String(counts().done)}
              hint={`${String(formatPercent(counts().done, total()))}% портфеля`}
              icon={<WalletIcon />}
              tone="success"
            />
            <StatCard
              title="Владельцев"
              value={metaReady() === undefined ? "—" : String(metaReady()?.owners.length ?? 0)}
              hint="Активные участники из meta"
              icon={<TeamIcon />}
            />
            <StatCard
              title="Тегов"
              value={metaReady() === undefined ? "—" : String(metaReady()?.tags.length ?? 0)}
              hint="Сквозная рубрикация"
              icon={<ChartIcon />}
            />
          </div>

          <div class="app-dashboard-grid">
            <Card
              variant="outlined"
              padding={4}
              header={<Heading level={3}>Распределение по статусам</Heading>}
              class="app-dashboard-panel"
            >
              <Stack gap={4}>
                <For each={PROJECT_STATUSES}>
                  {(status) => {
                    const count = (): number => counts()[status] ?? 0;
                    return (
                      <Stack gap={1}>
                        <Inline justify="between" align="center" gap={2}>
                          <Inline gap={2} align="center">
                            <Tag variant={statusVariant(status)} size="sm">
                              {statusLabel(status)}
                            </Tag>
                            <Text variant="body-small" tone="muted">
                              {String(count())} из {String(total())}
                            </Text>
                          </Inline>
                          <Text variant="label-medium">
                            {String(formatPercent(count(), total()))}%
                          </Text>
                        </Inline>
                        <Progress
                          label={`Доля статуса «${statusLabel(status)}»`}
                          value={formatPercent(count(), total())}
                          size="sm"
                        />
                      </Stack>
                    );
                  }}
                </For>
              </Stack>
            </Card>

            <Card
              variant="outlined"
              padding={4}
              header={<Heading level={3}>Команда и теги</Heading>}
              class="app-dashboard-panel"
            >
              <Show
                when={metaReady() !== undefined}
                fallback={
                  <Stack gap={2}>
                    <Skeleton variant="text" width="70%" />
                    <Skeleton variant="text" width="52%" />
                    <Skeleton variant="text" width="64%" />
                  </Stack>
                }
              >
                <Stack gap={4}>
                  <Stack gap={2}>
                    <Text variant="label-medium" tone="muted">
                      Владельцы
                    </Text>
                    <Inline gap={1} wrap>
                      <For each={metaReady()?.owners ?? []}>
                        {(owner) => (
                          <Tag size="sm" variant="secondary">
                            {owner}
                          </Tag>
                        )}
                      </For>
                    </Inline>
                  </Stack>
                  <Stack gap={2}>
                    <Text variant="label-medium" tone="muted">
                      Теги
                    </Text>
                    <Inline gap={1} wrap>
                      <For each={metaReady()?.tags ?? []}>
                        {(tag) => (
                          <Tag size="sm" variant="info">
                            #{tag}
                          </Tag>
                        )}
                      </For>
                    </Inline>
                  </Stack>
                </Stack>
              </Show>
            </Card>
          </div>

          <Card
            variant="outlined"
            padding={4}
            header={
              <Inline justify="between" align="center" wrap gap={2}>
                <Heading level={3}>Последние проекты</Heading>
                <Button variant="text" size="sm" onClick={props.onOpenProjects}>
                  Открыть таблицу
                </Button>
              </Inline>
            }
            class="app-dashboard-panel"
          >
            <div class="app-table-scroll">
              <Table
                columns={RECENT_COLUMNS}
                rows={stats.data()?.recent ?? []}
                rowKey={(project) => project.id}
                caption="Последние созданные проекты"
                empty={<EmptyState compact title="Пока нет проектов" />}
              />
            </div>
          </Card>
        </Show>
      </Show>
    </Stack>
  );
}
