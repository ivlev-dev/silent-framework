/**
 * Коды клавиш, используемые клавиатурным сенсором.
 *
 * Значения совпадают с `KeyboardEvent.code`, поэтому enum подходит и для
 * проверки `event.code`, и для сравнения с `event.key` для клавиш со
 * совпадающими именами (`ArrowDown`, `Home`, `End` и т.п.).
 */
export enum KeyboardCode {
  Space = "Space",
  Down = "ArrowDown",
  Right = "ArrowRight",
  Left = "ArrowLeft",
  Up = "ArrowUp",
  Esc = "Escape",
  Enter = "Enter",
  Tab = "Tab",
  Home = "Home",
  End = "End",
}

/** Порядок обхода элементов: в ширину или в глубину. */
export enum TraversalOrder {
  BreadthFirst = 0,
  DepthFirst = 1,
}
