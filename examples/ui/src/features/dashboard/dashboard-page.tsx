import { For, Show, createResource } from "@ivlev-dev/silent-core";
import type { RouteViewProps } from "@ivlev-dev/silent-router";
import {
  Button,
  Card,
  Heading,
  Progress,
  Skeleton,
  Stack,
  Tag,
  Text,
} from "@ivlev-dev/silent-ui";
import { errorMessage } from "../../api/client.js";
import type { Project, ProjectMeta, ProjectStatus } from "../../api/types.js";
import {
  PROJECT_STATUSES,
  formatPercent,
  statusLabel,
  statusVariant,
} from "../../lib/format.js";
import { dashboardStats, projectMeta } from "../../app/data.js";
import { density } from "../../app/theme.js";
import { ROUTE_PATHS } from "../../app/router/routes.js";
import { SkeletonCards, ErrorState, PageHeader } from "../../ui/states.js";
import { StatCard } from "./stat-card.js";

import {
  ChartIcon,
  FolderIcon,
  SparkIcon,
  TeamIcon,
  WalletIcon,
} from "../../ui/icons.js";

function RecentProjectsSkeleton(): Node {
  return (
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
        </div>
      }
      class="app-dashboard-panel app-flush-card"
      attrs={{ "aria-busy": "true" }}
    >
      <div class="app-recent-skeleton">
        <For each={[0, 1, 2, 3, 4]}>
          {() => (
            <div class="app-recent-skeleton__row">
              <Skeleton variant="text" width="38%" />
              <Skeleton variant="text" width="22%" />
              <Skeleton variant="text" width="14%" />
            </div>
          )}
        </For>
      </div>
    </Card>
  );
}

export function DashboardPage(props: RouteViewProps): Node {
  const meta = projectMeta();
  const stats = dashboardStats();

  const openProjects = (): void => {
    void props.router.push(ROUTE_PATHS.projects).catch(() => undefined);
  };

  const recentModule = () => import("./recent-projects.js");
  const recentProjects = createResource(recentModule, { cache: false });
  const recentRows = (): readonly Project[] => stats.data()?.recent ?? [];
  const isCompact = (): boolean => density() === "compact";

  const total = (): number => stats.data()?.total ?? 0;
  const counts = (): Readonly<Record<ProjectStatus, number>> =>
    stats.data()?.counts ?? { active: 0, review: 0, done: 0, paused: 0 };
  const loading = (): boolean =>
    stats.pending() && stats.data() === undefined;
  const failed = (): boolean => stats.error() !== undefined;

  const retry = (): void => {
    void stats.refetch().catch(() => undefined);
    meta.refetch().catch(() => undefined);
  };

  const metaReady = (): ProjectMeta | undefined => meta.data();

  return (
    <Stack gap={6} class="app-page">
      <PageHeader
        title="Dashboard"
        description="Сводка портфеля проектов: статусы, владельцы и теги из реального API."
        actions={
          <Button variant="tonal" onClick={openProjects}>
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

          <Show
            when={recentProjects.data()}
            fallback={<RecentProjectsSkeleton />}
          >
            {() => {
              const module = recentProjects.data();
              if (module === undefined) return null;
              return module.RecentProjects({
                rows: recentRows,
                compact: isCompact,
                onOpen: openProjects,
              });
            }}
          </Show>
        </Show>
      </Show>
    </Stack>
  );
}

export default DashboardPage;
