import { describe, expect, it } from "vitest";
import { shapeMatches, staleAttributes } from "../src/hydration.js";

function element(html: string): Element {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host.firstElementChild as Element;
}

describe("shapeMatches: текстовые дыры", () => {
  it("совпадает на идентичной разметке в simple-режиме", () => {
    const markup = '<p class="greeting">Hello <!--silent-hole-0--></p>';
    expect(shapeMatches(element(markup), element(markup), true, true)).toBe(true);
  });

  it("сравнивает узел с самим собой без изменений разметки", () => {
    const node = element('<p class="greeting">Hello <!--silent-hole-0--></p>');
    expect(shapeMatches(node, node, true, true)).toBe(true);
    expect((node as HTMLElement).innerHTML).toBe("Hello <!--silent-hole-0-->");
  });

  it("совпадает, если fresh-префикс короче слитого claimed-текста", () => {
    const fresh = element('<p class="greeting">Hello <!--silent-hole-0--></p>');
    const claimed = element('<p class="greeting">Hello world<!--silent-hole-0--></p>');
    expect(shapeMatches(fresh, claimed, true, true)).toBe(true);
    expect(shapeMatches(fresh, claimed, true, false)).toBe(true);
  });

  it("совпадает в metadata-шаблоне с вложенной дырой", () => {
    const fresh = element(
      '<main><title>t</title><p class="greeting">Hello <!--silent-hole-0--></p></main>',
    );
    const claimed = element('<main><p class="greeting">Hello world<!--silent-hole-0--></p></main>');
    expect(shapeMatches(fresh, claimed, true, false)).toBe(true);
  });

  it("совпадает, если claimed-текст короче fresh-префикса", () => {
    const fresh = element('<p class="greeting">Hello world<!--silent-hole-0--></p>');
    const claimed = element('<p class="greeting">Hello <!--silent-hole-0--></p>');
    expect(shapeMatches(fresh, claimed, true, true)).toBe(true);
  });

  it("совпадает с пустой дырой без статического префикса", () => {
    const fresh = element('<p class="greeting"><!--silent-hole-0--></p>');
    const claimed = element('<p class="greeting">world<!--silent-hole-0--></p>');
    expect(shapeMatches(fresh, claimed, true, false)).toBe(true);
  });

  it("учитывает статический суффикс после дыры", () => {
    const fresh = element('<p class="greeting">Hello <!--silent-hole-0-->!</p>');
    const claimed = element('<p class="greeting">Hello world<!--silent-hole-0-->!</p>');
    expect(shapeMatches(fresh, claimed, true, false)).toBe(true);
  });

  it("отклоняет несовпадающий статический префикс", () => {
    const fresh = element('<p class="greeting">Hello <!--silent-hole-0--></p>');
    const claimed = element('<p class="greeting">Hi world<!--silent-hole-0--></p>');
    expect(shapeMatches(fresh, claimed, true, true)).toBe(false);
    expect(shapeMatches(fresh, claimed, true, false)).toBe(false);
  });

  it("отклоняет несовпадающий статический суффикс", () => {
    const fresh = element('<p class="greeting">Hello <!--silent-hole-0-->!</p>');
    const claimed = element('<p class="greeting">Hello world<!--silent-hole-0-->?</p>');
    expect(shapeMatches(fresh, claimed, true, false)).toBe(false);
  });
});

describe("shapeMatches: служебный tbody", () => {
  function rowTable(): { fresh: Element; claimed: Element } {
    const fresh = document.createElement("table");
    const row = document.createElement("tr");
    row.appendChild(document.createElement("td"));
    fresh.appendChild(row);
    return {
      fresh,
      claimed: element("<table><tbody><tr><td></td></tr></tbody></table>"),
    };
  }

  it("пропускает tbody, добавленный парсером серверной разметки", () => {
    const { fresh, claimed } = rowTable();
    expect(shapeMatches(fresh, claimed, true)).toBe(true);
    expect(shapeMatches(fresh, claimed, true, true)).toBe(true);
  });

  it("сравнивает содержимое внутри служебного tbody", () => {
    const { fresh, claimed } = rowTable();
    const cell = claimed.querySelector("td");
    cell?.appendChild(document.createTextNode("server"));
    expect(shapeMatches(fresh, claimed, true)).toBe(false);
  });

  it("пропускает tbody и на свежей стороне", () => {
    const fresh = element("<table><tbody><tr><td></td></tr></tbody></table>");
    const claimed = document.createElement("table");
    const row = document.createElement("tr");
    row.appendChild(document.createElement("td"));
    claimed.appendChild(row);
    expect(shapeMatches(fresh, claimed, true)).toBe(true);
  });
});

describe("shapeMatches: атрибуты", () => {
  it("в обычном режиме игнорирует устаревшие атрибуты claimed", () => {
    const fresh = element('<p class="greeting">x</p>');
    const claimed = element('<p class="greeting" title="stale">x</p>');
    expect(shapeMatches(fresh, claimed)).toBe(true);
  });

  it("в strict-режиме отклоняет устаревшие атрибуты claimed", () => {
    const fresh = element('<p class="greeting">x</p>');
    const claimed = element('<p class="greeting" title="stale">x</p>');
    expect(shapeMatches(fresh, claimed, false, false, true)).toBe(false);
  });

  it("в strict-режиме принимает совпадающие атрибуты", () => {
    const markup = '<p class="greeting" title="same">x</p>';
    expect(shapeMatches(element(markup), element(markup), false, false, true)).toBe(true);
  });

  it("перечисляет устаревшие атрибуты claimed", () => {
    const fresh = element('<p class="greeting">x</p>');
    const claimed = element('<p class="greeting" title="stale" data-old="1">x</p>');
    expect(staleAttributes(fresh, claimed)).toEqual(["title", "data-old"]);
  });
});
