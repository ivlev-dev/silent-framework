import type {
  Children,
  ClassNameValue,
  StyleInput,
} from "@ivlev-dev/silent-core";
import type { Attrs } from "../../internal/props.js";
import type { BoundField, ControlSize } from "../internal/control.js";
import type {
  TreeCascade,
  TreeEmit,
  TreeNode,
  TreeNodeValue,
  TreeSearchStrategy,
} from "../internal/tree-engine.js";

export type TreeSelectNode = TreeNode;
export type TreeSelectValue = TreeNodeValue | readonly TreeNodeValue[];
export type TreeSelectCascade = TreeCascade;
export type TreeSelectEmit = TreeEmit;
export type TreeSelectSearchStrategy = TreeSearchStrategy;
export type TreeSelectExpandTrigger = "icon" | "row";

export interface TreeSelectProps {
  readonly nodes: readonly TreeSelectNode[];
  /** Значение: узел или массив узлов для `multiple`. */
  readonly value?: TreeSelectValue | undefined;
  readonly defaultValue?: TreeSelectValue | undefined;
  readonly onValueChange?: ((value: TreeSelectValue) => void) | undefined;
  readonly field?:
    | BoundField<string | number | readonly string[]>
    | undefined;
  readonly multiple?: boolean | undefined;
  /**
   * Каскад выбора. По умолчанию `both` для `multiple` и `independent`
   * для одиночного выбора.
   */
  readonly cascade?: TreeSelectCascade | undefined;
  /** Какие узлы попадают в значение. По умолчанию `leaves`. */
  readonly emit?: TreeSelectEmit | undefined;
  /** Можно ли выбирать узлы с детьми. По умолчанию `true`. */
  readonly selectableParents?: boolean | undefined;
  readonly expanded?: readonly TreeNodeValue[] | undefined;
  readonly defaultExpanded?: readonly TreeNodeValue[] | undefined;
  readonly onExpandedChange?:
    | ((expanded: readonly TreeNodeValue[]) => void)
    | undefined;
  /** Что раскрывает узел: иконка или вся строка. По умолчанию `row`. */
  readonly expandOnClick?: TreeSelectExpandTrigger | undefined;
  /** Показывать поиск в панели. По умолчанию `true`. */
  readonly searchable?: boolean | undefined;
  /** `keep-ancestors` оставляет путь до совпадений. По умолчанию он же. */
  readonly searchStrategy?: TreeSelectSearchStrategy | undefined;
  /** Показывать результаты поиска одним уровнем. По умолчанию `false`. */
  readonly flattenOnSearch?: boolean | undefined;
  /** Чекбоксы строк. По умолчанию включены при `multiple`. */
  readonly showCheckboxes?: boolean | undefined;
  readonly renderOption?:
    | ((node: TreeSelectNode) => Children)
    | undefined;
  /** Подпись узла в триггере и чипах. По умолчанию — текст `label`. */
  readonly getOptionLabel?: ((node: TreeSelectNode) => string) | undefined;
  readonly empty?: Children;
  readonly loading?: boolean | undefined;
  readonly loadingText?: Children;
  readonly maxVisibleOptions?: number | undefined;
  readonly size?: ControlSize | undefined;
  readonly label?: Children;
  readonly hint?: Children;
  readonly error?: Children;
  readonly placeholder?: string | undefined;
  readonly name?: string | undefined;
  readonly id?: string | undefined;
  readonly required?: boolean | undefined;
  /** Ошибка без текста: контрол невалиден, сообщения ещё нет. */
  readonly invalid?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly readOnly?: boolean | undefined;
  readonly bare?: boolean | undefined;
  readonly describedBy?: string | undefined;
  /** Доступное имя, если видимой подписи нет. */
  readonly ariaLabel?: string | undefined;
  readonly onChange?: ((event: Event) => void) | undefined;
  readonly onBlur?: ((event: FocusEvent) => void) | undefined;
  readonly onFocus?: ((event: FocusEvent) => void) | undefined;
  readonly class?: ClassNameValue;
  readonly style?: StyleInput;
  readonly attrs?: Attrs;
}
