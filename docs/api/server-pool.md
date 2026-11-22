# `@ivlev-dev/silent-server/pool`

Subpath `@ivlev-dev/silent-server/pool` — opt-in worker pool для параллельного SSR. Пакет `@ivlev-dev/silent-server` продолжает экспортировать `renderToString` и `renderToStream` из основного entry; пул живёт отдельно и не меняет их поведение. Гайд — [«Worker pool для SSR»](../guides/ssr-pool.md).

```ts
import { createRenderPool } from "@ivlev-dev/silent-server/pool";
```

Пул загружает entry-модуль в каждый `worker_threads`-воркер. Entry должен быть собранным ESM-файлом и экспортировать `render` и/или `renderStream`; dev-загрузка через `vite.ssrLoadModule` не поддерживается. Воркеры получают собственные DOM-шимы и собственный экземпляр модулей, поэтому рендеры в разных воркерах выполняются параллельно. `data:` URL запрещён (`entry-load-failed`): воркер загружает entry обычным `import()` и должен иметь файловый URL.

## API

### `createRenderPool`

*Стабильность: public.*

```ts
function createRenderPool<Args extends readonly unknown[] = readonly unknown[]>(
  entry: string | URL,
  options?: RenderPoolOptions,
): RenderPool<Args>;
```

Создаёт пул, но не запускает воркеры при `warmup: "lazy"` (по умолчанию). `entry` — абсолютный или относительный путь (от `process.cwd()`), `file:` URL либо URL, полученный из `import.meta.resolve`. Bare specifier, `data:` и `http(s)` URL отклоняются с `entry-load-failed`. Некорректные опции дают `TypeError`.

```ts
import { createRenderPool } from "@ivlev-dev/silent-server/pool";

const pool = createRenderPool<[string]>(
  new URL("./dist/server/entry-server.js", import.meta.url),
  { workers: 2, timeoutMs: 10_000 },
);

const { html, head } = await pool.render(["/"]);
await pool.close();
```

### `RenderPoolOptions`

*Стабильность: public.*

```ts
interface RenderPoolOptions {
  readonly workers?: number | undefined;
  readonly warmup?: "lazy" | "eager" | undefined;
  readonly timeoutMs?: number | undefined;
  readonly idleTimeoutMs?: number | undefined;
  readonly terminateGraceMs?: number | undefined;
  readonly maxQueue?: number | undefined;
  readonly maxTasksPerWorker?: number | undefined;
  readonly name?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly execArgv?: readonly string[] | undefined;
  readonly resourceLimits?: ResourceLimits | undefined;
  readonly onEvent?: ((event: PoolEvent) => void) | undefined;
  readonly onError?: ((error: unknown, info: PoolErrorInfo) => void) | undefined;
}
```

- `workers` — число воркеров, целое `>= 1`; по умолчанию `min(4, availableParallelism())`.
- `warmup` — `"lazy"` (по умолчанию) или `"eager"`. При `"eager"` конструктор вызывает `ready()` без ожидания; если ни один воркер не поднялся, пул перейдёт в `state: "failed"`, иначе продолжит работу на живых воркерах.
- `timeoutMs` — два независимых бюджета одной длительности: предел ожидания в очереди и отдельно предел выполнения unary-задачи или всего стрима; по умолчанию `30_000`. `0` отключает оба. Истечение в очереди снимает задачу, не завершая воркер; истечение при выполнении завершает задачу с `timeout`, воркер выводится из работы.
- `idleTimeoutMs` — таймаут простоя стрима; по умолчанию равен `timeoutMs`. Продлевается на `head`/`shell`/каждый чанк, на каждое чтение consumer'а и на `resume`; тикает и во время `pause`. `0` отключает только таймаут простоя.
- `terminateGraceMs` — пауза после `cancel`/retire перед `worker.terminate()`; по умолчанию `500`.
- `maxQueue` — максимум ожидающих задач, когда все воркеры заняты; по умолчанию `workers * 64`.
- `maxTasksPerWorker` — `0` (по умолчанию) не ограничивает; `> 0` штатно заменяет воркер после N задач.
- `name` — имя пула для событий и отладки; по умолчанию `"silent-ssr-pool"`.
- `env` — окружение воркера; `process.env` фиксируется при спавне.
- `execArgv` — флаги Node для воркера.
- `resourceLimits` — лимиты `worker_threads`.
- `onEvent` — синхронный колбэк событий пула; исключение не ломает пул и уходит в `onError` с `source: "event"`.
- `onError` — колбэк ошибок воркеров, событий и пользовательских колбэков; `info.source` равен `"worker"`, `"event"` или `"callback"`.

