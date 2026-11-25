import { describe, expect, it } from "vitest";
import type {
  ListboxItem,
  ListboxOption,
} from "../src/form/internal/listbox-engine.js";
import {
  createSelectChangeEvent,
  createTypeaheadState,
  edgeEnabledIndex,
  flattenListbox,
  indexOfValue,
  listboxId,
  listboxOptionId,
  nextEnabledIndex,
  pageEnabledIndex,
  toggleSelectedKey,
  typeahead,
} from "../src/form/internal/listbox-engine.js";
import {
  childrenText,
  filterListboxItems,
  matchesQuery,
  normalizeSearch,
} from "../src/form/internal/listbox-filter.js";

const items: readonly ListboxItem[] = [
  { value: "a", label: "Альфа" },
  { value: "b", label: "Бета", disabled: true },
  { value: "c", label: "Гамма" },
  { value: "d", label: "Дельта" },
];

const textOf = (option: { readonly label: unknown }): string =>
  childrenText(option.label as never);

describe("listbox-engine: модель и id", () => {
  it("разворачивает группы с глобальными индексами", () => {
    const flat = flattenListbox([
      items[0]!,
      {
        label: "Группа",
        options: [items[1] as ListboxOption, items[2] as ListboxOption],
      },
      items[3]!,
    ]);
    expect(flat.map((entry) => entry.key)).toEqual(["a", "b", "c", "d"]);
    expect(flat.map((entry) => entry.index)).toEqual([0, 1, 2, 3]);
    expect(flat.map((entry) => entry.groupIndex)).toEqual([-1, 0, 0, -1]);
    expect(flat[1]?.group?.label).toBe("Группа");
    expect(indexOfValue(flat, "c")).toBe(2);
    expect(indexOfValue(flat, "missing")).toBe(-1);
  });

  it("детерминированные id", () => {
    expect(listboxId("role")).toBe("role-listbox");
    expect(listboxOptionId("role", 3)).toBe("role-option-3");
  });
});

describe("listbox-engine: навигация", () => {
  const flat = flattenListbox(items);

  it("пропускает disabled и замыкает список", () => {
    expect(nextEnabledIndex(flat, 0, 1)).toBe(2);
    expect(nextEnabledIndex(flat, 2, -1)).toBe(0);
    expect(nextEnabledIndex(flat, -1, 1)).toBe(0);
    expect(nextEnabledIndex(flat, -1, -1)).toBe(3);
    expect(nextEnabledIndex(flat, 3, 1)).toBe(0);
  });

  it("без wrap упирается в край", () => {
    expect(nextEnabledIndex(flat, 3, 1, false)).toBe(-1);
    expect(nextEnabledIndex(flat, 0, -1, false)).toBe(-1);
  });

  it("Home/End и PageUp/PageDown", () => {
    expect(edgeEnabledIndex(flat, "first")).toBe(0);
    expect(edgeEnabledIndex(flat, "last")).toBe(3);
    expect(pageEnabledIndex(flat, 0, 1, 2)).toBe(3);
    expect(pageEnabledIndex(flat, 3, -1, 2)).toBe(0);
    expect(pageEnabledIndex(flat, 2, 1, 5)).toBe(3);
    expect(pageEnabledIndex(flat, 0, -1, 5)).toBe(0);
  });

  it("пустой список безопасен", () => {
    const empty = flattenListbox([]);
    expect(nextEnabledIndex(empty, 0, 1)).toBe(-1);
    expect(edgeEnabledIndex(empty, "first")).toBe(-1);
    expect(pageEnabledIndex(empty, -1, 1, 3)).toBe(-1);
  });
});

