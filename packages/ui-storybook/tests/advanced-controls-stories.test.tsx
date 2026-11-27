import { afterEach, describe, expect, it } from "vitest";
import meta, {
  ComboboxPlayground,
  Narrow,
  NumberFieldPlayground,
  NumberFieldStates,
  OtpPlayground,
  OtpStates,
  TagInputPlayground,
  TagInputStates,
  Themes,
} from "../src/advanced-controls.stories.js";
import { disposeStory, mountStory } from "../src/silent-story.js";

function canvas(): Element {
  const element = document.createElement("section");
  document.body.appendChild(element);
  return element;
}

function mount(story: unknown, args: object = {}): Element {
  const element = canvas();
  mountStory(story, { ...(meta.args as object), ...args }, element);
  return element;
}

afterEach(() => {
  disposeStory();
  document.body.replaceChildren();
});

describe("Advanced Controls stories", () => {
  it("meta описывает controls и autodocs", () => {
    const value = meta as Record<string, unknown>;
    expect(value["title"]).toBe("Components/Advanced Controls");
    expect(value["tags"]).toContain("autodocs");
    expect(Object.keys(value["argTypes"] as object).length).toBeGreaterThan(20);
    expect(value["args"]).toBeTypeOf("object");
  });

  it("NumberField playground монтируется со сте́пперами", () => {
    const element = mount(NumberFieldPlayground.render);
    expect(element.querySelector(".sui-number-field")).not.toBeNull();
    expect(element.querySelectorAll(".sui-number-field__stepper").length).toBe(2);
    expect(element.textContent).toContain("шт.");
  });

  it("NumberField показывает ошибку и disabled", () => {
    const element = mount(NumberFieldStates.render);
    expect(element.querySelectorAll(".sui-field__error").length).toBeGreaterThan(0);
    expect(element.querySelector('[data-disabled]')).not.toBeNull();
    expect(element.querySelector(".sui-number-field")).not.toBeNull();
  });

  it("OtpInput playground и состояния", () => {
    const playground = mount(OtpPlayground.render);
    expect(playground.querySelector(".sui-otp")).not.toBeNull();
    expect(playground.querySelectorAll(".sui-otp__slot").length).toBe(6);

    const states = mount(OtpStates.render);
    expect(states.querySelectorAll(".sui-otp").length).toBeGreaterThan(5);
    expect(states.querySelector('[data-disabled]')).not.toBeNull();
  });

  it("Combobox playground монтируется", () => {
    const playground = mount(ComboboxPlayground.render);
    expect(playground.querySelector(".sui-combobox")).not.toBeNull();
    expect(playground.querySelector(".sui-combobox__input")).not.toBeNull();
  });

  it("TagInput playground и состояния", () => {
    const playground = mount(TagInputPlayground.render, { value: "React, Vue" });
    expect(playground.querySelector(".sui-tag-input")).not.toBeNull();
    expect(playground.textContent).toContain("React");

    const states = mount(TagInputStates.render);
    expect(states.querySelectorAll(".sui-tag-input").length).toBeGreaterThan(5);
    expect(states.querySelector('[data-disabled]')).not.toBeNull();
  });

  it("темы и узкий экран сохраняют контролы", () => {
    const themes = mount(Themes.render);
    expect(themes.querySelectorAll('[data-theme="light"]').length).toBeGreaterThan(0);
    expect(themes.querySelectorAll('[data-theme="dark"]').length).toBeGreaterThan(0);

    const narrow = mount(Narrow.render);
    expect(narrow.querySelector(".sui-number-field")).not.toBeNull();
    expect(narrow.querySelector(".sui-otp")).not.toBeNull();
    expect(narrow.querySelector(".sui-combobox")).not.toBeNull();
    expect(narrow.querySelector(".sui-tag-input")).not.toBeNull();
  });
});
