import type { Children } from "@ivlev-dev/silent-core";
import {
  Alert,
  Button,
  Card,
  Heading,
  Inline,
  Skeleton,
  Stack,
  Text,
} from "@ivlev-dev/silent-ui";

export interface PageHeaderProps {
  readonly title: string;
  readonly description: string;
  readonly actions?: Children;
}

export function PageHeader(props: PageHeaderProps): Node {
  return (
    <div class="app-page-header">
      <div class="app-page-header__text">
        <Heading level={2}>{props.title}</Heading>
        <Text tone="muted">{props.description}</Text>
      </div>
      {props.actions === undefined ? null : (
        <Inline gap={2} wrap class="app-page-header__actions">
          {props.actions}
        </Inline>
      )}
    </div>
  );
}

export interface ErrorStateProps {
  readonly title?: string;
  readonly message: string;
  readonly onRetry?: () => void;
}

export function ErrorState(props: ErrorStateProps): Node {
  return (
    <Alert
      variant="error"
      title={props.title ?? "Не удалось загрузить данные"}
      actions={
        props.onRetry === undefined ? null : (
          <Button variant="tonal" size="sm" onClick={props.onRetry}>
            Повторить
          </Button>
        )
      }
    >
      {props.message}
    </Alert>
  );
}

export interface SkeletonCardsProps {
  readonly count?: number;
  readonly height?: number;
}

export function SkeletonCards(props: SkeletonCardsProps): Node {
  const count = props.count ?? 4;
  return (
    <div class="app-metrics" aria-hidden="true">
      {Array.from({ length: count }, (_value, index) => (
        <Card variant="outlined" padding={4}>
          <Stack gap={2}>
            <Skeleton variant="text" width={index % 2 === 0 ? "48%" : "64%"} />
            <Skeleton variant="rect" width="38%" height={props.height ?? 36} />
            <Skeleton variant="text" width="72%" />
          </Stack>
        </Card>
      ))}
    </div>
  );
}
