# SSR + worker pool

Пример progressive SSR через `createRenderPool` из
`@ivlev-dev/silent-server/pool`: unary `pool.render()` и потоковый
`pool.renderStream()`.

## Запуск

```bash
# из корня репозитория
pnpm install
pnpm build

# dev: Vite в middleware-режиме, рендер в main-потоке
pnpm --filter @ivlev-dev/silent-example-ssr-pool dev

# production: собранный server-entry и worker pool
pnpm --filter @ivlev-dev/silent-example-ssr-pool build
pnpm --filter @ivlev-dev/silent-example-ssr-pool start
```

Опции окружения:

- `PORT` — порт, по умолчанию `5176`; `PORT=0` выбирает свободный порт и
  печатает фактический URL.
- `WEB_CONCURRENCY` — число воркеров в production, по умолчанию `2`.
- `NODE_ENV=production` — включает пул и отдачу статики из `dist/client`.

Маршруты:

- `/` — unary-рендер (`pool.render` в production, `renderToString` в dev).
- `/stream` — progressive-рендер (`pool.renderStream` в production,
  `renderToStream` в main-потоке в dev).
- `/__stats` — `pool.stats()` плюс счётчики `headUpdates` и `activeStreams`.

Параметры запроса: `title`, `delay` (мс), `late=1` (панель меняет head),
`fail=1` (ошибка после shell), `req` (метка для проверки изоляции стримов).

## Чем production отличается от dev

- **production.** `server.mjs` загружает `dist/server/entry-server.js` и
  создаёт `createRenderPool(...)`. Каждый рендер уходит в worker thread;
  несколько стримов могут выполняться параллельно без общего DOM-состояния.
- **dev.** `vite.ssrLoadModule` доступен только в main-потоке, поэтому пул
  не используется: `renderToString`/`renderToStream` вызываются напрямую.
  Это удобно для HMR, но не даёт изоляции и параллелизма воркеров.

## Ограничения

- Нет сквозного backpressure до рендера: воркер не знает, что клиент читает
  медленно. Буфер ограничен `highWaterMark`/`maxBufferedChars` пула, а HTTP-
  ответ дополнительно ждёт `drain`, но сама генерация патчей не
  приостанавливается.
- `late`-head приходит через `onHead(..., { final: true })` уже после того,
  как отправлены HTTP-заголовки. Его нельзя положить в `<head>` ответа;
  сервер учитывает обновление в `headUpdates`, а клиент должен применить
  финальный head сам (в примере это делает только серверная статистика).
- `fail=1` моделирует ошибку после shell: соединение обрывается
  (`res.destroy`), а не отдаёт обрезанный успешный ответ.

## E2E

```bash
pnpm --filter @ivlev-dev/silent-example-ssr-pool build
pnpm test:ssr-pool
```
