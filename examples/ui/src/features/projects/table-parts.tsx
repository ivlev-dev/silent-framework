import {
  AddIcon,
  Button,
  EmptyState,
  Inline,
  Text,
} from "@ivlev-dev/silent-ui";
import { TrashIcon } from "../../ui/icons.js";

export interface TableToolbarProps {
  readonly total: () => number;
  readonly onCreate: () => void;
}

export function TableToolbar(props: TableToolbarProps): Node {
  return (
    <div class="app-table-toolbar">
      <Inline justify="between" align="center" wrap gap={2}>
        <Inline gap={2} wrap align="center">
          <Text variant="label-large" class="app-table-toolbar__count">
            {String(props.total())} {props.total() === 1 ? "проект" : "проектов"}
          </Text>
        </Inline>
        <Button size="sm" onClick={props.onCreate} leading={<AddIcon />}>
          Новый проект
        </Button>
      </Inline>
    </div>
  );
}

export interface EmptyTableProps {
  readonly activeCount: () => number;
  readonly onReset: () => void;
  readonly onCreate: () => void;
}

export function EmptyTable(props: EmptyTableProps): Node {
  const filtered = (): boolean => props.activeCount() > 0;
  return (
    <EmptyState
      compact
      title={filtered() ? "Ничего не найдено" : "Пока нет проектов"}
      description={
        filtered()
          ? "Измените фильтры или сбросьте их."
          : "Создайте первый проект, чтобы начать работу."
      }
      actions={
        <Button
          variant="tonal"
          size="sm"
          onClick={filtered() ? props.onReset : props.onCreate}
        >
          {filtered() ? "Сбросить фильтры" : "Создать проект"}
        </Button>
      }
    />
  );
}

export interface BulkDeleteProps {
  readonly onOpen: () => void;
}

export function BulkDeleteAction(props: BulkDeleteProps): Node {
  return (
    <Button size="sm" variant="filled" leading={<TrashIcon />} onClick={props.onOpen}>
      Удалить
    </Button>
  );
}

export interface TableErrorProps {
  readonly message: () => string;
  readonly onRetry: () => void;
}

export function TableError(props: TableErrorProps): Node {
  return (
    <Inline gap={2} wrap align="center">
      <Text>{props.message()}</Text>
      <Button size="sm" variant="tonal" onClick={props.onRetry}>
        Повторить
      </Button>
    </Inline>
  );
}
