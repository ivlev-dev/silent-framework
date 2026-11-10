import { insert, templateHoles } from "@ivlev-dev/silent-core";

export const ROWS = 20;

export function silentApp(): Node {
  const template = templateHoles(
    '<div class="app"><h1><!--silent-hole-0--></h1><ul class="list"><!--silent-hole-1--></ul></div>',
  )();
  insert(template.holes[0]?.parentNode ?? template.node, () => "Title", template.holes[0]);
  insert(
    template.holes[1]?.parentNode ?? template.node,
    () =>
      Array.from({ length: ROWS }, (_, index) => {
        const item = document.createElement("li");
        item.textContent = String(index);
        return item;
      }),
    template.holes[1],
  );
  return template.node;
}

export function solidHtml(): string {
  const items = Array.from({ length: ROWS }, (_, index) => `<li>${index}</li>`).join("");
  return `<div class="app"><h1>Title</h1><ul class="list">${items}</ul></div>`;
}
