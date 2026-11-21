import { container as rootContainer } from "@ivlev-dev/silent-di";
import {
  createComponent,
  resetIds,
  resetRuntimeOptions,
  setMetadataCollector,
  setServerBackend,
  setServerMode,
  setServerStreamCollector,
  type AnyComponent,
  type ComponentResult,
  type RuntimeOptions,
  type ServerStreamCollector,
} from "@ivlev-dev/silent-core";
import {
  createRuntimeContextStore,
  getRuntimeContextProvider,
  getRuntimeContextStore,
  hasRuntimeContextProvider,
  type RuntimeContextStore,
} from "@ivlev-dev/silent-core/runtime-context-provider";
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

function closeRuntimeStore(store: RuntimeContextStore | null): void {
  if (store === null) {
    return;
  }
  store.active = false;
  store.options = {};
  store.metadata = null;
  store.stream = null;
  store.pending.clear();
  store.idCount = 0;
}

function serializeHead(nodes: readonly Element[], markers: boolean): string {
  if (nodes.length === 0) {
    return "";
  }
  const parts = acquireParts();
  try {
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      if (node !== undefined) {
        pushNode(node as unknown as DomNode, parts, markers);
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
  /** Выполняет `fn` в async-контексте этого рендера (store виден во всех await). */
  run<T>(fn: () => T): T;
  serializeHead(): string;
  throwIfFailed(): void;
  dispose(): void;
}

/** Внутренние зависимости сессии (streaming-коллектор и т.п.). */
export interface RenderSessionInit {
  readonly stream?: ServerStreamCollector | null | undefined;
}

export function beginRenderSession(
  app: AnyComponent,
  options: RenderOptions = {},
  init: RenderSessionInit = {},
): RenderSession {
  const baseContainer = options.container ?? rootContainer;
  requestSeq += 1;
  const requestScope = baseContainer.createScope(`request:${requestSeq}`);

  const provider = hasRuntimeContextProvider() ? getRuntimeContextProvider() : null;
  const store =
    provider === null
      ? null
      : createRuntimeContextStore({ server: true });
  const run: <T>(fn: () => T) => T =
    provider === null || store === null
      ? (fn) => fn()
      : (fn) => provider.run(store, fn);

  let restore: () => void = noop;
  let disposeRoot: () => void = noop;
  let failure: unknown = null;
  let failed = false;
  let closed = false;
  const ownsStream = init.stream !== undefined;
  const headNodes: Element[] = [];

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
    result = run(() => {
      resetRuntimeOptions();
      resetIds();
      if (store !== null) {
        // resetRuntimeOptions очищает и store.options, поэтому опции рендера
        // назначаются уже внутри контекста store.
        store.options = runtimeOptions;
      }
      restore = installDomGlobals(SERVER_DOCUMENT, { keepShape: true });
      setServerMode(true);
      setServerBackend(SERVER_BACKEND);
      if (ownsStream) {
        setServerStreamCollector(init.stream ?? null);
      }
      setMetadataCollector((node) => {
        headNodes.push(node);
      });

      return createRoot((dispose) => {
        disposeRoot = dispose;
        return createComponent(app, options.props ?? {}, runtimeOptions);
      });
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
    run,
    serializeHead: () => {
      // В renderToString/renderToStream head сериализуется уже внутри run этого
      // же store; повторный storage.run — лишняя стоимость на горячем пути.
      const serialize = (): string =>
        serializeHead(headNodes, options.markers !== false);
      return getRuntimeContextStore() === store && store !== null
        ? serialize()
        : run(serialize);
    },
    throwIfFailed: () => {
      if (failed) {
        throw failure;
      }
    },
    dispose: () => cleanup(result),
  };

  return session;

  function cleanup(created: ComponentResult | null): void {
    if (closed) {
      return;
    }
    closed = true;

    run(() => {
      setMetadataCollector(null);
      if (ownsStream) {
        setServerStreamCollector(null);
      }
      setServerBackend(null);

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

      try {
        if (created !== null) {
          capture(() => created.dispose());
        }
        capture(disposeRoot);
        capture(() => requestScope.dispose());
      } finally {
        try {
          restore();
        } finally {
          try {
            setServerMode(false);
            resetRuntimeOptions();
          } finally {
            // Store закрывается последним: очистка ресурсов должна видеть
            // опции, metadata-коллектор и pending своего рендера.
            closeRuntimeStore(store);
          }
        }
      }

      if (disposalFailed) {
        throw disposalError;
      }
    });
  }
}
