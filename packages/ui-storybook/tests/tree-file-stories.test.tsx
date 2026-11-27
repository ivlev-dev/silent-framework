import { afterEach, describe, expect, it } from "vitest";
import treeMeta, {
  Playground as TreePlayground,
  States as TreeStates,
} from "../src/tree-select.stories.js";
import fileMeta, {
  Playground as FilePlayground,
  WithFiles,
} from "../src/file-upload.stories.js";
import formMeta, {
  SelectAsync,
  SelectVirtual,
} from "../src/form-controls.stories.js";
import { disposeStory, mountStory } from "../src/silent-story.js";

function canvas(): Element {
  const element = document.createElement("section");
  document.body.appendChild(element);
  return element;
}

function mount(story: unknown, args: object): Element {
  const element = canvas();
  mountStory(story, { ...args }, element);
  return element;
}

afterEach(() => {
  disposeStory();
  document.body.replaceChildren();
});

describe("tree-select и file-upload stories", () => {
  it("meta описывает controls, playground монтируется", () => {
    for (const meta of [treeMeta, fileMeta] as Array<Record<string, unknown>>) {
      expect(typeof meta["title"]).toBe("string");
      expect(Object.keys(meta["argTypes"] as object).length).toBeGreaterThan(0);
      expect(meta["args"]).toBeTypeOf("object");
    }

    const tree = mount(
      TreePlayground.render,
      treeMeta.args as Record<string, unknown>,
    );
    expect(tree.querySelector(".sui-tree-select")).not.toBeNull();
    expect(tree.querySelector('[role="combobox"]')).not.toBeNull();

    const upload = mount(
      FilePlayground.render,
      fileMeta.args as Record<string, unknown>,
    );
    expect(upload.querySelector(".sui-file-upload")).not.toBeNull();
    expect(upload.querySelector('input[type="file"]')).not.toBeNull();
  });

  it("состояния TreeSelect и FileUpload рендерят несколько контролов", () => {
    const tree = mount(TreeStates.render, {});
    expect(tree.querySelectorAll(".sui-tree-select").length).toBeGreaterThan(3);

    const upload = mount(WithFiles.render, {});
    expect(upload.querySelectorAll(".sui-file-upload__item").length).toBe(3);
    expect(upload.textContent).toContain("contract.pdf");
  });

  it("Select-истории асинхронного и виртуального списка монтируются", () => {
    const asyncSelect = mount(SelectAsync.render, {});
    expect(asyncSelect.querySelector(".sui-select")).not.toBeNull();
    expect(formMeta.args).toBeTypeOf("object");

    const virtual = mount(SelectVirtual.render, {});
    expect(virtual.querySelector(".sui-select")).not.toBeNull();
  });
});
