import { insert, templateHoles } from "@ivlev-dev/silent-core";

export const ROWS = 20;

function row(index: number): Node {
  const template = templateHoles("<li><!--silent-hole-0--></li>")();
  const hole = template.holes[0];
  insert((hole?.parentNode ?? template.node) as Node, () => String(index), hole);
  return template.node;
}

export function silentApp(): Node {
  const template = templateHoles(
    '<div class="app"><h1><!--silent-hole-0--></h1><ul class="list"><!--silent-hole-1--></ul></div>',
  )();
  const title = template.holes[0];
  insert((title?.parentNode ?? template.node) as Node, () => "Title", title);
  const items = template.holes[1];
  insert(
    (items?.parentNode ?? template.node) as Node,
    () => Array.from({ length: ROWS }, (_, index) => row(index)),
    items,
  );
  return template.node;
}

export function solidHtml(): string {
  const items = Array.from({ length: ROWS }, (_, index) => `<li>${index}</li>`).join("");
  return `<div class="app"><h1>Title</h1><ul class="list">${items}</ul></div>`;
}
