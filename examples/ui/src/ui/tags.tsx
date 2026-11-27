import { For } from "@ivlev-dev/silent-core";
import { Tag, Text } from "@ivlev-dev/silent-ui";

export interface TagLineProps {
  readonly tags: readonly string[];
  readonly max?: number;
}

export function TagLine(props: TagLineProps): Node {
  const max = props.max ?? 2;
  const visible = props.tags.slice(0, max);
  const rest = props.tags.length - visible.length;
  const title = props.tags.map((tag) => `#${tag}`).join(", ");

  if (props.tags.length === 0) {
    return (
      <Text variant="body-small" tone="muted">
        —
      </Text>
    );
  }

  return (
    <span class="app-tag-line" title={title}>
      <For each={visible}>
        {(tag) => (
          <Tag size="sm" variant="neutral">
            #{tag}
          </Tag>
        )}
      </For>
      {rest > 0 ? (
        <Tag size="sm" variant="secondary" attrs={{ "aria-label": `Ещё тегов: ${String(rest)}` }}>
          +{String(rest)}
        </Tag>
      ) : null}
    </span>
  );
}
