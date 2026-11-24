import type { Children, ClassNameValue, StyleInput } from "@ivlev-dev/silent-core";
import { Show, createEffect, createSignal } from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";

export type AvatarSize = "sm" | "md" | "lg" | "xl";
export type AvatarShape = "circle" | "square";
export type AvatarStatus = "online" | "offline" | "away" | "busy";

export interface AvatarProps {
  /** URL изображения. При наличии рендерится `<img>` (готов к SSR). */
  readonly src?: string | undefined;
  /** Alt изображения; также доступное имя для fallback-вариантов. */
  readonly alt?: string | undefined;
  /** Инициалы, если нет изображения. */
  readonly initials?: string | undefined;
  /** Иконка-fallback; по умолчанию — силуэт пользователя. */
  readonly icon?: Children;
  readonly size?: AvatarSize | undefined;
  readonly shape?: AvatarShape | undefined;
  /** Точка статуса в правом нижнем углу. */
  readonly status?: AvatarStatus | undefined;
  /** Подпись статуса для скринридера; без неё точка декоративна. */
  readonly statusLabel?: string | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
  readonly ref?: ((node: Element | null) => void) | undefined;
}

const PERSON_PATH =
  "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-3.31 0-8 1.66-8 4.96V21h16v-2.04C20 15.66 15.31 14 12 14Z";

/**
 * Аватар: изображение → инициалы → иконка. Один корень, размер/форма/статус
 * через `data-*`. Ошибка загрузки `src` переключает на fallback; смена `src`
 * сбрасывает ошибку. Точка статуса не добавляет имени, если `statusLabel` нет.
 */
export function Avatar(props: AvatarProps): Node {
  const [failed, setFailed] = createSignal(false);
  let currentSrc = props.src;

  // Новый `src` — новая попытка загрузки: сбрасываем прошлую ошибку.
  createEffect(() => {
    const src = props.src;
    if (src === currentSrc) return;
    currentSrc = src;
    setFailed(false);
  });

  const hasImage = (): boolean =>
    typeof props.src === "string" && props.src.length > 0;
  const showImage = (): boolean => hasImage() && !failed();
  const initials =
    typeof props.initials === "string" && props.initials.length > 0
      ? props.initials
      : undefined;
  const fallbackLabel = (): string | undefined =>
    showImage() ? undefined : props.alt;

  return (
    <span
      {...props.attrs}
      ref={props.ref}
      class={["sui-avatar", props.class]}
      style={props.style}
      data-size={props.size ?? "md"}
      data-shape={props.shape ?? "circle"}
      data-status={props.status}
      role={fallbackLabel() === undefined ? undefined : "img"}
      aria-label={fallbackLabel()}
    >
      {showImage() ? (
        <img
          class="sui-avatar__image"
          src={props.src ?? ""}
          alt={props.alt ?? ""}
          loading="lazy"
          decoding="async"
          on:error={() => {
            setFailed(true);
          }}
        />
      ) : initials !== undefined ? (
        <span class="sui-avatar__initials" aria-hidden="true">
          {initials}
        </span>
      ) : (
        <span class="sui-avatar__icon" aria-hidden="true">
          {props.icon ?? (
            <svg viewBox="0 0 24 24" focusable="false">
              <path d={PERSON_PATH} fill="currentColor" />
            </svg>
          )}
        </span>
      )}
      <Show when={props.status !== undefined}>
        <span
          class="sui-avatar__status"
          role={props.statusLabel === undefined ? undefined : "img"}
          aria-label={props.statusLabel}
          aria-hidden={props.statusLabel === undefined ? "true" : undefined}
        />
      </Show>
    </span>
  );
}
