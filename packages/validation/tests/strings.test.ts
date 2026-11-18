import { describe, expect, it } from "vitest";
import { IsEmail, MinLength, stringRules } from "../src/rules/strings.js";
import { validationStateFor } from "../src/registry.js";
import type { RuleDefinition, RuleRunContext } from "../src/types.js";

function contextFor(
  params: Readonly<Record<string, unknown>>,
): RuleRunContext {
  return {
    instance: {},
    field: "value",
    label: "Value",
    path: "value",
    params,
  };
}

function run(
  rule: RuleDefinition,
  value: unknown,
): boolean | Promise<boolean> {
  return rule.check(value, contextFor(rule.params));
}

describe("MinLength", () => {
  it("проверяет нижнюю границу длины", () => {
    const rule: RuleDefinition = {
      ...stringRules.minLength,
      params: { min: 3 },
    };
    expect(run(rule, "abc")).toBe(true);
    expect(run(rule, "abcd")).toBe(true);
    expect(run(rule, "ab")).toBe(false);
    expect(run(rule, "")).toBe(false);
    expect(rule.params).toEqual({ min: 3 });
  });

  it("не пропускает не-строки", () => {
    const rule: RuleDefinition = {
      ...stringRules.minLength,
      params: { min: 1 },
    };
    expect(run(rule, 123)).toBe(false);
    expect(run(rule, null)).toBe(false);
    expect(run(rule, undefined)).toBe(false);
    expect(run(rule, ["a"])).toBe(false);
  });
});

describe("MaxLength", () => {
  it("проверяет верхнюю границу длины", () => {
    const rule: RuleDefinition = {
      ...stringRules.maxLength,
      params: { max: 3 },
    };
    expect(run(rule, "")).toBe(true);
    expect(run(rule, "abc")).toBe(true);
    expect(run(rule, "abcd")).toBe(false);
    expect(run(rule, 12)).toBe(false);
  });
});

describe("Length", () => {
  it("требует точную длину", () => {
    const rule: RuleDefinition = {
      ...stringRules.length,
      params: { length: 2 },
    };
    expect(run(rule, "ab")).toBe(true);
    expect(run(rule, "a")).toBe(false);
    expect(run(rule, "abc")).toBe(false);
    expect(run(rule, 0)).toBe(false);
  });
});

describe("Matches", () => {
  it("принимает строковый шаблон", () => {
    const rule: RuleDefinition = {
      ...stringRules.matches,
      params: { pattern: new RegExp("^a\\d+$") },
    };
    expect(run(rule, "a12")).toBe(true);
    expect(run(rule, "b12")).toBe(false);
    expect(run(rule, 12)).toBe(false);
  });

  it("учитывает флаги регулярного выражения", () => {
    const rule: RuleDefinition = {
      ...stringRules.matches,
      params: { pattern: /foo/i },
    };
    expect(run(rule, "FOO")).toBe(true);
    expect(run(rule, "bar")).toBe(false);
  });

  it("сбрасывает lastIndex у глобального выражения", () => {
    const pattern = /a/g;
    const rule: RuleDefinition = {
      ...stringRules.matches,
      params: { pattern },
    };
    expect(run(rule, "a")).toBe(true);
    expect(run(rule, "a")).toBe(true);
    expect(run(rule, "b")).toBe(false);
    expect(pattern.lastIndex).toBe(0);
  });
});

describe("IsEmail", () => {
  it("пропускает корректные адреса", () => {
    for (const value of [
      "user@example.com",
      "first.last+tag@sub.example.co",
      "u_1@example.io",
    ]) {
      expect(run(stringRules.isEmail, value), value).toBe(true);
    }
  });

  it("отклоняет некорректные адреса и не-строки", () => {
    for (const value of [
      "user@example",
      "user@.com",
      "@example.com",
      "user example@test.com",
      "user@exa_mple.com",
      "a@b.c",
      "",
      42,
      null,
    ]) {
      expect(run(stringRules.isEmail, value), String(value)).toBe(false);
    }
  });
});

describe("IsUrl", () => {
  it("пропускает http и https", () => {
    for (const value of [
      "https://example.com",
      "http://localhost:3000/path?q=1#hash",
      "https://sub.example.co.uk/a/b",
    ]) {
      expect(run(stringRules.isUrl, value), value).toBe(true);
    }
  });

  it("отклоняет другие протоколы, относительные адреса и пробелы", () => {
    for (const value of [
      "ftp://example.com",
      "example.com",
      "//example.com",
      "https://",
      " http://example.com",
      "http://example.com ",
      null,
    ]) {
      expect(run(stringRules.isUrl, value), String(value)).toBe(false);
    }
  });
});

describe("IsUUID", () => {
  it("проверяет формат 8-4-4-4-12", () => {
    expect(
      run(stringRules.isUUID, "123e4567-e89b-12d3-a456-426614174000"),
    ).toBe(true);
    expect(
      run(stringRules.isUUID, "123E4567-E89B-12D3-A456-426614174000"),
    ).toBe(true);
  });

  it("отклоняет неверный формат", () => {
    for (const value of [
      "123e4567-e89b-12d3-a456-42661417400",
      "123e4567-e89b-12d3-a456-4266141740000",
      "g23e4567-e89b-12d3-a456-426614174000",
      "{123e4567-e89b-12d3-a456-426614174000}",
      123,
    ]) {
      expect(run(stringRules.isUUID, value), String(value)).toBe(false);
    }
  });
});