Все числовые опции валидируются: `workers`, `maxQueue` и `maxTasksPerWorker` должны быть целыми, остальные — конечными неотрицательными числами.

### `RenderPool`

*Стабильность: public.*

```ts
interface RenderPool<Args extends readonly unknown[] = readonly unknown[]> {
  readonly workers: number;
  readonly name: string;
  readonly state: PoolState;
  render(args: Args, options?: PoolRenderOptions): Promise<RenderResult>;
  renderStream(args: Args, options?: PoolStreamOptions): StreamHandle;
  ready(): Promise<void>;
  stats(): PoolStats;
  close(options?: { force?: boolean; timeoutMs?: number }): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}
```

- `workers` — настроенное число воркеров.
- `name` — имя пула.
- `state` — текущее состояние `PoolState`.
- **`render(args, options?)`** — ставит unary-задачу в очередь и возвращает `Promise<RenderResult>` (`{ html, head }`). `args` — tuple аргументов entry. До запуска проверяются structured clone и бюджет аргументов: не более 8 × 1024 × 1024 условных единиц (длина строк/ключей, байты `ArrayBuffer`/TypedArray, 8 на число, 4 на `null`, 16 на `Date`/`RegExp`) и глубина не больше 64. Превышение отклоняется `PoolError` с `code: "args-not-cloneable"`. Инфраструктурные сбои отклоняют промис `PoolError`, ошибки entry — обычный `Error` с сохранёнными `name`/`message`/`stack`/`code`/`cause`.
- **`renderStream(args, options?)`** — возвращает `StreamHandle` сразу. Ошибки (включая `queue-full` и уже отменённый `signal`) приходят через `head`/`finalHead`/`done` и поток, а не синхронным исключением.
- **`ready()`** — поднимает всех воркеров и ждёт загрузки entry. При `state: "failed"` или `"closed"` отклоняется соответствующей ошибкой. Если ни один воркер не завершил boot, отклоняется причина падения (или `worker-start-failed`).
- **`stats()`** — снимает текущую статистику.
- **`close(options?)`** — идемпотентно закрывает пул: задачи из очереди отклоняются с `pool-closed`, активные стримы отменяются (`AbortError`, `code: "pool-closed"`), unary-задачи доигрываются. По истечении `options.timeoutMs` (по умолчанию `timeoutMs` пула) воркеры завершаются принудительно; `timeoutMs: 0` означает «не ждать» и завершает их сразу. `force: true` также завершает воркеры сразу и отклоняет активные unary-задачи.
- **`[Symbol.asyncDispose]()`** — вызывает `close()`; позволяет использовать `await using`.

### `PoolRenderOptions`

*Стабильность: public.*

```ts
interface PoolRenderOptions {
  readonly signal?: AbortSignal | undefined;
  readonly timeoutMs?: number | undefined;
}
```

- `signal` — отмена задачи. До старта задача убирается из очереди, во время выполнения воркер завершается; промис отклоняется `AbortError` (`code: "aborted"`).
- `timeoutMs` — переопределяет `timeoutMs` пула для вызова, то есть оба бюджета (очередь и выполнение); `0` отключает их.

### `PoolStreamOptions`

*Стабильность: public.*

```ts
interface PoolStreamOptions extends PoolRenderOptions {
  readonly idleTimeoutMs?: number | undefined;
  readonly highWaterMark?: number | undefined;
  readonly maxBufferedChars?: number | undefined;
  readonly onHead?:
    | ((head: string, info: { readonly final: boolean }) => void)
    | undefined;
  readonly onShell?: ((info: { readonly bytes: number }) => void) | undefined;
}
```