describe("listbox-engine: typeahead", () => {
  const flat = flattenListbox(items);

  it("находит по префиксу и продолжает строку", () => {
    let state = createTypeaheadState();
    let result = typeahead(state, flat, "д", 1000, -1, textOf);
    expect(result.index).toBe(3);
    state = result.state;
    // Другой символ в пределах таймаута — уже строка «де».
    result = typeahead(state, flat, "е", 1100, result.index, textOf);
    expect(result.index).toBe(3);
    expect(result.state.query).toBe("де");
  });

  it("повтор одного символа перебирает совпадения", () => {
    let state = createTypeaheadState();
    let result = typeahead(state, flat, "а", 1000, -1, textOf);
    expect(result.index).toBe(0);
    state = result.state;
    result = typeahead(state, flat, "а", 1100, result.index, textOf);
    expect(result.index).toBe(0);
    expect(result.state.query).toBe("а");
  });

  it("сбрасывает накопление после таймаута и пропускает disabled", () => {
    let state = { query: "а", key: "а", at: 0 };
    const result = typeahead(state, flat, "б", 2000, -1, textOf);
    expect(result.state.query).toBe("б");
    // «Бета» disabled, следующих совпадений нет.
    expect(result.index).toBe(-1);

    state = createTypeaheadState();
    expect(typeahead(state, flat, "ж", 1000, -1, textOf).index).toBe(-1);
  });
});

describe("listbox-filter", () => {
  it("собирает текст из строк, чисел, массивов и функций", () => {
    expect(childrenText("Текст")).toBe("Текст");
    expect(childrenText(42)).toBe("42");
    expect(childrenText(["А", ["Б"]])).toBe("А Б");
    expect(childrenText(() => "В")).toBe("В");
    expect(childrenText(null)).toBe("");
  });

  it("нормализует регистр, диакритику и пробелы", () => {
    expect(normalizeSearch("  École   Supérieure ")).toBe("ecole superieure");
    expect(matchesQuery("Ångström", "angstrom")).toBe(true);
    expect(matchesQuery("Альфа", "")).toBe(true);
    expect(matchesQuery("Альфа", "бета")).toBe(false);
  });

  it("фильтрует группы, убирая пустые", () => {
    const filtered = filterListboxItems(
      [
        { value: "a", label: "Альфа" },
        { value: "b", label: "Бета" },
        { label: "Группа", options: [
          { value: "c", label: "Гамма" },
          { value: "d", label: "Дельта" },
        ] },
      ],
      "га",
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0]).toEqual({
      label: "Группа",
      options: [{ value: "c", label: "Гамма" }],
    });
  });

  it("совпадение подписи группы сохраняет все опции", () => {
    const filtered = filterListboxItems(
      [{ label: "Напитки", options: [
        { value: "tea", label: "Чай" },
        { value: "coffee", label: "Кофе" },
      ] }],
      "напит",
    );
    expect(filtered).toHaveLength(1);
    expect("options" in filtered[0]! && filtered[0].options).toHaveLength(2);
  });
});

describe("listbox-engine: выбор и события формы", () => {
  it("multiple переключает, single заменяет", () => {
    expect(toggleSelectedKey(["a"], "a", true)).toEqual([]);
    expect(toggleSelectedKey(["a"], "b", true)).toEqual(["a", "b"]);
    expect(toggleSelectedKey(["a"], "a", false)).toEqual(["a"]);
    expect(toggleSelectedKey(["a"], "b", false)).toEqual(["b"]);
  });

  it("single: currentTarget.value", () => {
    const event = createSelectChangeEvent(["a"], false);
    const target = event.currentTarget as unknown as {
      value: string;
      multiple?: boolean;
    };
    expect(target.value).toBe("a");
    expect(target.multiple).toBeUndefined();
    expect(event.defaultPrevented).toBe(false);
    event.preventDefault();
    expect(event.defaultPrevented).toBe(true);
  });

  it("multi: currentTarget.selectedOptions", () => {
    const event = createSelectChangeEvent(["a", "b"], true);
    const target = event.currentTarget as unknown as {
      multiple: boolean;
      selectedOptions: readonly { value: string }[];
    };
    expect(target.multiple).toBe(true);
    expect(target.selectedOptions.map((option) => option.value)).toEqual(["a", "b"]);
  });
});