describe("IsISO8601", () => {
  it("пропускает ISO-даты и даты-время", () => {
    for (const value of [
      "2024-02-29",
      "2024-02-29T12:30:45Z",
      "2024-02-29T12:30:45.123+03:00",
      "2024-12-31T23:59:59",
    ]) {
      expect(run(stringRules.isISO8601, value), value).toBe(true);
    }
  });

  it("отклоняет не-ISO и несуществующие даты", () => {
    for (const value of [
      "29-02-2024",
      "2024-1-1",
      "2024-13-01",
      "2024-01-32",
      "not-a-date",
      "",
      20240229,
    ]) {
      expect(run(stringRules.isISO8601, value), String(value)).toBe(false);
    }
  });
});

describe("IsPhone", () => {
  it("пропускает телефоны с разделителями", () => {
    for (const value of ["+7 (999) 123-45-67", "1234567", "123 456 78"]) {
      expect(run(stringRules.isPhone, value), value).toBe(true);
    }
  });

  it("отклоняет слишком короткие, длинные и буквенные значения", () => {
    for (const value of [
      "123456",
      "abcdefgh",
      "+123456789012345678901",
      "",
      79991234567,
    ]) {
      expect(run(stringRules.isPhone, value), String(value)).toBe(false);
    }
  });
});

describe("IsAlpha", () => {
  it("поддерживает Unicode-буквы", () => {
    for (const value of ["abc", "Привет", "Ёжик", "日本語"]) {
      expect(run(stringRules.isAlpha, value), value).toBe(true);
    }
  });

  it("отклоняет цифры, пробелы и пустую строку", () => {
    for (const value of ["abc1", "abc def", "a-b", "", null]) {
      expect(run(stringRules.isAlpha, value), String(value)).toBe(false);
    }
  });
});

describe("IsAlphanumeric", () => {
  it("пропускает буквы и цифры", () => {
    for (const value of ["abc123", "Привет42", "42"]) {
      expect(run(stringRules.isAlphanumeric, value), value).toBe(true);
    }
  });

  it("отклоняет посторонние символы", () => {
    for (const value of ["abc-123", "abc 123", "", 123]) {
      expect(run(stringRules.isAlphanumeric, value), String(value)).toBe(false);
    }
  });
});

describe("IsSlug", () => {
  it("пропускает kebab-case из нижних букв и цифр", () => {
    for (const value of ["a", "post", "my-post-2"]) {
      expect(run(stringRules.isSlug, value), value).toBe(true);
    }
  });

  it("отклоняет верхний регистр и неверные разделители", () => {
    for (const value of ["", "-a", "a-", "a--b", "A-b", "a_b", "a b"]) {
      expect(run(stringRules.isSlug, value), value).toBe(false);
    }
  });
});

describe("IsHexColor", () => {
  it("пропускает rgb, rgba, rrggbb и rrggbbaa", () => {
    for (const value of ["#abc", "#ABC", "#abcd", "#a1b2c3", "#a1b2c3d4"]) {
      expect(run(stringRules.isHexColor, value), value).toBe(true);
    }
  });

  it("отклоняет неверную длину и символы", () => {
    for (const value of ["#ab", "#abcde", "#abcdefa", "abcde", "#ggg"]) {
      expect(run(stringRules.isHexColor, value), value).toBe(false);
    }
  });
});

describe("IsBase64", () => {
  it("пропускает строки корректной длины и алфавита", () => {
    for (const value of ["TWFu", "TWE=", "TQ==", "aGVsbG8=", "YWJjZA=="]) {
      expect(run(stringRules.isBase64, value), value).toBe(true);
    }
  });

  it("отклоняет пустые, недополненные и посторонние символы", () => {
    for (const value of ["", "TWE", "TQ=", "====", "TWFu=", "TW Fu", "TWFu\n"]) {
      expect(run(stringRules.isBase64, value), JSON.stringify(value)).toBe(false);
    }
    expect(run(stringRules.isBase64, 123)).toBe(false);
    expect(run(stringRules.isBase64, null)).toBe(false);
  });
});

describe("IsJSON", () => {
  it("пропускает любые корректные JSON-значения", () => {
    for (const value of ["{}", "[]", '"text"', "123", "null", "true", '{"a":[1,2]}']) {
      expect(run(stringRules.isJSON, value), value).toBe(true);
    }
  });

  it("отклоняет невалидный JSON и не-строки", () => {
    for (const value of ["{a:1}", "{'a':1}", "", "undefined", 123, null]) {
      expect(run(stringRules.isJSON, value), String(value)).toBe(false);
    }
  });
});

describe("регистрация декораторов", () => {
  it("регистрирует @IsEmail и @MinLength с параметрами", () => {
    class ContactForm {
      @IsEmail()
      @MinLength(3)
      public accessor value = "";
    }

    const state = validationStateFor(new ContactForm());
    const entries = state.fields.get("value")?.rules ?? [];

    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.rule.name)).toEqual([
      "minLength",
      "isEmail",
    ]);
    expect(entries[0]?.rule.params).toEqual({ min: 3 });
    expect(entries[1]?.rule.params).toEqual({});
  });
});
