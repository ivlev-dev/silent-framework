import { Head, lazy, Suspense } from "@ivlev-dev/silent-core";
import type { AppVM, RenderArgs } from "./app.vm";
import { Counter } from "./counter";
import { PanelFallback, SlowPanel } from "./slow-panel";

/**
 * Синхронная оболочка: Head срабатывает до асинхронного резолва AppVM,
 * поэтому title попадает уже в shell-head, а не только в final.
 */
export function Page(props: RenderArgs) {
  Head({ title: props.title });
  return (
    <App
      title={props.title}
      delayMs={props.delayMs}
      late={props.late}
      fail={props.fail}
      req={props.req}
    />
  );
}

export function App(this: { vm: AppVM }, props: RenderArgs) {
  const title = props.title;
  const req = props.req ?? "main";
  const delayMs = Math.max(0, props.delayMs ?? 0);
  const late = props.late === true;
  const fail = props.fail === true;

  // Head вызывается напрямую: shell-head сериализуется до того, как
  // insert-холы успевают выполнить JSX-регистрацию метаданных.
  Head({ title });

  // lazy создаётся на рендер: задержка и ошибка приходят из аргументов
  // запроса, поэтому общий модульный loader здесь не подходит.
  const Panel = lazy<{ req: string; title: string; late: boolean }>(
    async () => {
      if (delayMs > 0) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, delayMs);
        });
      }
      if (fail) {
        throw new Error(`ssr-pool: панель упала (req=${req})`);
      }
      return { default: SlowPanel };
    },
  );

  return (
    <main class="app">
      <header class="topbar">
        <h1>{title}</h1>
        <p class="shell-req" data-req={req}>
          req="{req}"
        </p>
      </header>
      <p class="caption">
        Shell отдаётся сразу, панель приходит патчем после задержки.
      </p>
      <Counter />
      <button type="button" class="clicks" onClick={() => this.vm.increment()}>
        Клики: {this.vm.clicks}
      </button>
      <Suspense fallback={<PanelFallback req={req} />}>
        <Panel req={req} title={title} late={late} />
      </Suspense>
    </main>
  );
}