- `signal`, `timeoutMs` — как в `PoolRenderOptions`: ожидание в очереди и выполнение ограничены отдельно, `timeoutMs` ограничивает весь стрим от старта.
- `idleTimeoutMs` — предел простоя: нет `head`/`shell`/чанков и нет чтений consumer'а. Сбрасывается на каждом таком сообщении, на каждом `pull` и на `resume`, поэтому медленный читающий клиент не таймаутится. Тикает и во время `pause`; если читатель перестал читать и буфер полон, стрим завершается `timeout`. По умолчанию — `idleTimeoutMs` пула, `0` отключает простой.
- `highWaterMark` — порог буфера main в символах, после которого воркеру отправляется `pause`; по умолчанию 64 × 1024. Должен быть конечным числом `>= 0`.
- `maxBufferedChars` — жёсткий лимит буфера main в символах; по умолчанию `4_000_000`. При превышении — `stream-overflow`. Должен быть конечным числом `>= 0`.
- `onHead(head, info)` — вызывается на каждый head; `info.final` — признак финального значения.
- `onShell(info)` — вызывается при получении shell; пул передаёт только размер в байтах (`info.bytes`), не HTML.

Честного end-to-end backpressure нет: `renderToStream` в воркере не умеет ждать читателя. `highWaterMark` и `maxBufferedChars` ограничивают только буфер пула; `maxBufferedChars` не ограничивает очередь внутри `renderToStream`. Пока читатель вычитывает буфер, `idleTimeoutMs` продлевается на каждом `pull` даже при `pause`; брошенный читатель с полным буфером снимается по `idleTimeoutMs`, а при `idleTimeoutMs: 0` — только по общему `timeoutMs`, `maxBufferedChars` или `cancel()`.

### `StreamHandle`

*Стабильность: public.*

```ts
interface StreamHandle {
  readonly stream: ReadableStream<string>;
  readonly head: Promise<string>;
  readonly finalHead: Promise<string>;
  readonly done: Promise<StreamSummary>;
  cancel(reason?: unknown): void;
}
```

- `stream` — тело документа.
- `head` — первый head (обычно shell-head). Отклоняется, если стрим завершился ошибкой до head или так и не вызвал `onHead`.
- `finalHead` — последний head; при успешном `end` совпадает с первым, если финального head не было. Если head не приходил, отклоняется `stream-head-missing`. Финальный head нельзя применить после отправки `<head>` клиенту.
- `done` — `StreamSummary` при успешном `end`; при ошибке/отмене отклоняется.
- `cancel(reason?)` — отправляет `cancel` воркеру; `done`/`head`/`finalHead` отклоняются `AbortError` (`code: "aborted"`). Читатель может сделать то же через `reader.cancel()`.

### `StreamSummary`

*Стабильность: public.*

```ts
interface StreamSummary {
  readonly head: string;
  readonly finalHead: string;
  readonly chunks: number;
  readonly chars: number;
  readonly durationMs: number;
  readonly workerId: number;
}
```

- `head` — первый head, `finalHead` — последний.
- `chunks` — число непустых чанков, полученных пулом.
- `chars` — суммарная длина чанков в символах.
- `durationMs` — время от старта задачи до `end`.
- `workerId` — воркер, выполнивший задачу.

### `PoolState`

*Стабильность: public.*

```ts
type PoolState = "idle" | "booting" | "ready" | "closing" | "closed" | "failed";
```

- `idle` — пул создан, воркеров ещё нет.
- `booting` — воркеры запускаются.
- `ready` — хотя бы один воркер загрузил entry. `ready()` ждёт завершения boot всех запущенных воркеров, но допускает частичный успех: если хотя бы один воркер готов, промис разрешается, а упавшие boot-воркеры рестартуют.
- `closing` — идёт `close()`.
- `closed` — пул закрыт; новые задачи получают `pool-closed`.
- `failed` — несовместимый протокол, ошибка загрузки entry, boot-падение, после которого не осталось готовых воркеров (сразу `entry-load-failed`, без рестарта), невозможность старта или слишком частые падения; новые задачи получают сохранённую ошибку. Если пул уже обслуживает запросы, упавший на boot дополнительный воркер рестартует по общим правилам.

### `PoolStats`

*Стабильность: public.*

```ts
interface PoolStats {
  readonly state: PoolState;
  readonly workers: PoolWorkersStats;
  readonly queueDepth: number;
  readonly completed: number;
  readonly failed: number;
  readonly timedOut: number;
  readonly aborted: number;
  readonly rejectedOverflow: number;
  readonly restarts: number;
  readonly deaths: number;
  readonly staleMessages: number;
}
```

