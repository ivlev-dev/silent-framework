import {
  setRuntimeContextProvider,
  type RuntimeContextProvider,
  type RuntimeContextStore,
} from "@ivlev-dev/silent-core/runtime-context-provider";

const FALLBACK_WARNING =
  "[silent] SSR context: AsyncLocalStorage недоступен, используется последовательный fallback; параллельные рендеры в одном процессе не поддерживаются";

type RuntimeContextStatus = "als" | "fallback";

let status: RuntimeContextStatus = "fallback";
let initPromise: Promise<void> | null = null;
let fallbackWarned = false;

/**
 * Синхронное зеркало активного store. Внутри `run` (включая дерево компонентов
 * и cleanup) чтение контекста идёт из модульной переменной: это самая горячая
 * точка core (isServerMode, getRuntimeOptions, коллекторы, id, pending).
 * Зеркало живёт ровно на время синхронного вызова `fn`; после `await` оно уже
 * снято, и чтение уходит в AsyncLocalStorage. Поэтому поздние async-callback'и
 * видят свой store через ALS (или null, если store закрыт), а не чужой текущий.
 */
let syncStore: RuntimeContextStore | null = null;

async function initialize(): Promise<void> {
  try {
    const { AsyncLocalStorage } = await import("node:async_hooks");
    const storage = new AsyncLocalStorage<RuntimeContextStore>();
    const provider: RuntimeContextProvider = {
      name: "async-local-storage",
      getStore: () => syncStore ?? storage.getStore() ?? null,
      run: (store, fn) => {
        const previous = syncStore;
        syncStore = store;
        try {
          return storage.run(store, fn);
        } finally {
          syncStore = previous;
        }
      },
    };
    setRuntimeContextProvider(provider);
    status = "als";
  } catch {
    status = "fallback";
    if (!fallbackWarned) {
      fallbackWarned = true;
      console.warn(FALLBACK_WARNING);
    }
  }
}

/**
 * Готовит провайдер async-контекста для SSR. Инициализация выполняется один
 * раз на процесс: повторные вызовы переиспользуют тот же промис и тот же ALS.
 * В окружениях без `node:async_hooks` провайдер не регистрируется, и рендер
 * идёт по прежнему последовательному legacy-пути.
 */
export function ensureRuntimeContext(): Promise<void> {
  if (initPromise === null) {
    initPromise = initialize();
  }
  return initPromise;
}

/** Состояние провайдера: "als" либо последовательный fallback. @internal */
export function getRuntimeContextStatus(): RuntimeContextStatus {
  return status;
}

/** Снимает провайдер и сбрасывает memoize инициализации. Только для тестов. @internal */
export function resetRuntimeContextForTests(): void {
  setRuntimeContextProvider(null);
  syncStore = null;
  status = "fallback";
  initPromise = null;
  fallbackWarned = false;
}
