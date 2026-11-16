import { container as rootContainer } from "@ivlev-dev/silent-di";
import {
  createComponent,
  resetIds,
  setMetadataCollector,
  setServerBackend,
  setServerMode,
  type AnyComponent,
  type ComponentResult,
  type RuntimeOptions,
} from "@ivlev-dev/silent-core";
import { createRoot } from "@ivlev-dev/silent-reactivity";
import { createDocument, installDomGlobals } from "./dom/document.js";
import { acquireParts, pushNode, releaseParts } from "./dom/serializer.js";
import { createServerBackend } from "./string-backend.js";
import type { DomNode } from "./dom/types.js";
import type { RenderOptions } from "./render.js";

const SERVER_DOCUMENT = createDocument();
const SERVER_BACKEND = createServerBackend();

let requestSeq = 0;

function noop(): void {}

function serializeHead(nodes: readonly Element[]): string {
  if (nodes.length === 0) {
    return "";
  }
  const parts = acquireParts();
  try {
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      if (node !== undefined) {
        pushNode(node as unknown as DomNode, parts);
      }
    }
    const only = parts[0];
    if (only === undefined) {
      return "";
    }
    return parts.length === 1 ? only : parts.join("");
  } finally {
    releaseParts(parts);
  }
}

export interface RenderSession {
  readonly result: ComponentResult;
  serializeHead(): string;
  throwIfFailed(): void;
  dispose(): void;
}

export function beginRenderSession(
  app: AnyComponent,
  options: RenderOptions = {},
): RenderSession {
  const baseContainer = options.container ?? rootContainer;
  requestSeq += 1;
  resetIds();
  const requestScope = baseContainer.createScope(`request:${requestSeq}`);

  const restore = installDomGlobals(SERVER_DOCUMENT, { keepShape: true });
  setServerMode(true);
  setServerBackend(SERVER_BACKEND);

  let disposeRoot: () => void = noop;
  let failure: unknown = null;
  let failed = false;
  const headNodes: Element[] = [];

  setMetadataCollector((node) => {
    headNodes.push(node);
  });

  const handleError = (error: unknown, component: AnyComponent): void => {
    if (options.onError !== undefined) {
      options.onError(error, component);
      return;
    }
    if (!failed) {
      failed = true;
      failure = error;
    }
  };

  const runtimeOptions: RuntimeOptions = {
    container: requestScope,
    preloader: options.preloader,
    onError: handleError,
  };

  let result: ComponentResult | null = null;
  try {
    result = createRoot((dispose) => {
      disposeRoot = dispose;
      return createComponent(app, options.props ?? {}, runtimeOptions);
    });
  } catch (error) {
    cleanup(null);
    throw error;
  }

  if (result === null) {
    const error = new Error("Не удалось создать корневой компонент");
    cleanup(null);
    throw error;
  }

  const session: RenderSession = {
    result,
    serializeHead: () => serializeHead(headNodes),
    throwIfFailed: () => {
      if (failed) {
        throw failure;
      }
    },
    dispose: () => cleanup(result),
  };

  return session;

  function cleanup(created: ComponentResult | null): void {
    setMetadataCollector(null);
    setServerBackend(null);
    restore();
    setServerMode(false);

    let disposalError: unknown = null;
    let disposalFailed = false;
    const capture = (task: () => void): void => {
      try {
        task();
      } catch (error) {
        if (!disposalFailed) {
          disposalFailed = true;
          disposalError = error;
        }
      }
    };

    if (created !== null) {
      capture(() => created.dispose());
    }
    capture(disposeRoot);
    capture(() => requestScope.dispose());

    if (disposalFailed) {
      throw disposalError;
    }
  }
}
