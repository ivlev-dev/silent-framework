import type { Children } from "@ivlev-dev/silent-core";
import { Card, Text } from "@ivlev-dev/silent-ui";

export interface StatCardProps {
  readonly title: string;
  readonly value: Children;
  readonly hint?: Children;
  readonly icon?: Children;
  readonly tone?: "neutral" | "success" | "warning" | "primary";
}

export function StatCard(props: StatCardProps): Node {
  return (
    <Card variant="outlined" padding={4} class="app-stat">
      <div class="app-stat__head">
        <Text variant="label-medium" tone="muted" class="app-stat__label">
          {props.title}
        </Text>
        <span
          class="app-stat__icon"
          data-tone={props.tone ?? "neutral"}
          aria-hidden="true"
        >
          {props.icon}
        </span>
      </div>
      <span class="app-stat__value">{props.value}</span>
      {props.hint === undefined ? null : (
        <span class="app-stat__hint">{props.hint}</span>
      )}
    </Card>
  );
}