- `state` — состояние пула.
- `workers` — счётчики воркеров.
- `queueDepth` — задач в очереди.
- `completed` — успешно завершённых задач (unary и stream).
- `failed` — задач, завершившихся ошибкой (включая таймауты и отмены при выполнении; отмена `signal` до старта увеличивает только `aborted`).
- `timedOut` — задач, завершённых по `timeoutMs` или `idleTimeoutMs`; простой по `idleTimeoutMs`, в том числе из-за остановки чтения, тоже считается здесь.
- `aborted` — задач, отменённых через `signal`/`cancel`.
- `rejectedOverflow` — вызовов, отклонённых с `queue-full`.
- `restarts` — перезапусков воркеров после падений.
- `deaths` — падений воркеров.
- `staleMessages` — сообщений, проигнорированных как устаревшие.

### `PoolWorkersStats`

*Стабильность: public.*

```ts
interface PoolWorkersStats {
  readonly total: number;
  readonly booting: number;
  readonly idle: number;
  readonly busy: number;
}
```

- `total` — текущее число воркеров (завершённые вычитаются).
- `booting` — загружают entry.
- `idle` — готовы и свободны.
- `busy` — выполняют задачу.

### `PoolEvent`

*Стабильность: public.*

```ts
type PoolEvent =
  | { readonly type: "worker:spawn"; readonly workerId: number }
  | {
      readonly type: "worker:ready";
      readonly workerId: number;
      readonly capabilities: EntryCapabilities;
    }
  | {
      readonly type: "worker:exit";
      readonly workerId: number;
      readonly code: number;
      readonly expected: boolean;
    }
  | {
      readonly type: "worker:restart";
      readonly workerId: number;
      readonly reason: string;
    }
  | { readonly type: "job:queued"; readonly jobId: number; readonly kind: "render" | "stream" }
  | {
      readonly type: "job:start";
      readonly jobId: number;
      readonly kind: "render" | "stream";
      readonly workerId: number;
    }
  | {
      readonly type: "job:finish";
      readonly jobId: number;
      readonly kind: "render" | "stream";
      readonly ok: boolean;
      readonly durationMs: number;
    }
  | {
      readonly type: "job:timeout";
      readonly jobId: number;
      readonly kind: "render" | "stream";
      readonly timeoutMs: number;
    }
  | {
      readonly type: "job:abort";
      readonly jobId: number;
      readonly kind: "render" | "stream";
      readonly reason?: string;
    }
  | { readonly type: "pool:closed" }
  | { readonly type: "pool:failed"; readonly error: unknown };
```

События приходят в `onEvent`: жизненный цикл воркеров (`worker:spawn`, `worker:ready`, `worker:exit`, `worker:restart`), задачи (`job:queued`, `job:start`, `job:finish`, `job:timeout`, `job:abort`) и состояние пула (`pool:closed`, `pool:failed`). `worker:ready` содержит `capabilities` с флагами `render` и `renderStream`; тип — публичный `EntryCapabilities`. В `job:timeout` поле `timeoutMs` — фактически сработавший лимит: `idleTimeoutMs` для простоя и `timeoutMs` для общего бюджета или ожидания в очереди.

### `PoolErrorInfo`

*Стабильность: public.*

```ts
interface PoolErrorInfo {
  readonly source: "worker" | "event" | "callback";
  readonly workerId?: number;
  readonly event?: PoolEvent;
}
```

- `source` — откуда пришла ошибка: воркер, обработчик `onEvent` или пользовательский колбэк.
- `workerId` — воркер, если ошибка связана с ним.
- `event` — событие, обработчик которого бросил исключение (`source: "event"`).

### `EntryCapabilities`

*Стабильность: public.*

```ts
interface EntryCapabilities {
  readonly render: boolean;
  readonly renderStream: boolean;
}
```

Возможности entry-модуля, которые воркер сообщает после загрузки; пул публикует их в событии `worker:ready` (`event.capabilities`). `render` — entry экспортирует `render`, `renderStream` — `renderStream`. По этим флагам можно заранее понять, какие вызовы пула для данного entry доступны.

### `PoolError`

*Стабильность: public.*

```ts
class PoolError extends Error {
  readonly code: PoolErrorCode;
  constructor(
    code: PoolErrorCode,
    message: string,
    options?: { readonly cause?: unknown; readonly name?: string },
  );
}
```

Класс инфраструктурных ошибок пула: очередь, таймауты, отмена, протокол, загрузка entry и закрытие пула. Наследуется от `Error`, поэтому работают и `instanceof Error`, и `instanceof PoolError`. `name` по умолчанию `"PoolError"`; у таймаута и отмены он переопределён на `"TimeoutError"`/`"AbortError"`, а у `entry-load-failed`/`protocol-mismatch` может остаться имя исходной ошибки. `code` — машиночитаемый `PoolErrorCode`, `cause` — исходная ошибка, если она была; `message` — человекочитаемое описание, его формат не является частью контракта.

