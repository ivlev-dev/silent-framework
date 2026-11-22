# Worker pool для SSR

`renderToString` и `renderToStream` сериализуют рендеры внутри процесса: DOM-шимы (`document`, `Node`, `Element`, `Text`, `Comment`, `HTMLTemplateElement` и другие) общие, поэтому одновременно выполняется один рендер на экземпляр модуля. Subpath `@ivlev-dev/silent-server/pool` добавляет opt-in worker pool: несколько `worker_threads`, в каждом свой экземпляр модулей и свои DOM-шимы, поэтому рендеры действительно идут параллельно.

Гайд описывает контракт entry-модуля, API пула, стриминг, ошибки, деплой и ограничения. Материал актуален для версии 0.12.0. Рабочий пример — [`examples/ssr-pool`](../../examples/ssr-pool).

## Зачем нужен пул

- **Параллелизм при глобальных DOM-шимах.** Воркеры — отдельные потоки со своими модульными экземплярами, поэтому два рендера не делят `document` и планировщик реактивности.
- **Изоляция падений.** Упавший воркер не роняет процесс: пул завершает текущую задачу ошибкой `worker-exited` и поднимает новый воркер (до лимита рестартов). Исключение — boot-падение, после которого не осталось ни одного готового воркера: пул сразу становится `failed` (`entry-load-failed`).
- **Ограничение очереди и таймауты.** Пул держит очередь, умеет отклонять перегрузку (`queue-full`), ограничивать время задачи и стрима, а также принудительно завершать зависшие воркеры.

Пул не нужен, если:

- трафик небольшой и рендер занимает единицы миллисекунд — накладные расходы на IPC и память воркеров не окупятся;
- вы уже масштабируетесь процессами Node, `cluster` или репликами и ядра заняты;
- рендеры быстрые и последовательная очередь не является узким местом;
- нужен максимально простой деплой без дополнительных файлов воркера.

Пул не заменяет основной путь: `renderToString`/`renderToStream` из `@ivlev-dev/silent-server` продолжают работать как раньше.

## Требования

