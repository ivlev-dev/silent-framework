import type { Children } from "@ivlev-dev/silent-core";
import { Card, Heading, Stack, Text } from "@ivlev-dev/silent-ui";

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
      <div class="app-stat__body">
        <span class="app-stat__icon" data-tone={props.tone ?? "neutral"} aria-hidden="true">
          {props.icon}
        </span>
        <Stack gap={1}>
          <Text variant="label-medium" tone="muted">
            {props.title}
          </Text>
          <Heading level={3} class="app-stat__value">
            {props.value}
          </Heading>
          {props.hint === undefined ? null : (
            <Text variant="body-small" tone="muted">
              {props.hint}
            </Text>
          )}
        </Stack>
      </div>
    </Card>
  );
}