`instanceof PoolError` — основной способ отличить сбой пула от ошибки entry:

```ts
import { PoolError } from "@ivlev-dev/silent-server/pool";

try {
  const { html } = await pool.render([url]);
  response.end(html);
} catch (error) {
  if (error instanceof PoolError) {
    // Сбой пула: перегрузка, закрытие, таймаут, отмена, протокол.
    response.writeHead(error.code === "queue-full" ? 503 : 500).end();
    return;
  }
  // Ошибка entry: это обычный Error, сравнивайте name/code.
  throw error;
}
```

Проверка работает и для «ленивых» сбоев: после `close()` `render` возвращает уже отклонённый промис с `pool-closed`, а `renderStream` — handle, чьи `head`/`done` отклоняются `PoolError` с тем же `code`; синхронного исключения нет.

### `PoolErrorCode`

*Стабильность: public.*

```ts
type PoolErrorCode =
  | "pool-closed"
  | "queue-full"
  | "args-not-cloneable"
  | "entry-load-failed"
  | "worker-start-failed"
  | "protocol-mismatch"
  | "render-unsupported"
  | "stream-unsupported"
  | "stream-contract"
  | "stream-head-missing"
  | "stream-overflow"
  | "worker-exited"
  | "busy"
  | "timeout"
  | "aborted";
```

Тип поля `PoolError.code`. Значения и условия их появления перечислены в разделе [«Коды ошибок»](#коды-ошибок).

## Коды ошибок

Инфраструктурные ошибки — экземпляры `PoolError`: у них всегда есть `code`, `name` обычно `"PoolError"`, но у таймаута и отмены — `"TimeoutError"`/`"AbortError"`. `instanceof PoolError` отличает сбой пула от ошибки entry, а `code` уточняет причину:

| `code` | `name` | Когда |
| --- | --- | --- |
| `pool-closed` | `PoolError` / `AbortError` | Вызов после `close()`; задачи из очереди при закрытии; активный стрим при `close()`. |
| `queue-full` | `PoolError` | Очередь достигла `maxQueue`. |
| `args-not-cloneable` | `PoolError` | Аргументы не проходят structured clone (`DataCloneError`) или превышают бюджет 8 × 1024 × 1024 единиц / глубину 64. |
| `entry-load-failed` | `PoolError` (или исходный `name`) | Entry не загрузился; не осталось готовых воркеров после boot-падения; некорректный URL, `data:`/`http(s)` URL или bare specifier. |
| `worker-start-failed` | `PoolError` | Не удалось создать воркер; пул остановлен после более чем 5 падений за 30 с. |
| `protocol-mismatch` | `PoolError` (или исходный `name`) | Несовместимый протокол; некорректный результат `render`. |
| `render-unsupported` | `PoolError` | Entry не экспортирует `render`. |
| `stream-unsupported` | `PoolError` | Entry не экспортирует `renderStream`. |
| `stream-contract` | `PoolError` | Неверные опции стрима; `renderStream` вернул не поток. |
| `stream-head-missing` | `PoolError` | Стрим завершился без `onHead`. |
| `stream-overflow` | `PoolError` | Буфер превысил `maxBufferedChars`. |
| `worker-exited` | `PoolError` | Воркер завершился/закрыл порт до `end`; воркер умер во время unary-задачи. |
| `busy` | `PoolError` | Воркер получил вторую задачу, пока занят. |
| `timeout` | `TimeoutError` | Истёк `timeoutMs` или `idleTimeoutMs`. |
| `aborted` | `AbortError` | Отмена через `signal`, `cancel()` или `reader.cancel()`. |

Ошибки entry не оборачиваются в `PoolError`: пул восстанавливает `name`, `message`, `stack`, `code` и `cause` (до трёх уровней) в обычном `Error`. Из-за передачи между потоками `instanceof` исходного класса не работает — используйте `name` или `code`.

## Связанные типы основного entry

Пул использует публичные типы контракта entry из `@ivlev-dev/silent-server` — `RenderEntry`, `RenderStreamEntry`, `RenderStreamHandlers` и `ServerEntryModule`. Их сигнатуры описаны в [справочнике API core.md](./core.md#ssr).