1. **Собранный server-entry.** Воркер делает `import(entryUrl)`, поэтому entry — это готовый JavaScript-файл, а не dev-модуль. `vite.ssrLoadModule` и загрузка `.tsx`/`.ts` напрямую не поддерживаются: соберите серверный модуль через `vite build --ssr` (см. [«Сборка сервера»](./ssr.md#сборка-сервера)).
2. **Рантайм остаётся внешним.** В `ssr.external` должны быть `@ivlev-dev/silent-core`, `@ivlev-dev/silent-di`, `@ivlev-dev/silent-reactivity` и `@ivlev-dev/silent-server`: иначе Vite встроит в entry вторую копию рантайма, и приложение и `renderToString` внутри воркера получат разные экземпляры модулей (разные `whenIdle`/`setServerMode`).
3. **Node.js 22+ и ESM.** Пакет и пул используют `worker_threads` и `ReadableStream`.
4. **Entry адресуется путём или `file:` URL.** Абсолютный/относительный путь (относительный разрешается от `process.cwd()`) или `file:` URL. Bare specifier (`"my-app/entry"`), `data:` и `http(s)` URL отклоняются с `entry-load-failed`: получите URL через `import.meta.resolve("my-app/entry")` или соберите путь от `import.meta.url`.
5. **Subpath `/pool` не бандлится.** Путь к воркеру вычисляется от `import.meta.url` (`new Worker(new URL("./worker-main.js", import.meta.url))`), поэтому `@ivlev-dev/silent-server/pool` должен загружаться из `node_modules` как есть. Не включайте его в бандл сервера и не инлайните в один файл.

## Контракт entry-модуля

Entry — обычный ESM-модуль, который экспортирует `render`, `renderStream` или оба. Никаких обёрток и регистрации не нужно.

### `render`: unary-рендер

```ts
import type { RenderResult } from "@ivlev-dev/silent-server";

export function render(
  ...args: readonly unknown[]
): RenderResult | Promise<RenderResult>;
```

`render` получает ровно те аргументы, которые переданы в `pool.render([...])`, и возвращает `{ html, head }`. Обычно entry вызывает `renderToString`:

```ts
import { renderToString } from "@ivlev-dev/silent-server";
import { App } from "./app";

export interface RenderProps {
  title: string;
}

export function render(props: RenderProps): Promise<{ html: string; head: string }> {
  return renderToString(App, { props });
}
```

Для entry, которому нужен URL, tuple-аргументы выглядят так:

```ts
export async function render(
  url: string,
  title = "Silent Router",
): Promise<{ html: string; head: string }> {
  const { container, router } = createAppServices({
    history: createMemoryHistory(url),
  });
  try {
    await router.start();
    return await renderToString(App, { container, props: { title } });
  } finally {
    router.dispose();
    container.dispose();
  }
}

// Вызов:
await pool.render(["/profile/42", "Профиль"]);
```

Тип аргументов задаётся generic-параметром пула: `createRenderPool<[string, string]>(...)`. Аргументы клонируются через structured clone, поэтому функции, классы, DOM-узлы, циклические ссылки и `Map`/`Set` с несериализуемыми значениями передать нельзя — пул вернёт `args-not-cloneable` до запуска воркера. Тот же код возвращается при превышении бюджета: 8 × 1024 × 1024 условных единиц (длины строк/ключей, байты `ArrayBuffer`/TypedArray, фиксированные единицы на примитивы) или глубины 64.

### `renderStream`: стриминг

```ts
export function renderStream(
  ...args: [...Args, RenderStreamHandlers]
): ReadableStream<string> | Promise<ReadableStream<string>>;
```

Обработчики всегда идут **последним аргументом**:

```ts
import {
  renderToStream,
  type RenderStreamHandlers,
} from "@ivlev-dev/silent-server";
import { App } from "./app";

export interface RenderProps {
  title: string;
}

export function renderStream(
  props: RenderProps,
  handlers: RenderStreamHandlers,
): ReadableStream<string> {
  return renderToStream(App, {
    props,
    signal: handlers.signal,
    onHead: handlers.onHead,
    onShell: handlers.onShell,
  });
}

// Вызов:
const handle = pool.renderStream([{ title: "Silent" }]);
```

`RenderStreamHandlers`:

| Поле | Назначение |
| --- | --- |
| `signal` | `AbortSignal`, который отменяется при `cancel()`, таймауте, `stream-overflow` и `pool.close()`. Передайте его в `renderToStream`/`renderToString`, чтобы рендер освободил ресурсы. |
| `onHead(head, info)` | Обязательный обработчик. `head` — HTML метаданных, `info.final` — признак финального значения после асинхронных границ. |
| `onShell?(html)` | Синхронный shell до асинхронных патчей. Пул получает только его размер (см. `onShell` в опциях стрима). |

Entry обязан хотя бы один раз вызвать `onHead`: без него задание завершается ошибкой `stream-head-missing`. `renderStream` должен вернуть `ReadableStream<string>` (или async-iterable); иначе — `stream-contract`.

### Общие правила

- Entry загружается внутри воркера. Его модульные синглтоны, кэши и глобальные переменные живут в конкретном воркере, а не в процессе.
- `process.env` воркера фиксируется при спавне (см. опцию `env`).
- Внутри активного рендера нельзя вызывать `renderToString`/`renderToStream` повторно — ни напрямую, ни отложенно. Такой вызов отклоняется ошибкой с `name === "RenderReentrancyError"` (класс не экспортируется, проверяйте `name`).
- Не пытайтесь создать или использовать пул внутри entry: воркер выполняет одну задачу за раз, а вложенный пул только добавит потоки и память.

## Создание пула

```ts
import { availableParallelism } from "node:os";
import { createRenderPool } from "@ivlev-dev/silent-server/pool";

const pool = createRenderPool<[string, string]>(
  new URL("./dist/server/entry-server.js", import.meta.url),
  {
    workers: Math.max(1, Math.min(4, availableParallelism() - 1)),
    warmup: "eager",
    timeoutMs: 10_000,
    idleTimeoutMs: 10_000,
    maxQueue: 512,
    name: "web-ssr",
    onEvent: (event) => metrics.record(event),
    onError: (error, info) => logger.error({ error, ...info }),
  },
);

await pool.ready();
```

`createRenderPool(entry, options?)` сразу возвращает `RenderPool`; воркеры при `warmup: "lazy"` поднимаются при первой задаче. `pool.ready()` поднимает всех воркеров и ждёт загрузки entry независимо от `warmup`.

### Опции

| Опция | По умолчанию | Назначение |
| --- | --- | --- |
| `workers` | `min(4, availableParallelism())` | Число воркеров, целое `>= 1`. |
| `warmup` | `"lazy"` | `"eager"` вызывает `ready()` в конструкторе и не ждёт его; ошибки уходят в `state: "failed"`. |
| `timeoutMs` | `30_000` | Два независимых бюджета одной длительности: предел ожидания задачи в очереди и предел выполнения (unary-задачи или всего стрима). `0` отключает оба. |
| `idleTimeoutMs` | `timeoutMs` | Таймаут простоя стрима: взводится заново на `head`, `shell`, каждом чанке, каждом чтении consumer'а (`pull`) и при `resume`; тикает и во время `pause`. `0` отключает только его. |
| `terminateGraceMs` | `500` | Сколько ждать после `cancel`/retire, прежде чем вызвать `worker.terminate()`. |
| `maxQueue` | `workers * 64` | Максимум ожидающих задач, когда все воркеры заняты; сверх лимита — `queue-full`. |
| `maxTasksPerWorker` | `0` | `0` — без ограничения; `> 0` — воркер штатно заменяется после N задач. |
| `name` | `"silent-ssr-pool"` | Имя для событий, отладки и сообщений. |
| `env` | наследуется от процесса | Переменные окружения, передаваемые в `Worker`; фиксируются при спавне. |
| `execArgv` | наследуется | Флаги Node для воркера. |
| `resourceLimits` | — | Лимиты `worker_threads` (heap, stack и т. п.). |
| `onEvent` | — | Колбэк событий пула (`worker:spawn`, `worker:ready`, `worker:exit`, `job:queued`, `job:start`, `job:finish`, `job:timeout`, `job:abort`, `worker:restart`, `pool:closed`, `pool:failed`). Исключение в колбэке не ломает пул. |
| `onError` | — | Колбэк ошибок инфраструктуры; `info.source` — `"worker"`, `"event"` или `"callback"`. |

Некорректные значения отклоняются `TypeError` при создании пула. Включить отладочный вывод можно переменной `SILENT_POOL_DEBUG=1` или `globalThis.__SILENT_POOL_DEBUG__ = true`.

## `render`

```ts
const { html, head } = await pool.render([url, title], {
  signal: request.signal,
  timeoutMs: 5_000,
});
```

- `args` — tuple аргументов entry; generic пула задаёт их тип.
- `options.signal` — отмена до старта убирает задачу из очереди, отмена во время выполнения завершает воркер.
- `options.timeoutMs` переопределяет `timeoutMs` пула: ожидание в очереди и выполнение ограничены отдельно, `0` отключает оба. Истечение в очереди снимает задачу без завершения воркера, при выполнении — вместе с воркером (см. [«Таймауты»](#таймауты)).
- Успех — только `{ html, head }` от entry. Ошибки entry сохраняют `name`, `message`, `stack`, `code` и `cause` (до трёх уровней вложенности), поэтому `RenderReentrancyError`, `ValidationError` и другие ошибки можно различать по `name`/`code`, но не по `instanceof`.
- Инфраструктурные ошибки — экземпляры `PoolError`: `error instanceof PoolError`, поле `code` (список ниже), `name` по умолчанию `"PoolError"`. Класс и тип `PoolErrorCode` экспортируются из subpath.
- Если пул закрыт, `render` возвращает уже отклонённый промис с `pool-closed`.

Одна задача занимает один воркер целиком: параллелизм равен числу воркеров, а `queueDepth` показывает ожидание.

## Стриминг

```ts
const handle = pool.renderStream([{ title: "Silent" }], {
  timeoutMs: 30_000,
  idleTimeoutMs: 5_000,
  highWaterMark: 64 * 1024,
  maxBufferedChars: 4_000_000,
  onHead(head, info) {
    if (!info.final) {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.write(head);
    } else {
      logFinalHead(head);
    }
  },
  onShell(info) {
    metrics.observe("ssr_shell_bytes", info.bytes);
  },
});
```

`StreamHandle`:

| Поле | Назначение |
| --- | --- |
| `stream` | `ReadableStream<string>` с телом документа. |
| `head` | Промис первого head (обычно shell-head). Нужен, чтобы отдать заголовки до тела. |
| `finalHead` | Промис последнего head; при успешном `end` совпадает с первым, если финального head не было. Если head не приходил, отклоняется `stream-head-missing`. |
| `done` | Промис `StreamSummary`: `head`, `finalHead`, `chunks`, `chars`, `durationMs`, `workerId`. |
| `cancel(reason?)` | Отменяет стрим: воркер получает `cancel`, `done`/`head`/`finalHead` отклоняются `AbortError` (`code: "aborted"`). |

Порядок:

1. `renderStream` возвращает handle сразу; задача встаёт в очередь.
2. Воркер вызывает entry, тот — `onHead` (shell-head) и `onShell`.
3. Чанки тела идут через отдельный `MessageChannel` этого задания, а не через общий `parentPort`.
4. Entry может вызвать `onHead` ещё раз с `info.final === true`, если асинхронные границы добавили метаданные.
5. `end` — единственный успешный финал: резолвит `finalHead` и `done`. Закрытие порта или выход воркера без `end` дают `worker-exited`.

### Таймауты

- `timeoutMs` — два раздельных бюджета одной длительности, а не единый общий. Таймер очереди взводится при постановке задачи; если она ещё не стартовала, он снимает её из очереди и **не завершает воркер**. Таймер выполнения взводится в момент старта задания; его истечение завершает стрим с `TimeoutError` (`code: "timeout"`), а воркер выводится из работы и заменяется. Суммарно задача может провести в пуле до ~`2 × timeoutMs`. Это wall-clock от старта: чтения consumer'а общий бюджет не продлевают.
- `idleTimeoutMs` — предел простоя стрима: нет новых сообщений от воркера и нет чтений consumer'а. Таймер перезапускается на `head`, `shell`, каждом непустом чанке, при `resume` и на **каждом чтении consumer'а** (`pull`), даже если это чтение пока не приводит к `resume`. Он **тикает и во время `pause`** — пауза по backpressure его не снимает. Практика: медленный, но читающий клиент не таймаутится, потому что каждое вычитывание буфера продлевает окно. Если consumer перестал читать и буфер полон, `pull` больше не вызывается, и по `idleTimeoutMs` стрим завершается `TimeoutError`: воркер получает `cancel` и выводится из работы по правилам retire (с `terminateGraceMs`, без мгновенного `terminate`).
- `idleTimeoutMs` действует только после старта задания; ожидание в очереди покрывает таймер очереди из `timeoutMs`.
- `timeoutMs: 0` отключает общий предел и таймер очереди, `idleTimeoutMs: 0` — только таймер простоя. При `idleTimeoutMs: 0` стрим не обрывается из-за тишины вообще: читателя, который перестал читать, ограничивают общий `timeoutMs` (если он не `0`), `maxBufferedChars` и `cancel()`/`signal`.

### Head и shell-head

- Shell-head приходит до первого чанка тела — в этот момент можно установить HTTP-заголовки и записать `<head>`.
- **Финальный head нельзя применить после отправки `<head>` клиенту.** Если асинхронная часть добавила метаданные, `finalHead`/`onHead(..., { final: true })` годятся только для логов, трейлера или клиентского обновления head — но не для замены уже отправленных заголовков.
- `finalHead` — это последнее значение head, а не гарантия, что оно отличается от первого.

### Backpressure и буфер

Честного end-to-end backpressure в v1 нет: серверный `renderToStream` синхронно складывает чанки в свой `ReadableStream` и не умеет ждать читателя. Пул ограничивает только буфер на стороне main:

- `highWaterMark` (по умолчанию 64 × 1024 символов) — порог, после которого воркеру отправляется `pause`; при снижении ниже половины — `resume`.
- `maxBufferedChars` (по умолчанию 4 000 000 символов) — жёсткий лимит буфера пула. При превышении стрим отклоняется `stream-overflow`, воркер выводится из работы и заменяется.
- `highWaterMark`/`maxBufferedChars` не ограничивают внутреннюю очередь `renderToStream` в воркере. Для больших страниц ограничивайте размер ответа и число одновременных стримов, а также задавайте `maxBufferedChars` под свой лимит памяти.

Практические следствия:

- начинайте читать `stream` сразу: ожидание одного `head` не разгружает буфер тела, а переполнение даёт `stream-overflow`;
- не рассчитывайте, что брошенный читатель «повиснет»: если после заполнения буфера чтений нет, по `idleTimeoutMs` стрим завершится `TimeoutError` (`code: "timeout"`), а воркер будет выведен из работы;
- ошибка после отправки shell обрывает поток: соединение закрывается, fallback остаётся видимым;
- `reader.cancel()` и `handle.cancel()` равнозначны: оба отправляют `cancel` воркеру.

## Ошибки

Инфраструктурные сбои — это `PoolError` (экспортируется из subpath): `error instanceof PoolError` отделяет их от ошибок entry, а `code` уточняет причину. `name` у `PoolError` обычно `"PoolError"`, но у таймаута и отмены он равен `"TimeoutError"`/`"AbortError"`.

```ts
import { PoolError } from "@ivlev-dev/silent-server/pool";

try {
  const { html } = await pool.render([url]);
  response.end(html);
} catch (error) {
  if (error instanceof PoolError) {
    // Инфраструктура пула: перегрузка, закрытие, таймаут, отмена, протокол.
    response.writeHead(error.code === "queue-full" ? 503 : 500).end();
    return;
  }
  // Ошибка entry: объект из другого потока, instanceof исходного класса не работает.
  if (error instanceof Error && error.name === "RenderReentrancyError") {
    response.writeHead(500).end();
    return;
  }
  throw error;
}
```

| `code` | Когда возникает |
| --- | --- |
| `pool-closed` | `render`/`renderStream` после `close()`; задачи из очереди при закрытии. |
| `queue-full` | Очередь достигла `maxQueue`, свободных воркеров нет. |
| `args-not-cloneable` | Аргументы не проходят structured clone (`DataCloneError`) или превышают бюджет 8 × 1024 × 1024 единиц / глубину 64. |
| `entry-load-failed` | Entry не загрузился, не осталось готовых воркеров после boot-падения, URL некорректен, передан `data:`/`http(s)` URL или bare specifier. |
| `worker-start-failed` | Не удалось создать воркер; пул остановлен после более чем 5 падений за 30 с. |
| `protocol-mismatch` | Несовместимый протокол воркера или некорректная форма результата `render`. |
| `render-unsupported` | Entry не экспортирует `render`. |
| `stream-unsupported` | Entry не экспортирует `renderStream`. |
| `stream-contract` | Неверные `highWaterMark`/`maxBufferedChars`; `renderStream` вернул не поток. |
| `stream-head-missing` | `renderStream` завершился, не вызвав `onHead`. |
| `stream-overflow` | Буфер пула превысил `maxBufferedChars`. |
| `worker-exited` | Воркер завершился или закрыл порт до `end`; unary-воркер умер во время задачи. |
| `busy` | Воркер получил вторую задачу, хотя ещё занят (защита протокола). |
| `timeout` | Истёк `timeoutMs`/`idleTimeoutMs`; `name === "TimeoutError"`. |
| `aborted` | Отмена через `signal`, `cancel()` или `reader.cancel()`; `name === "AbortError"`. |

Ошибки самого entry не заворачиваются в `PoolError`: пул восстанавливает исходные `name`, `message`, `stack`, `code`, `cause` в обычном `Error`. Поэтому проверяйте `error.name === "RenderReentrancyError"` (или свой `code`), а не `instanceof`: объект приходит из другого потока. `instanceof PoolError` надёжен только для инфраструктурных сбоев — пул создаёт их у себя и сам же отклоняет промис или handle.

Некорректное сообщение воркера (несовместимая версия протокола, битая wire-ошибка) переводит пул в `state: "failed"` с `code: "protocol-mismatch"`: очередь отклоняется, воркеры завершаются, но сам процесс не падает.

## Деплой

### Воркеры и память

- По умолчанию `workers = min(4, availableParallelism())`. Если рядом работают другие процессы/реплики, делите ядра: суммарное число воркеров не должно сильно превышать число доступных ядер.
- Ориентир по памяти — порядка 20 МБ на воркер сверх основного процесса; фактическое потребление зависит от приложения, DI-графов и размера страниц. `resourceLimits` помогает поймать утечки, но не заменяет профилирование.
- `maxTasksPerWorker` (`> 0`) периодически заменяет воркер. Это ограничивает накопление состояния, но добавляет холодные старты и потерю прогретых кэшей.

### Warmup

```ts
const pool = createRenderPool(entry, { warmup: "eager" });
await pool.ready();
server.listen(3000);
```

`warmup: "eager"` не ждёт загрузки entry: если ни один воркер не поднялся, `state` станет `"failed"`; при частичном успехе пул работает на живых воркерах, а упавший boot-воркер рестартует. Для старта без «холодного» первого запроса используйте `eager` + `await pool.ready()` (или `lazy` + `ready()`).

Если воркер падает до `ready` и после этого не остаётся ни одного готового воркера, пул сразу переходит в `failed` с `entry-load-failed`: это не рестарт, а ошибка конфигурации entry. Если пул уже обслуживает запросы, упавший boot-воркер рестартует по общим правилам; падения после `ready` тоже рестартуют воркер, пока падений не станет больше 5 за 30 с, после чего пул становится `failed` (`worker-start-failed`).

### Перегрузка и 503

```ts
try {
  const { html, head } = await pool.render([url, title]);
  // ...
} catch (error) {
  if (error && typeof error === "object" && "code" in error) {
    if (error.code === "queue-full") {
      response.statusCode = 503;
      response.setHeader("retry-after", "1");
      response.end("Service Unavailable");
      return;
    }
    if (error.code === "timeout") {
      response.statusCode = 504;
      response.end("Gateway Timeout");
      return;
    }
  }
  throw error;
}
```

`pool.stats()` отдаёт `queueDepth`, `completed`, `failed`, `timedOut`, `aborted`, `rejectedOverflow`, `restarts`, `deaths`, `staleMessages` и состояние воркеров — удобно для `/__stats` и метрик.

`timedOut` и `aborted` идут вместе с `failed` (любой неуспешный финал), кроме одной комбинации: отмена по `signal`, пока задача ещё в очереди. Такая задача снимается из очереди, получает `job:abort` и `job:finish` с `ok: false`, увеличивает только `aborted` — `failed` не растёт. Таймаут в очереди, наоборот, учитывается как `timedOut` + `failed`. Простой по `idleTimeoutMs` — тоже `timedOut` + `failed`; поле `timeoutMs` в событии `job:timeout` содержит фактически сработавший лимит: `idleTimeoutMs` для простоя и `timeoutMs` для общего бюджета или очереди.

### SIGTERM и закрытие

```js
const shutdown = async () => {
  server.close();
  try {
    await pool.close({ timeoutMs: 5_000 });
  } finally {
    process.exit(0);
  }
};

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
```

- `close()` отменяет активные стримы (`AbortError`, `code: "pool-closed"`), отклоняет задачи из очереди и ждёт завершения unary-задач; по истечении `timeoutMs` (по умолчанию — `timeoutMs` пула) воркеры принудительно завершаются. `timeoutMs: 0` означает «не ждать» и завершает воркеры сразу.
- `close({ force: true })` не ждёт: активные unary-задачи отклоняются, воркеры завершаются немедленно.
- `close()` идемпотентен; новый `render` после закрытия получает `pool-closed`.
- `await using pool = createRenderPool(...)` вызовет `[Symbol.asyncDispose]`, то есть тот же `close()`.

Активные стримы при `close()` не дожидаются конца: если нужен graceful drain стриминговых ответов, отслеживайте их самостоятельно и закрывайте пул после завершения.

## Ограничения

- **Собранный entry.** Dev-режим, `vite.ssrLoadModule`, `.ts`/`.tsx` и bare specifier не поддерживаются.
- **Singletons — per-worker.** DI-контейнер, `singleton`-привязки, модульные кэши и счётчики существуют в каждом воркере отдельно. Общее состояние (сессии, кэши, rate limit) выносите во внешний store; не рассчитывайте, что singleton в main и воркере — один объект.
- **`process.env` фиксируется при спавне.** Изменения в основном процессе после старта воркера не видны; передавайте актуальное окружение через `env` при создании пула.
- **`terminate()` не выполняет `finally`.** При таймауте, отмене и `close({ force: true })` воркер может быть убит без завершения `try/finally`; не полагайтесь на очистку в `finally` для критичных ресурсов.
- **Один job на воркер.** Долгий рендер занимает воркер целиком; число одновременных задач ограничено `workers`.
- **Вложенный рендер запрещён.** Повторный `renderToString`/`renderToStream` внутри активного рендера даёт `RenderReentrancyError`.
- **Нет честного backpressure.** См. раздел выше: буфер пула ограничен, внутренняя очередь `renderToStream` — нет. Пока читатель вычитывает буфер, `idleTimeoutMs` продлевается на каждом `pull`, даже если воркер стоит в `pause`; если читатель перестал читать и буфер полон, стрим завершается по `idleTimeoutMs`. При `idleTimeoutMs: 0` таймаут простоя отключён, и читателя ограничивают только общий `timeoutMs`, `maxBufferedChars` и `cancel()`.
- **Финальный head после заголовков не применить.** Используйте shell-head; `finalHead` — для логов/трейлера/клиента.
- **Аргументы клонируются и ограничены.** Функции, классы, DOM-узлы и нестандартные объекты не передаются; бюджет — 8 × 1024 × 1024 условных единиц и глубина 64, превышение даёт `args-not-cloneable`. Ошибки из воркера приходят как обычные `Error` с сохранёнными полями, но без `instanceof` исходного класса.
- **Subpath `/pool` не бандлится.** Воркер ищется относительно `import.meta.url`.
- **Память и файловые дескрипторы.** Каждый воркер — отдельный поток со своим heap; `MessageChannel` на каждый стрим закрывается пулом, но принудительно убитый воркер может не успеть освободить внешние ресурсы.
