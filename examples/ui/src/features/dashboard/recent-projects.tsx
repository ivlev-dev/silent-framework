import { Card, EmptyState, Heading, Table, type TableColumn } from "@ivlev-dev/silent-ui";
import type { Project } from "../../api/types.js";
import { formatBudget, formatDate, statusLabel, statusVariant } from "../../lib/format.js";
import { Tag } from "@ivlev-dev/silent-ui";
import { TagLine } from "../../ui/tags.js";

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

export interface RecentProjectsProps {
  readonly rows: () => readonly Project[];
  readonly compact: () => boolean;
  readonly onOpen: () => void;
}

export function RecentProjects(props: RecentProjectsProps): Node {
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
          <button type="button" class="app-link-button" onClick={props.onOpen}>
            Открыть таблицу
          </button>
        </div>
      }
      class="app-dashboard-panel app-flush-card"
    >
      <Table
        class="app-recent-table"
        columns={RECENT_COLUMNS}
        rows={props.rows()}
        rowKey={(project) => project.id}
        rowHeight={props.compact() ? 44 : 48}
        dense={props.compact()}
        stickyHeader
        maxHeight={360}
        label="Последние созданные проекты"
        empty={<EmptyState compact title="Пока нет проектов" />}
      />
    </Card>
  );
}

export default RecentProjects;
