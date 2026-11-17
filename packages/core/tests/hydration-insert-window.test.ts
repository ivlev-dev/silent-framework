// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { installHydrationRuntime } from "../src/hydration";
import { findInsertWindow } from "../src/hydration-proxy";

installHydrationRuntime();

function commentByData(parent: Node, data: string): Comment {
  let node = parent.firstChild;
  while (node !== null) {
    if (node.nodeType === 8 && (node as Comment).data === data) {
      return node as Comment;
    }
    node = node.nextSibling;
  }
  throw new Error(`не найден комментарий ${data}`);
}

describe("findInsertWindow", () => {
  it("находит нужный регион, если у родителя их несколько", () => {
    const parent = document.createElement("div");
    parent.innerHTML = [
      "<!--silent-insert--><i>a</i><!--silent-insert-end-->",
      "<!--silent-hole-0-->",
      "<!--silent-insert--><b>c</b><!--silent-insert-end-->",
      "<!--silent-hole-1-->",
    ].join("");

    const hole = commentByData(parent, "silent-hole-1");
    const end = hole.previousSibling;
    const window = findInsertWindow(hole, parent);
    expect(window.end).toBe(end);
    expect(window.start.data).toBe("silent-insert");
    expect(window.start.nextSibling).toBe(end?.previousSibling);
    expect(window.start.nextSibling?.nextSibling).toBe(end);
  });

  it("поддерживает пустой регион в начале родителя", () => {
    const parent = document.createElement("div");
    parent.innerHTML = "<!--silent-insert--><!--silent-insert-end--><!--silent-hole-0-->";

    const hole = commentByData(parent, "silent-hole-0");
    const window = findInsertWindow(hole, parent);
    expect(window.start).toBe(parent.firstChild);
    expect(window.end).toBe(hole.previousSibling);
  });
});
