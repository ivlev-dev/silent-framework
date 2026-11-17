import { createMemoryHistory, type RouterHistory } from "./history.js";
import { Router, type RouterOptions } from "./router.js";

export interface TestRouterOptions extends Omit<RouterOptions, "history"> {
  readonly initial?: string;
  readonly history?: RouterHistory;
}

export function createTestRouter(options: TestRouterOptions): Router {
  const { initial = "/", history, ...rest } = options;
  return new Router({
    ...rest,
    history: history ?? createMemoryHistory(initial),
  });
}
