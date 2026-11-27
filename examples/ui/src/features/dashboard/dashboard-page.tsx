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
import { TagLine } from "../ui/tags.js";
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
  {
    key: "name",
    header: "Проект",
    width: 190,
    truncate: true,
    renderCell: (project) => (
      <span class="app-cell-ellipsis" title={project.name}>
        {project.name}
      </span>
    ),
  },
  {
    key: "owner",
    header: "Владелец",
    width: 140,
    truncate: true,
    renderCell: (project) => (
      <span class="app-cell-ellipsis" title={project.owner}>
        {project.owner}
      </span>
    ),
  },
  {
    key: "status",
    header: "Статус",
    width: 110,
    renderCell: (project) => (
      <Tag variant={statusVariant(project.status)} size="sm">
        {statusLabel(project.status)}
      </Tag>
    ),
  },
  {
    key: "tags",
    header: "Теги",
    width: 170,
    renderCell: (project) => <TagLine tags={project.tags} />,
  },
  {
    key: "budget",
    header: "Бюджет",
    width: 100,
    align: "end",
    renderCell: (project) => (
      <span class="app-num">{formatBudget(project.budget)}</span>
    ),
  },
  {
    key: "createdAt",
    header: "Создан",
    width: 120,
    align: "end",
    renderCell: (project) => (
      <span class="app-num">{formatDate(project.createdAt)}</span>
    ),
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
  readonly compact: boolean;
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
    <Stack gap={6} class="app-page">
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
            <Stack gap={6}>
              <SkeletonCards count={6} />
              <Card variant="outlined" padding={5}>
                <Stack gap={3}>
                  <Skeleton variant="text" width="28%" />
                  <Skeleton variant="rect" width="100%" height={160} />
                </Stack>
              </Card>
            </Stack>
          }
        >
          <div class="app-metrics">
            <StatCard
              title="Проекты"
              value={String(total())}
              hint={`${String(counts().active)} в работе · ${String(counts().review)} на ревью`}
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
              hint="Участники из справочника"
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
              padding={5}
              header={
                <div class="app-panel-head">
                  <Heading level={3}>Статусы</Heading>
                  <Text variant="body-small" tone="muted">
                    {String(total())} проектов
                  </Text>
                </div>
              }
              class="app-dashboard-panel"
            >
              <div class="app-status-list">
                <For each={PROJECT_STATUSES}>
                  {(status) => {
                    const count = (): number => counts()[status] ?? 0;
                    const percent = (): number => formatPercent(count(), total());
                    return (
                      <div class="app-status-row">
                        <div class="app-status-row__head">
                          <Tag variant={statusVariant(status)} size="sm">
                            {statusLabel(status)}
                          </Tag>
                          <span class="app-status-row__count">
                            {String(count())} из {String(total())}
                          </span>
                          <span class="app-status-row__percent">
                            {String(percent())}%
                          </span>
                        </div>
                        <Progress
                          class="app-status-bar"
                          label={`Доля статуса «${statusLabel(status)}»`}
                          value={percent()}
                          size="md"
                        />
                      </div>
                    );
                  }}
                </For>
              </div>
            </Card>

            <Card
              variant="outlined"
              padding={5}
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
                  <div class="app-meta-block">
                    <div class="app-meta-block__label">
                      <Text variant="label-medium" tone="muted">
                        Владельцы
                      </Text>
                      <Text variant="body-small" tone="muted">
                        {String(metaReady()?.owners.length ?? 0)}
                      </Text>
                    </div>
                    <div class="app-chip-line">
                      <For each={metaReady()?.owners ?? []}>
                        {(owner) => (
                          <Tag size="sm" variant="secondary">
                            {owner}
                          </Tag>
                        )}
                      </For>
                    </div>
                  </div>
                  <div class="app-meta-block">
                    <div class="app-meta-block__label">
                      <Text variant="label-medium" tone="muted">
                        Теги
                      </Text>
                      <Text variant="body-small" tone="muted">
                        {String(metaReady()?.tags.length ?? 0)}
                      </Text>
                    </div>
                    <div class="app-chip-line">
                      <For each={metaReady()?.tags ?? []}>
                        {(tag) => (
                          <Tag size="sm" variant="info">
                            #{tag}
                          </Tag>
                        )}
                      </For>
                    </div>
                  </div>
                </Stack>
              </Show>
            </Card>
          </div>

          <Card
            variant="outlined"
            padding={0}
            header={
              <div class="app-panel-head">
                <div class="app-panel-head__text">
                  <Heading level={3}>Последние проекты</Heading>
                  <span class="app-panel-head__description">
                    Пять последних записей портфеля
                  </span>
                </div>
                <Button variant="text" size="sm" onClick={props.onOpenProjects}>
                  Открыть таблицу
                </Button>
              </div>
            }
            class="app-dashboard-panel app-flush-card"
          >
            <Table
              class="app-recent-table"
              columns={RECENT_COLUMNS}
              rows={stats.data()?.recent ?? []}
              rowKey={(project) => project.id}
              rowHeight={props.compact ? 44 : 48}
              dense={props.compact}
              stickyHeader
              maxHeight={360}
              label="Последние созданные проекты"
              empty={<EmptyState compact title="Пока нет проектов" />}
            />
          </Card>
        </Show>
      </Show>
    </Stack>
  );
}
