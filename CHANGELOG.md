# Changelog

## Unreleased

### Списки

- Гидратация строк `For`/`Index` больше не создаёт по два замыкания на строку и не читает `props.children`/`props.index` на каждую строку: состояние строки хранится на узле, `disposeNode` использует общий обработчик. Поведение и разметка не меняются; стартовый JS +0.23 KB (gzip +0.08 KB).

### Бенчмарки

- `bench:browser` делает 3 чередующихся раунда silent/solid и берёт медиану отношений — меньше ложных выводов при внешней нагрузке CPU.

### Списки

- `For`/`Index` принимают `index: false`: per-row accessor индекса не создаётся. Компилятор включает флаг автоматически, если `children` не объявляет второй параметр.
- Гидрация в Chromium: 16 575 → **17 969 ops/s** (+8%), p50 0.045 мс. Size стартового чанка не изменился.

## 0.11.19

### SSR

- `renderToString` получил `markers: false`: удаляет `silent-*`-комментарии и `data-silent-*`-атрибуты из `html`/`head` для негидрируемого SSR. HTML 1 230 → 369 B (gzip 187 → 134 B), но рендер замедляется на ~20–25% из-за финальной очистки. Default-поведение и `renderToStream` не меняются.

### Производительность

- `extractMetadataNode` не обходит поддерево, если у элемента нет элементных детей: строки списка из текстовых узлов больше не платят за поиск `<title>/<meta>/<link>`. `keyed list: create 1000` ~146 → 150 ops/s, `index list` ~127 → 130.
- `For` и `Index` получили low-level режим `parent`/`marker`: строки вставляются прямо в контейнер без промежуточного fragment. `keyed list: create 1000 direct` 152 → 216 ops/s (0.63× Solid), 10k — 15 → 20 (0.66×), `index list: create 1000 direct` 137 → 158 (0.47×); обычные `For`/`Index` без изменений.
- Компилятор автоматически передаёт `parent`/`marker` для `<For>` и `<Index>` в JSX: на клиенте больше нет `insert + component` для списков, а гидрация использует `findInsertWindow` по маркеру дыры. Работает и для алиасов (`For as List`), но только для импортов из `silent-core`/`silent`; чужой компонент с именем `For` не оптимизируется. Гидрация в Chromium: 13 800 → **16 004–16 575 ops/s** (+16–20%), p50 0.055 → 0.045 мс; размер стартового чанка не изменился.
- `reconcileDependencies` получил fast path для одной зависимости: если набор зависимостей не изменился, обновляется только версия, без пересборки массивов и обхода `Map`. Бенчмарки: signal 10k writes 263 → 433 ops/s (1.52× Solid), memo chain 143 → 253 (1.60×), effect → textContent 159 → 220 (1.41×), batched writes 6 927 → 7 259 (2.05×).

## 0.11.18

### SSR

- Light-компоненты на сервере рендерятся напрямую, без light-инстанса, props-прокси, отдельного `createRoot`, props-updater и focus-логики. `renderToString` на скомпилированном приложении: 54 216 → **84 323 ops/s** (+55%), 0.47× → **0.71×** от Solid; HTML не изменился.
- `renderToStream` не сериализует `head`, если не передан `onHead`, и отдаёт чанк короче `chunkSize` без промежуточного `slice`; регионы по-прежнему сериализуются один раз через `serializeBetween`.
- Shell без `onShell` сериализуется сразу в чанки через `serializeNodeChunks` (без полной строки и повторного `slice`) для mini-DOM деревьев; скомпилированный `RawText` по-прежнему отдаётся одной строкой.

### Размер бандла

- Vite-плагин получил `hydrate: false` для mount-only приложений: `__SILENT_HYDRATE__: false` вырезает hydration-ветки и прокси из стартового чанка.
- В core добавлена build-time константа `HYDRATE`; `isHydrating`-ветки в `For`/`Index`/`Show`/`Switch`/`dom`/`component-lite`/`Suspense`/`ErrorBoundary`/`Portal`/`Transition` закрыты ею.
- Mount-only `bench:build`: 35.71 → **35.0 KB** min, 12.37 → **11.9 KB gzip**. Default/SSR-сборки не меняются.

### Производительность гидрации

- `ComponentResult.settled` стал ленивым getter'ом с заранее снятым `ready`-снимком; промис `whenDisposed` и `Promise.race` создаются только при обращении. Вложенные `component()` больше не платят за неиспользуемый `settled`.
- `findInsertWindow` сканирует комментарии вперёд от `firstChild` до `INSERT_END` со стеком вложенности вместо обратного прохода по всем узлам региона.
- Границы первого insert-региона в родителе запоминаются при адоптации шаблона (`WeakMap` `INSERT_END → INSERT_START`), поэтому `findInsertWindow` для него выполняется за O(1); несколько регионов в одном родителе остаются на прежнем проходе.
- Первичный рендер light-компонента больше не выполняет логику обновления (`entries.slice`, `captureFocus`, поиск anchor, `Set` старых узлов).
- `Match`, `For`, `Switch` и `Index` помечены как прямые компоненты: `component()` и `createComponentLight()` вызывают их без light-инстанса и props-прокси. `Show` остаётся на light-пути, чтобы не удерживать его код в стартовом чанке.
- Замеры: jsdom 1 296–1 377 ops/s, Chromium 13 800 ops/s; стартовый JS 35.71 KB / 12.37 KB gzip. A/B против 0.7.5 с фиксом `getReady`: ratio среднего 0.92, медианы 1.125 (в пределах тика 5 µs) — фактически паритет.

## 0.11.17

### Исправления

- `Switch`/`Match` больше не уходят в бесконечный flush при реактивном `when` (issue #1). `Match` помечен как маркерный компонент: `component(Match)` и `createComponent(Match)` вызывают его напрямую, без light-инстанса и реактивного props-прокси, поэтому обновление props внутри эффекта `Switch` не инвалидирует сам эффект. Реактивные props обычных light-компонентов сохранены.

### Производительность гидрации

- `getReady` больше не обходит поддерево, пока ни один компонент не вызывал `setReady`: для light-приложений без VM это убирает рекурсивный `collectReady` и ожидание `Promise.race` на каждой гидрации.
- Гидрация light-корня учитывает созданные клиентские узлы в контексте гидрации вместо двух полных обходов DOM (`countNodes`). Откат на свежий рендер при дублировании разметки сохранён.
- Замеры на одном стенде: Chromium 9 900–10 400 → 11 100–11 700 ops/s (p50 0.075 → 0.060–0.065 мс), jsdom 1 170 → 1 231 ops/s; стартовый JS 35.24 KB / 12.23 KB gzip (baseline 35.14 / 12.18).
- Проверено и отклонено: prefix-кэш `resolvePath` в адоптации плана (медленнее на ~4%), удаление `findInsertWindow` без данных о регионах в плане, сокращение эффектов на статическую строку (второго эффекта нет).
- `For`/`Index` больше не читают `props.children` через реактивный props-прокси внутри пробного прохода: статические строки не создают render-эффект и owner. На 20 гидраций `renderEffectsCreated` 520 → 120, `activeOwners` 620 → 220; Chromium 11 700 → ~13 100 ops/s, jsdom 1 231 → 1 255–1 377; стартовый JS 35.35 KB / 12.25 KB gzip.
- Пустые runtime options не биндятся, поиск опций по owner-цепочке пропускается, пока опции не выставлялись; props-proxy создаётся без отдельного `createRoot`; последовательный `hydrate` не проходит через очередь `serialized`.

## 0.11.16

### RouterView и DI

- `RouterView` принимает `container`, строго резолвит Router из контейнера и передаёт контейнер в `component(..., { container })` на клиенте и на SSR.
- Добавлены слоты `error` и `notFound`; ошибка загрузчика и отсутствие маршрута больше не оставляют пустой экран. `state.error` рендерится и на сервере.
- `RouteRecord.key` управляет пересозданием view при смене параметров; без ключа DOM по-прежнему переиспользуется.
- Добавлен регрессионный тест «layout + ленивые children + DI» с одним `Session`/`Router` из `bindValue`.
- Добавлен тест гидрации вложенного layout с ленивым child и SSR-тест error-слота.

### Навигация и API роутера

- `router.navigate(to, { replace? })` не бросает и пишет ошибку в `state.error`; `push`/`replace` сохраняют прежнее поведение.
- `RouterOptions.onError`, `RouteLocation.meta`, `IRouter.meta`.
- `RouteGuardContext` с `container` и `createGuard`; guard получает контекст четвёртым аргументом.
- `RouterOptions.load` / `resolveComponent`, `isLoaded`, `hasRoute`.
- `createTestRouter` с `MemoryHistory` по умолчанию.

### DI и core

- Добавлен строгий режим `ContainerOptions.implicitBindings` (`allow`/`warn`/`error`), `MissingBindingError` и `hasExplicit`.
- Режим наследуется в `createScope`; по умолчанию `warn` в development и `allow` в production.
- Добавлена матрица тестов наследования scope для `bindValue`, singleton, scoped и transient.
- `component(fn, props, options?)` принимает явный контейнер с приоритетом над ambient runtime options.
- `createMountPoint` переприсоединяет отсоединённый маркер, поэтому `insertBefore` больше не падает с «node before which is not a child of this node».
- Devtools получили событие `resolve` и счётчик `resolutions`.

### Vite и пакеты

- `silent-vite` получил режим `di: "allow" | "warn" | "error"`; в `error` сборка падает с именем зависимости.
- Внутренние зависимости библиотек переведены на peer-диапазоны `>=0.11.0 <0.12.0`, локальная разработка использует `workspace:*`.
- `version.mjs` обновляет диапазоны при смене minor-версии.
- `@ivlev-dev/silent` реэкспортирует `@ivlev-dev/silent-router`.

### Пример и документация

- `examples/router` переведён на `bindValue`, строгий контейнер, login-guard, приватный layout с ленивым child, `navigate()` и error/notFound-слоты.
- e2e и SSR-e2e обновлены под сценарий «гость → логин → защищённый layout → lazy child → 404».
- Обновлены README, `docs/api/*` и `docs/guides/*`, пересозданы API-снимки.

## 0.11.15

### Link: prefetch по видимости

- `prefetch` принимает `boolean | "hover" | "visible"`. Режим `"visible"` запускает `router.prefetch`, когда ссылка появляется во viewport через `IntersectionObserver`, и отключает наблюдатель после первой загрузки.
- Без `IntersectionObserver` prefetch выполняется сразу после монтирования; на сервере (`isServerMode`) не запускается.
- Добавлены тесты на viewport-триггер, отсутствие повторной загрузки, fallback без observer и SSR-режим.
- Документация и гайд по роутеру обновлены.

## 0.11.14

### Исправления гидрации

- `findInsertWindow` больше не возвращает первый `silent-insert`-регион родителя: при нескольких подряд регионах это удаляло соседние ссылки и содержимое маршрута.
- Light-компоненты в слотах очищают регион только от серверных узлов, которые не были созданы клиентом; клиентские узлы и вложенные компоненты сохраняются.
- `RouterView` переносит серверный маркер в свой контейнер, поэтому разметка маршрута вставляется и гидрируется без дублей.
- Добавлена опция `RuntimeOptions.hydrate: false`, и `isHydrating()` учитывает её через owner-цепочку: маршрут рендерится заново, не пытаясь адоптировать шаблон.

### Пример и e2e

- [`examples/router`](./examples/router) стал SSR-приложением: `entry-server`, `server.mjs`, `hydrate` на клиенте и сборка `dist/client`/`dist/server`.
- `scripts/ssr-e2e.mjs` проверяет SSR роутера в Chromium: отсутствие дублей, адоптацию оболочки, reuse view при смене `params`, `aria-current` и навигацию после гидрации.
- Добавлен регрессионный тест `findInsertWindow` на несколько регионов в одном родителе.

## 0.11.13

### Исправления Suspense/lazy

- `lazy` сбрасывает состояние после ошибки загрузки: следующее монтирование снова вызывает loader, без перезагрузки страницы.
- Если общий `Suspense` уже показывает содержимое, `lazy` при новом переходе рендерит собственный прелоадер или `fallback`-функцию границы, поэтому раздел не остаётся пустым до загрузки чанка.
- Добавлены регрессионные тесты: `Suspense`+`lazy` внутри `Show`, повторный переход в общем `Suspense`, опустошение `For` внутри `Show`, retry после ошибки и отсутствие ошибочного `console.error` при первом рендере.

### DI: alias и tsconfig paths

- Нативный сканер и transform понимают строковые алиасы Vite (`resolve.alias`) и `compilerOptions.paths` из `tsconfig.json`/`tsconfig.app.json`/`tsconfig.base.json`.
- `scan(root, optionsJson)` принимает правила алиасов; Vite-плагин собирает их автоматически и передаёт в scan и transform.
- Добавлены Rust- и JS-интеграционные тесты на интерфейс, импортированный через alias.

## 0.11.12

### Link: prefetch на touch

- `Link prefetch` теперь срабатывает и на `pointerdown`, поэтому предзагрузка работает на touch-устройствах без hover.
- Добавлен тест на `pointerdown`.

### Документация

- Добавлен практический гайд по роутеру: [`docs/guides/router.md`](./docs/guides/router.md) — установка, route-классы, `Link`/`RouterView`, guards, loaders, DI, SSR/гидрация, прокрутка и тесты.
- Гайд добавлен в README, `docs/api/index.md` и `docs/getting-started.md`.

## 0.11.11

### Исправления гидрации

- Light-компонент внутри слота `template()`/`templateHoles()` больше не оставляет серверную разметку рядом с клиентской: устаревший фрагмент удаляется перед вставкой.
- Поиск устаревшего фрагмента сверяет форму узлов и не заходит за границы маркеров, поэтому шаблонные и условные вставки не затрагиваются.
- Добавлен тест на гидрацию light-компонента в слоте view.

## 0.11.10

### Router: прокрутка к hash

- Без `scrollBehavior` переход на маршрут с непустым `#hash` прокручивает к элементу по `id` (или `name`) после обновления DOM.
- Сохранённая позиция истории по-прежнему имеет приоритет; пользовательский `scrollBehavior` полностью управляет прокруткой.
- Добавлен тест на прокрутку к существующему и отсутствующему якорю.

## 0.11.9

### Исправления гидрации

- Light-компоненты без ViewModel больше не дублируют серверную разметку: если при адоптации появляются лишние узлы, приложение перерендеривается клиентски с детерминированными `id`.
- Сервер освобождает компоненты до восстановления DOM-глобалов, поэтому teardown не падает в окружениях с jsdom.
- `RouterView` корректно гидрируется: находит серверный маркер `silent-router-view`, удаляет устаревшую разметку маршрута и рендерит matched-компонент заново в это место.

### API

- Добавлены `withoutHydration` и `adoptHydrationRegion` в `@ivlev-dev/silent-core`.

### Тесты

- Добавлены интеграционные тесты SSR + гидрация для роутера: светлый корень, смена маршрута и компилируемый view-корень с `templateHoles`.

## 0.11.8

### Исправления

- Компилятор больше не теряет значимые пробелы в JSX-тексте: `Пользователь {id}` рендерится как `Пользователь 1`, а не `Пользователь1`. Многострочные отступы по-прежнему нормализуются, одиночные пробелы внутри строки сохраняются.
- Wildcard-маршрут `*` больше не перехватывает корень `/`: статический корневой маршрут имеет приоритет.

### Пример и e2e

- Добавлен [`examples/router`](./examples/router): route-классы, params, typed query, lazy-маршрут с `prefetch`, DI и `Link`/`RouterView`.
- В `scripts/e2e.mjs` добавлен сценарий `runRouter`: навигация, reuse view, `aria-current`, активные классы, history и отсутствие дублей.

## 0.11.7

### Router: повторная навигация

- `push`/`replace` на текущий `fullPath` (включая query и hash) больше не создают новую запись в истории и не перезапускают guards/loaders.
- Клик по активной ссылке больше не плодит записи истории.
- Добавлен тест на дедупликацию навигации.

### Документация

- Раздел `renderToStream` в `docs/guides/ssr.md` приведён в соответствие с реализацией: прогрессивный shell, патчи границ, `onShell`/`onChunk`, `nonce`, `signal` и ограничения протокола.
- Убрано устаревшее утверждение об отсутствии прогрессивного стриминга из `docs/guides/hydration.md`.

## 0.11.6

### RouterView: reuse и lifecycle

- Light-компоненты без ViewModel больше не пересоздаются при смене `params`/`query`: они обновляются через `update()` с сохранением focus.
- У ViewModel при смене параметров вызывается hook `updated()`.
- Добавлены тесты на light-компоненты и lifecycle.

## 0.11.5

### Переиспользование route-view

- `RouterView` больше не пересоздаёт view при смене `params`, `query` или `hash` в рамках одного route-компонента.
- Props остаются живыми: обновляются только зависимые эффекты, DOM, введённый текст и focus сохраняются.
- Компонент пересоздаётся только при смене route-компонента; light-компоненты без ViewModel перемонтируются как раньше.
- Добавлены тесты на reuse, смену компонента и light-компоненты.

## 0.11.4

### Link и внешние ссылки

- `Link` больше не перехватывает внешние URL (`http(s)://`, `mailto:`, `tel:`, `//`) и hash-ссылки; они рендерятся обычным `<a href>` без `aria-current`/prefetch.
- Добавлен тест, документация обновлена.

## 0.11.3

### Доступность Link

- `Link` выставляет `aria-current="page"` на точный активный маршрут и снимает его при уходе.
- Добавлены тесты и описание в документации.

## 0.11.2

### Router prefetch

- `IRouter.prefetch(to)` загружает lazy-компоненты маршрута без навигации.
- `Link` получил `prefetch?: boolean`: загрузка запускается на `pointerenter`/`focus` один раз.
- Добавлены тесты prefetch для lazy route; документация и API-снимки обновлены.

## 0.11.1

### Router

- Mixed-сегменты path: `edit-{id}`, `edit-{id}-{tab}`, `v{version}.{ext}`; mixed-специфичность между static и param, encode/decode параметров.
- `container.bind(Router, instance)` теперь сразу доступен через `peek`/`peekValue`/`resolveSync` и `resolve`; `provide`/`bindValue` сохранены.
- Runtime query-схема: `QueryParser`/`QuerySchema`, `query` на `Route`/`RouteDefinition`/`RouteRecord`; строки→number/boolean/массивы, function parser, `buildQuery` для чисел/boolean/массивов, парсинг цепочки routes.
- `RouteQuery` расширен runtime-значениями; `RouteViewProps.query`/`RouterState.query`/`router.query` получают распарсенные значения.
- Обновлены README, `docs/api/router.md`, API snapshots/signatures.
- Тесты router/di/core/server и typecheck зелёные.

## 0.11.0

Router переведён на MVVM/DI-контракт.

### Router и DI

- Добавлен `IRouter`; `Router implements IRouter`. `IRouter` экспортируется как тип и runtime-токен для compiler DI.
- `Router.provide(container)` и `RouterOptions.container`; `Container.bindValue`/`peekValue` для синхронной доставки.
- `Link`/`RouterView` получают роутер из DI-контекста, explicit prop или `Router.current()`.
- ViewModel может принимать `constructor(private readonly router: IRouter)`; роут-компоненты монтируются через core `component()`, поэтому VM/DI работают в route-компонентах.
- `RouterView` передаёт `RouteViewProps` с `route/params/query/hash/router`.

### Route-классы

- `abstract class Route<Path, Query>` с `path`, `name`, `component`, `children`, `redirect`, `meta`, `beforeEnter`, `load`.
- `RouterOptions.routes` принимает классы, экземпляры и старые object-routes.
- Поддержаны path params `/edit/{id}` (и `:id`), `PathParams<Path>`, типизированный query, `RouteViewProps`.
- `load()` поддерживает динамические импорты (`import("./edit")`) и `{ default }`, кешируется.
- Guards/redirects/loaders работают с route-классами; SSR через `MemoryHistory` сохранён.
- Object-routes/`Router.current()` оставлены для обратной совместимости.

### Проверки

- Router: 71 тест; DI: 92; core: 475 + 1 skipped; server: 193.
- Добавлены тесты DI-инъекции `IRouter`, route-классов, `{id}`, typed query, динамических импортов и SSR с VM-роутом.

## 0.10.1

### Partial hydration

- Добавлен `hydrateIslands`/`IslandMount`: независимая гидрация SSR-островов с сохранением статической оболочки и отдельным dispose каждого острова.
- Документация и API-снимки обновлены.

## 0.10.0

Платформенная волна: progressive streaming SSR, devtools и инфраструктура качества.

### Streaming SSR

- `renderToStream` стал настоящим progressive streaming: shell и `head` уходят до завершения async VM/`Suspense`/`lazy`; готовые границы дописываются патч-чанками с inline-runtime.
- Протокол регионов `silent-stream:*`, вложенные границы, `onHead`/`onShell`/`onChunk`, `nonce`, `AbortSignal`, отмена.
- Итоговый DOM совпадает с `renderToString`, `hydrate` принимает стриминговую разметку; `ssr-e2e` проверяет stream-маршрут в браузере.
- `renderToStream` с async-границами больше не обещает, что простая склейка чанков без браузера равна финальному HTML.

### Devtools

- `@ivlev-dev/silent-core/devtools`: снимок view/pending/DI/hydration/registry/reactivity, события mount/unmount/error/hmr/navigate, `installDevtools`/`uninstallDevtools`, production no-op.
- `Container.snapshot()` и `getReactivityStats()`; буфер событий ограничен и не удерживает компоненты/VM/props.

### Инфраструктура

- Firefox/WebKit e2e-матрица в CI, `test:e2e:firefox`/`webkit`; Firefox-прогон подтверждён.
- API-signature snapshot (`scripts/api-signatures.json`), `api:check:self` в CI.
- Стартовый JS: 34.95 → 35.14 KB, gzip: 12.07 → 12.18 KB; VM gzip: 13.68 → 14.15 KB. Baseline обновлён под 0.10.0.

## 0.9.1

Платформенная оптимизация: стартовый бандл, браузерная матрица и API-сигнатуры.

### Размер и гидрация

- Гидратация шаблонов вынесена в lazy-чанк `dom-hydration`: `dom.ts` больше не несёт claim/adopt/metadata-логику.
- `context` отделён от `component-lite` через dependency-free link; Context не попадает в стартовый чанк без использования.
- Удалён `collectPartsPlan`/`measurePath` для `templateHoles` без плана; `insert` больше не тянет server-proxy в клиент; добавлены PURE-аннотации.
- Стартовый JS: 38.79 → 34.95 KB, gzip: 13.06 → 12.07 KB; VM gzip: 14.64 → 13.68 KB. `dom-hydration` растёт только при `hydrate()`.

### Инфраструктура

- `pnpm test:e2e:firefox`/`webkit`/`chromium`; CI-матрица Firefox/WebKit, DOM-инварианты нативного select.
- API-signature snapshot (`scripts/api-signatures.json`, `api:check:self`) с нормализованными TypeScript-сигнатурами и стабильным JSON; CI проверяет имена, сигнатуры и стабильность снимка.
- Документация API и changelog обновлены.

## 0.9.0

Новый пакет `@ivlev-dev/silent-router`.

### Router

- Класс `Router` с вложенными маршрутами, `:param`, `*`, index-маршрутами, specificity, redirect, guards, `load`, `AbortSignal`, scroll restoration и реактивным состоянием `route`/`params`/`query`/`matched`.
- Публичные компоненты только `Link` и `RouterView`; публичных hooks (`useRouter`, `useRoute`, `useParams`) нет.
- `Link`: настоящий `<a href>`, base, перехват левого клика без модификаторов, реактивные `activeClass`/`exactActiveClass`.
- `RouterView`: matched-компонент по `depth`, fallback, реактивное обновление и освобождение DOM.
- `BrowserHistory`, `MemoryHistory`, `createBrowserHistory`, `createMemoryHistory`; SSR через memory history.
- Ошибки `RouterMissingError`, `RouterNavigationError`, `RouterAbortError`.
- Пакет добавлен в build/version/pack/publish-инфраструктуру как восьмой публикуемый пакет; документация — `docs/api/router.md`.

## 0.8.0

Волна прикладных примитивов: Context, Portal, Transition, Resource, Head, keyed-списки, controlled bindings и расширенная реактивность.

### Компоненты и контекст

- `Context`/`createContext`/`Provider` с owner-scoped значениями, default, `BoundContext`, `ContextMissingError`; наследование через компоненты, эффекты и async-пути.
- `Portal`/`Teleport` с reactive target, переносом DOM, вложенными порталами и очисткой; SSR-контракт client-only через `PORTAL_MARKER`.
- `Transition`/`Presence`: enter/leave-классы, удержание DOM до конца leave, `unmount:false`, отмена таймеров, SSR-совместимость.
- `Head` с дедупликацией title/meta/link/style, стеком title, SSR-head и гидрацией.
- SSR-safe `createId`/`useId`/`IdSequence`, сброс счётчика в SSR и гидрации.
- `For.keyOf`, `Keyed`, `mapKeyed` и keyed-реконсиляция по ключу с сохранением DOM/фокуса.
- `bindValue`/`bindChecked`/`bindSource`, compiler-биндинги, IME/composition, каретка, deferred select, checkbox/radio/indeterminate, `defaultValue`/`form.reset`.
- `classNames`/`normalizeClass`, `styleDeclarations`/`normalizeStyle`/`styleValue`, массивы/объекты классов и px/unitless-стили.
- `updateProps`/`registerPropsUpdater`: обновление props view/light-компонента без пересоздания DOM.

### Reactivity

- Реактивные `Map`/`Set` с точечными зависимостями, `markRaw`/`isRaw`, `readonly`/`isReadonly`/`ReadonlyMutationError`, очистка полей при удалении.
- `createSignalHandle` и расширенная документация ошибок/циклов.

### Тесты и бенчмарки

- Добавлены контрактные тесты Context/ID/Portal/Transition/Resource/Head/keyed/bindings/class-style/props-update и SSR/hydration-сценарии.
- Стартовый JS: 34.28 → 38.79 KB, gzip: 11.70 → 13.06 KB. Baseline `bench:guard` обновлён под 0.8.0; вынос опциональных примитивов в отдельные entrypoints запланирован на 0.9.

## 0.7.5

Волна state/lifecycle reliability: готовность дерева, изоляция DI-скоупов в SSR, отмена Suspense, light-компоненты и устойчивость reactivity.

### DI и SSR

- Scoped-зависимости singleton больше не захватываются корневым контейнером: `InvalidScopeError` с токенами и owner; в SSR создаётся отдельный request-scope на каждый `renderToString`, который освобождается в `finally`.
- `Container.dispose` стал exception-safe, освобождает инстансы через `Symbol.dispose` (LIFO), вызывает `onDispose` в FIFO, очищает кеши даже при исключении и пробрасывает первую ошибку/`AggregateError`.
- `resolve` возвращает rejected Promise для disposed/unknown token; добавлен `resolveSync` для уже разрешённых значений.

### Готовность и жизненный цикл

- `ready` — готовность корня, `settled` — готовность всего дерева; `getReady` агрегирует все `COMPONENT_READY` поддерева, добавлены `getOwnReady`/`whenSettled`.
- `mount().ready`/`ComponentResult.ready` остаются root-only; для полного UI используйте `settled`.
- Light-компоненты получили собственный owner/root и переиспользуют инстанс при изменении props, не теряя focus и DOM-состояние.
- `Suspense` отменяет отложенные загрузки через `AbortSignal`, освобождает детей, созданных до показа fallback, пробрасывает ошибки `lazy` в `ErrorBoundary`/`onError`.
- Runtime options, DI scope, boundary и `onError` наследуются по owner-контексту, а не только через амбиентные глобалы после `await`.
- HMR: `recreateVm` вызывает lifecycle старой VM, очищает сервисы scope, защищён от гонки поколений; `ErrorBoundary` не рендерит fallback после dispose.

### Reactivity

- Исключение в одном эффекте больше не срывает flush: остальные эффекты выполняются, ошибка уходит в `setEffectErrorHandler` (по умолчанию `console.error`).
- Memo после исключения остаётся `DIRTY` и пересчитывается при следующем чтении; циклические memo дают `CircularComputationError` с путём.
- Поиск зависимостей переведён с O(n²)-`indexOf` на run-stamp/Map; `batch` внутри initial-эффектов больше не перескакивает порядок.

### Тесты и бенчмарки

- Добавлены регрессии для DI captive/SSR request scope, dispose/Symbol.dispose, readiness/light/Suspense/HMR, reactivity reliability.
- Стартовый JS вырос с 31.00 до 34.28 KB, gzip — с 10.49 до 11.70 KB; baseline `bench:guard` обновлён под 0.7.5.

## 0.7.4

Волна SSR/hydration correctness: исправлены гидрация управляющих конструкций, raw-text и опасный HTML на сервере, а также несколько расхождений SSR/CSR.

### Гидрация и управляющие конструкции

- Единый протокол курсора гидрации для `Show`, `For`, `Suspense`, `lazy`, `fragment`, `Switch`, `Index` и `ErrorBoundary`; View с корнем `Show`/`For` больше не откатывается на клиентский рендер.
- `shapeMatches`: корректное сравнение текстовых префиксов/суффиксов вокруг дыр, metadata-шаблоны с `<title>`, прозрачный `tbody`, strict-диагностика устаревших атрибутов.
- `hydrate` освобождает частично созданный root при mismatch и сериализует параллельные вызовы, не смешивая контексты.
- `Show`/`Switch` сохраняют DOM при изменении `when` между истинными значениями и пересоздают ветку только при смене истинности/выбранной ветки.
- `For`/`Index` принимают `Iterable`, `null`/`undefined`, density-нормализуют sparse-массивы и корректно адоптируют текстовые строки.

### SSR, raw-text и DOM

- `style`/`script`: сохранены переводы строк, добавлен raw-режим SSR без HTML-экранирования с защитой `</style>`/`</script`; клиентский script остаётся инертным.
- `dangerouslySetInnerHTML`/`innerHtml`: корректный raw HTML на SSR, освобождение прежних детей на клиенте, поддержка в `spread`/`applyProps`.
- `spread` на SSR не выводит обработчики событий и не дублирует статические `class`/`style`; `spread(null)` снимает прежние значения.
- Controlled `<select>` применяет значение после появления `<option>`; SSR не выводит невалидный `value` на `<select>`.
- `createMountPoint` сохраняет те же узлы и корректно перерисовывается после `clear`.
- Независимые `style`/`spread`/`attr(style)`-биндинги больше не затирают стили друг друга.
- `on` принимает канонические, `on:`- и capture-имена; делегированные обработчики получают `currentTarget` элемента, исключение не обрывает предков.
- Статические `true` для не-булевых атрибутов (`aria-*`, `draggable`, `data-*`) выводятся как `"true"`.
- Добавлены `xlink:*` и camelCase-маппинг SVG-атрибутов.

### Тесты

- Добавлены регрессии для гидрации с корнем `Show`/`For`/`Switch`/`Suspense`, metadata-шаблонов, `<table>`/`tbody`, параллельных `hydrate`, raw-text, `dangerouslySetInnerHTML`, SSR `spread`, controlled `select`, `style`-биндингов, событий, boolean-атрибутов и `For`/`Index` с `Iterable`/sparse/undefined.

### Бенчмарки

- Стартовый JS: 29.15 → 31.00 KB, gzip: 9.96 → 10.49 KB. Рост связан с протоколом гидрации, нормализацией списков и SSR-хелперами; baseline `bench:guard` обновлён под 0.7.4.

## 0.7.3

### Исправления

- Динамические SVG-дети (`For`, `.map()`, компоненты) создаются в SVG-пространстве имён: компилятор передаёт namespace-хинт в `templateHoles`, рантайм дополнительно определяет SVG по корневому тегу. Иконки и графики больше не теряют `getBBox` и не рисуются в HTML-namespace.
- `<style>` и `<script>` поддерживают текстовую интерполяцию: динамическое содержимое пишется через `textContent`, comment-маркеры внутрь raw-text элементов больше не попадают. JSX-дети внутри них дают ошибку компиляции.
- `Show`/`Switch` больше не пересоздают активную ветку из-за несвязанных полей и сохраняют DOM при изменении `when` между двумя истинными значениями; пересоздание происходит только при смене истинности/выбранной ветки.
- Нативные `value`, `checked`, `selected` и `disabled` записываются только при реальном изменении — меньше побочных эффектов при фокусе, в том числе для `<select>` в Firefox.
- `Child` принимает `Iterable<Child>`: `.map()`, `Set`, генераторы и `NodeList` работают как дети JSX.
- Реактивная деструктуризация props в компиляторе: `const { value } = props`, переименование, значения по умолчанию, вложенная деструктуризация и `({ value }: P)`.

### Тесты и документация

- Добавлены регрессии для SVG-namespace, `<style>`/`<script>`, сохранения состояния `Show`, записи нативных свойств, iterable-детей и деструктуризации props.
- `pnpm test:e2e` проверяет браузерный стенд `examples/counter/regressions.html`: namespace SVG, динамический CSS, сохранение input и select, реактивные props. SSR-проверка гидрирует динамический SVG и сохраняет namespace.
- Базовые метрики `bench:guard` обновлены под фактическую сборку 0.7.2. Относительно неё стартовый JS вырос на 0.68 KB (28.47 → 29.15), gzip — на 0.28 KB (9.68 → 9.96), это в пределах порогов guard; браузерное соотношение к Solid не ухудшилось.

## 0.7.2

Исправление camelCase-обработчиков событий, новый пример с MVVM и DI.

### Исправления

- `onKeyDown`, `onKeyUp`, `onPointerDown`, `onPointerUp`, `onTouchStart`, `onDblClick` и другие camelCase-обработчики больше не превращаются в несуществующие имена событий (`keyDown` вместо `keydown`) и действительно срабатывают: имена стандартных DOM-событий приводятся к каноническому виду, `onDoubleClick` понимается как `dblclick`, `Capture`-суффикс и `on:`-события работают как раньше.

### Примеры и документация

- Новый пример `examples/todo`: ViewModel с вычисляемыми счётчиками, DI-сервис хранения в `localStorage`, keyed-список через `For` с фильтрами и удалением.
- `pnpm test:e2e` проверяет и `examples/todo`: добавление, переключение, фильтры, перезагрузка со восстановлением из `localStorage`, удаление и очистка выполненных.
- Гайд по гидрации описывает адоптацию по плану компилятора (пути, `counts`, `key`) и откат на структурный поиск.

## 0.7.1

Оптимизация аллокаций при гидрации списков. Публичное API не менялось (core 92, reactivity 31, di 10, swc 4, vite 2, server 5).

### Производительность

- `For`/`Index`: состояние строки — класс, `setIndex`/`setItem` живут на прототипе вместо замыканий на каждую строку, окно гидрации переиспользуется в пределах списка. Сэмплированные аллокации на гидрацию приложения с `For`: 5395 → 5092 KB (−5.6%), доля `makeState` 1108 → 926 KB (−16%).
- Бенчмарки: `pnpm bench:alloc` собирает приложение перед замером (раньше мог мерить устаревший бандл), отключается флагом `--no-build`.

## 0.7.0

Гидрация без материализации дерева, ключи адоптации шаблонов, изолированный стенд бенчмарков и профиль аллокаций. Публичное API не менялось (core 92, reactivity 31, di 10, swc 4, vite 2, server 5).

### Производительность

- Клиентский рантайм: `For`/`Index` без owner/эффекта на статический элемент (через `createEffectUnlessStatic`), metadata-проверка одиночного узла без промежуточного массива, кэш применённых стилей без чтения DOM, `spread` не пересобирает ключи предыдущего объекта. Делегирование событий: `change`/`click`/`contextmenu`/`dblclick`/`input`/`keydown`/`keyup`/`mousedown`/`mouseup`/`pointerdown`/`pointerup`/`submit`/`touchend`/`touchstart` навешиваются одним слушателем на `document`, обработчик ищется по `parentNode` от `event.target`; capture, `focus`/`blur`, hover/move и `on:*` — прямые. Ленивые маркеры элементов в non-hydration `For`/`Index`: `Comment` создаётся только при пустом рендере или перед перестановкой, dispose-хук перенесён на первый узел блока (`ITEM_DISPOSER`). `pnpm bench`: create 1000 строк 80 → 143 ops/s, append 100 — 1 078 → 1 900, append 1k — 97 → 163, create 10k — 8 → 12, reorder 1000 — 1 353, `index list: create 1000 rows` — 135 против 325 у Solid; сигналы 1.0–2.2× к Solid. Стартовый JS 25.6 → 27.0 KB (8.6 → 9.1 KB gzip).
- Гидрация: дескриптор адоптации, текстовые дыры без регионов, кэш состояний регионов, ленивые owner/эффекты, массивы зависимостей вместо `Set`/`Map`, пробные проходы зависимостей (статические выражения не создают подписок), ленивые узлы `For`. Chromium 8 746 → 15 300–22 100 ops/s, p50 0.205 → 0.035–0.060 мс; jsdom 1 368 → 1 990 ops/s на ручном приложении и 715 на скомпилированном.
- Гидрация (0.7.0, волна M3): план адоптации несёт готовые имена маркеров (`key`), поэтому проверка дыры и атрибута идёт сравнением строк без `startsWith` и разбора числа; `createEffectUnlessStatic` при отсутствии собственных зависимостей создаёт лёгкий owner вместо `EffectNode`, так что на строку списка и на `insertHydrated` больше не появляется узел графа с `deps`/`state`; добавлены быстрые пути `findInsertWindow` для пустого региона, `insertHydrated` без обхода окна и `pickSignificantChild` для комментария-дыры. Chromium 17 650–22 590 ops/s (0.80–1.11× в пределах шума машины, p50 0.035 мс), jsdom 1 126 ops/s, heap на гидрацию в Chromium 1.04 → 0.03–1.08 KB (метрика шумит от GC). Стартовый JS 27.0 → 27.4 KB (9.1 → 9.2 KB gzip) — плата за ключи плана.
- SSR: `serializeNode`/`serializeChildren`/`serializeHead` берут строковые буферы из модульного пула по глубине вложенности с освобождением в `finally`; `renderToString` не ждёт `whenIdle` и лишний микротакт, если компонент готов синхронно и отложенной работы нет. `renderToString` 110 686 ops/s (0.91× к Solid на этом прогоне).
- Размер: probe-код вынесен в гидрационный чанк, `__SILENT_SERVER__: false` в production-клиенте вырезает `insertServer`/`serializeServerValue`, при `view: false` отключается полифилл `modulepreload`. Стартовый JS 28.1 → **25.4–25.6 KB** (9.5 → 8.6 KB gzip).
- Нативный компилятор: проверен `lto = "fat"`; оставлен `thin` (fat: +64% времени сборки, −3.9% размера).
- SSR: серверный `For` собирает список синхронно, без owner/эффектов на элемент; `insertServer` не создаёт эффект для статических значений; `For` рендерит в строковый `RawNode` через `ServerBackend.createFragment`. `renderToString` 21 400 → 71 000–78 000 ops/s, соотношение к Solid 0.17 → 0.60.
- SSR: динамические атрибуты (`attr`/`prop`/`style`/`spread`) рендерятся строкой через `RawAttr` без мини-DOM; значения дописываются после статических атрибутов с сохранением маркеров `data-silent-a-*`, `textarea`/`title` получают `value`/`textContent` как экранированный текст.
- SSR: компилятор в режиме `ssr: true` (включается Vite-плагином для SSR-сборок и `vite.ssrLoadModule`) генерирует строковую сборку без `templateHoles`/`insert` и мини-DOM: статические части выносятся в модульный массив, кодогенерация — прямая конкатенация `_$ssrRaw(... + _$ssrValue(expr, bare) + ...)`. `ssrValue` экранирует и оборачивает нестроковые значения регионами вставки, маркеры `silent-hole-*`/`data-silent-a-*` остаются; разметка совпадает с шаблонным путём байт-в-байт, гидрация не меняется. Результат — `RawText` вместо `RawNode`; серверные `For`/`Index` собирают строку напрямую. Для динамических атрибутов, `style`/spread, `dangerouslySetInnerHTML`, RCDATA-значений и metadata-тегов — откат на `templateHoles`. `renderToString` 105 000–115 000 ops/s, отношение к Solid 0.93–1.15.
- SSR: статические шаблоны, `Show`/`Switch`/`Index`/`ErrorBoundary` и серверный `For` больше не создают мини-DOM узлы и эффекты; `For`/`Index` не заводят замыкание индекса на элемент и переиспользуют строки маркеров, списки детей мини-DOM-узлов и восстановление глобалов стали дешевле. Разметка собирается конкатенацией строк в `RawNode.render`, вложенные узлы вставляются одной строкой. Отношение к Solid в A/B: 0.60 → 0.70–0.76, `renderToString` 100 000–104 000 ops/s.

### Сборка

- `pnpm build`: `tsc -b` с project references (`composite: true`) вместо `pnpm -r build` — warm 417 → 200 мс, cold 414 мс. Нативный addon пропускается по sha256 исходников, а не по mtime, поэтому `touch`/checkout без изменений не пересобирает.
- Vite-плагин: персистентный кэш transform в `config.cacheDir/silent-transform`, ключ = версия addon + модуль + JSON опций + хэш индекса + код; старые записи чистятся на `buildStart`, кэш отключается через `SILENT_TRANSFORM_CACHE=off`.
- `bench:guard --only=build` сравнивает `coldRatio`/`warmRatio` с Solid из того же прогона (без `--strict` — предупреждение).

### Бенчмарки

- SSR и гидрация измеряют скомпилированные приложения (`bench/fixtures/silent-app.tsx`), а не ручные вызовы `templateHoles`/`insert`.
- Добавлены размер SSR-разметки (байты/gzip) и расход памяти (heap на гидрацию в jsdom и Chromium).
- Все наборы ограничены четырьмя CPU (`scripts/bench-cpus.mjs`).
- `pnpm bench:guard` сравнивает результаты с `scripts/bench-baseline.json` и падает при регрессе размера/сборки/соотношения; шаги добавлены в CI. Если провалилась шумная `browser.ratio`, браузерный прогон повторяется до двух раз и берётся лучшее значение; без `--strict` `browser.ratio`/`hydrate.ratio`/ops/s считаются предупреждением, абсолютные `silentOps` и размеры — ошибкой.

### Надёжность

- Golden-тесты SSR-разметки (9 сценариев), обновление через `SILENT_UPDATE_GOLDEN=1`.
- Fuzz-тесты гидрации: 150 повреждений разметки с проверкой отката и чистоты DOM.
- Снимок публичного API (`scripts/api-snapshot.json`).
- `pack-check` проверяет отсутствие `bench/`/`crates/`/тестов в npm-пакетах.

## 0.6.2

Оптимизация SSR, гидрации и скорости сборки без изменения публичного API.

### Производительность

- `renderToString`: общий буфер сериализации, `RawNode.renderInto`, ленивая запись значений в слоты без промежуточных строк и массивов, быстрый путь `createComponent` для metadata-free узлов, флаг metadata-free вместо `WeakSet`, отказ от пересоздания DOM-глобалов на каждый рендер (`keepShape`). 35 497 → 99 900 ops/s (+181%), разрыв с Solid сокращён с ~5× до ~2×.
- Гидрация: plan-based adoption для шаблонов без метаданных, курсорный `shapeMatches`, отказ от `cloneNode(true)`, кэш планов. 677 → 1 368 ops/s (+102%); в сравнении с Solid — 0.61×.
- `For`/`Index` и реактивность: сохранены ускорения предыдущего релиза.

### Сборка

- Warm `pnpm build`: 2.2 s → 0.46 s. `scripts/build-native.mjs` пропускает `napi build`, если Rust-артефакты свежие; `--force` — для принудительной сборки.
- Vite-плагин кэширует JSON опций и загрузку SWC.
- Инкрементальная компиляция TypeScript в пакетах.

### Компилятор

- Статические JSX-шаблоны выносятся в модульные `const _tmpl$N = _$templateHoles(...)` и дедуплицируются в пределах модуля.
- `template`/`templateHoles` стали ленивыми: backend выбирается при вызове фабрики, поэтому хойстинг безопасен для SSR.
- Исправлена гидрация текста, переданного геттером сигнала (`{count}`): начальный эффект теперь разрешает функцию и подписывается на сигнал.

### Бандл

- Стартовый JS mount-only приложения: 35.7 → 26.4 KB min (12.25 → 9.5 KB gzip). View/VM/DI-рантайм вынесен в lazy-чанк `component-view` (8.98 KB / 3.66 KB gzip) и загружается только при наличии ViewModel.
- Новая опция Vite-плагина `view: false` для приложений без ViewModel: стартовый JS 23.2 KB / 8.3 KB gzip, без lazy-чанка и `vite/preload-helper`.
- `hydrate` вынесен из `mount`; структурная гидрация, DOM-гидрация (`settleNodes`/`writeRegion`/`insertHydrated`) и server-only код вынесены из стартового графа за реестры, `component-lite` не тянет DI, registry, boundary. Тяжёлый гидрационный рантайм грузится из `hydrate()` динамическим `import()`.
- `pnpm bench:build` теперь отдельно показывает `start JS`, `start gzip` и `all JS` для обоих режимов.

### Бенчмарки

- `pnpm bench:build`: одинаковые приложения Silent и Solid. Silent `view: false` — 56/27 ms и 23.2 KB стартового JS; Silent с VM — 32/26 ms, 26.4 KB стартового JS и 38.8 KB с lazy-чанком; Solid — 147/40 ms и 12.6 KB.
- `pnpm bench:hydrate`: Silent 1 368 ops/s против Solid 2 249 ops/s в jsdom.
- `pnpm bench:browser`: в Chromium Silent 8 746 ops/s против Solid 27 372; узлы переиспользуются, обработчики подключаются. Числа плавают ±10%.
- `pnpm bench:ssr`: Silent 99 900 против Solid 206 300 ops/s.

### Прочее

- AVX2, LTO и аллокатор не менялись: LTO уже `thin`, mimalloc отсутствует (`allocator_node` удалён ранее).
- Dev-зависимости для Solid-бенчмарков добавлены только в приватный `bench`, в публикуемые пакеты не попадают.
- Версия `0.6.2` — патч: перф и внутренний рефакторинг без изменения публичного API.

## 0.6.1

Рефакторинг и оптимизация без изменения публичного API.

### Производительность

- Реактивность: прямой обход наблюдателей без `Array.from`, меньше промежуточных объектов на запуск эффекта. `signal: 10k writes` 294 → 368 ops/s, batched writes 3 735 → 7 646, memo chain 151 → 196, `effect → textContent` 164 → 183, deep reactive 119 → 132.
- `For`/`Index`: быстрые пути реконсиляции, один `DocumentFragment` на пачку, переиспользуемые typed-array буферы, ленивые сигналы элемента. keyed list: create 43 → 65 ops/s, append 507 → 965, reorder 350 → 1 358.
- DOM: кэш разбора шаблонов, план частей для `templateHoles`, кэши `hyphen` и событий, меньше аллокаций в стилях и атрибутах.
- SSR: общий LRU-кэш разобранных шаблонов между рендерами, одно-проходное экранирование, `RawNode` без строковых цепочек, переиспользование документа и бэкенда. `renderToString` 30 720 → 35 497 ops/s, гидрация 497 → 677.

### Сборка

- Убраны неиспользуемые фичи `swc_core`, из графа зависимостей ушли `swc_malloc`/mimalloc, `swc_nodejs_common`, `swc_ecma_quote_macros`: чистая release-сборка 136.7 s → 104.4 s (−23.6%).
- Инкрементальная компиляция TypeScript в пакетах.
- Vite-плагин кэширует JSON опций и загрузку SWC.

### Версионирование

- `pnpm version:bump patch|minor|major`, `--set X.Y.Z` и `--dry-run`: синхронно обновляет 7 `package.json`, `Cargo.toml` и заголовок `CHANGELOG.md`.
- `pnpm version:check` и `scripts/verify-versions.mjs` в release CI проверяют совпадение версий и тега.
- `docs/releasing.md`: правила semver и процесс релиза. Патч-версия обязательна для исправлений, производительности и внутреннего рефакторинга.

## 0.6.0

### Производительность

- Строковый SSR-бэкенд: для шаблонов без динамических атрибутов (`data-silent-a-*`) и метаданных `templateHoles` создаёт `RawNode`, а `insert` записывает готовые строки в слоты; для остальных случаев остаётся мини-DOM.
- Кэш разбора серверных шаблонов на время `renderToString`.
- `renderToString` на 20 элементах: 13 500 → 34 000 ops/s (2.5x от начала оптимизаций).
- Гидрация и e2e на реальном приложении — без изменений.

## 0.5.0

### Производительность

- SSR: `installDomGlobals` кэширует дескрипторы глобалов, сериализатор не делает лишних `replace`/`join`, из `renderToString` убраны фиксированные микротаски (`hasPendingWork`). `renderToString` на 20 элементах: 13 500 → 21 500 ops/s.
- `ComponentContext.signal` создаётся лениво: VM без чтения `signal` не платит за `AbortController` (`createComponent` с VM: 20 → 10 µs).
- `For` вставляет новые строки одним `DocumentFragment`, `disposeOwnerChildren` не копирует `Set` в массив.
- Шаблоны без метаданных помечаются и пропускают обход в `extractMetadata`.
- SPA-бенчмарк: примитивы 1.04–1.37x от Solid, перестановки списка 0.82x.

## 0.4.0

### Качество

- `cargo clippy -D warnings` в CI; исправлены 7 замечаний в `silent-transform` (мёртвый параметр, лишние `Ok/?`, `clone` для `Copy`, `Box::new` при замене).
- Бенчмарк `pnpm bench:ssr`: SSR против Solid и гидрация Silent.
- Скрипт `pnpm deprecate:legacy` для пометки старых `@ivlev98/silent-*` (нужен `NPM_TOKEN`).

## 0.3.0

### Документация

- `docs/getting-started.md` — создание проекта, первый ViewModel и view, жизненный цикл, control flow, SSR.
- Гайды: `docs/guides/ssr.md`, `docs/guides/hydration.md`, `docs/guides/di.md`, `docs/guides/migration-from-solid.md`.

### Примеры

- `examples/ssr-counter` — SSR с реальным HTTP-сервером: dev-режим через middleware Vite и продакшен-режим со статикой.

### Пакеты

- Метапакет `@ivlev-dev/silent`: рантайм и Vite-плагин одной установкой.
- Проверка наличия README в tarball метапакета; `install:check` и `pack:check` покрывают новый пакет.

### Компилятор

- Исправлено: маркеры `data-silent-a-N` у RCDATA-элементов (`title`, `textarea`) больше не попадают в текст, а остаются в открывающем теге.

## 0.2.0

### Управляющие конструкции

- `Index` — неключевой список: узлы закреплены за позициями, меняется только содержимое.
- `Switch` / `Match` — выбор первой правдивой ветки с `fallback`.
- `ErrorBoundary` — перехват синхронных ошибок рендера и асинхронных ошибок дочерних view; `fallback(error, reset)`.
- Гидрация `Index`, `Switch` и `ErrorBoundary` с адоптацией серверных узлов.

### Метаданные

- `<meta>` и `<link>` из любого компонента выносятся в `<head>` вместе с `<title>`; элементы с `itemprop` и содержимое `<svg>` не трогаются.

### SSR

- `renderToStream` отдаёт тело чанками (`chunkSize`), `head` приходит в `onHead` до первого чанка.

## 0.1.2

- Подробные русскоязычные README в каждом пакете: возможности, установка, быстрый старт, API и ограничения.
- Проверка наличия `README.md` в tarball'ах (`pnpm pack:check`).

## 0.1.1

- Пакеты перенесены в scope `@ivlev-dev`: `@ivlev-dev/silent-reactivity`, `@ivlev-dev/silent-di`, `@ivlev-dev/silent-core`, `@ivlev-dev/silent-swc`, `@ivlev-dev/silent-vite`, `@ivlev-dev/silent-server`.
- Пакеты `@ivlev98/silent-*` объявлены устаревшими.

## 0.1.0

Первый публичный релиз Silent Framework.

### Реактивность (`@ivlev-dev/silent-reactivity`)

- Сигналы, мемо, эффекты, `createRoot`, `onCleanup`, `batch`, `flushSync`.
- Глубокие прокси для объектов и массивов: отдельный сигнал на каждое свойство/индекс, мутирующие методы массивов.
- Store-примитивы для `@reactive`-полей: `readField`, `writeField`, `getComputed`, `copyReactiveState`.

### Dependency Injection (`@ivlev-dev/silent-di`)

- Асинхронный контейнер без декораторов: `bind`, `createScope`, `resolve`, `peek`, `has`, `dispose`.
- Интерфейсы и автопоиск реализаций через индекс, кеш промисов, обнаружение циклов, `CircularDependencyError`.

### Ядро (`@ivlev-dev/silent-core`)

- MVVM: view получает ViewModel через `this`, `import type` для VM и прелоадера.
- Stage-3 декораторы `@reactive`, `@computed`, `@watch`, класс `ViewModel` с доступом к `props`/`view` и lifecycle-хуками.
- `mount`, прелоадеры, обработка ошибок, наследование DI-скоупа.
- `For`, `Show`, `Suspense`, `lazy`, `fragment`.
- Гидрация серверной разметки с сохранением узлов (`hydrate`), `HydrationMismatchError`, `onMismatch`.
- Вынос `<title>` в `<head>` из любого компонента (как в React 19), исключения `<svg>`/`itemProp`.
- HMR с сохранением состояния ViewModel.

### SSR (`@ivlev-dev/silent-server`)

- `renderToString` с собственным мини-DOM: парсер шаблонов компилятора, `Document`, `TreeWalker`, сериализатор, отражение `style`/`value`, no-op события.
- Асинхронные ViewModel, `Suspense` и `lazy` дожидаются до сериализации.
- `RenderResult.head` с метаданными (`<title>`), серверные маркеры для гидрации.

### Компилятор (`@ivlev-dev/silent-swc`)

- Нативный addon на `swc_core` с `lto = "thin"`.
- Компиляция JSX в шаблоны, метаданные view, DI-фабрики из конструкторов, RCDATA-элементы (`textarea`/`title`) без комментариев-хуков.
- `transform`, `scan`, `version`.

### Vite (`@ivlev-dev/silent-vite`)

- Полная компиляция TS/TSX через SWC, source maps, HMR, индекс DI.
- Дефолтные настройки: `target: es2024`, полный HMR.

### Неймспейс

- Пакеты публикуются под scope `@ivlev98`: `@ivlev98/silent-reactivity`, `@ivlev98/silent-di`, `@ivlev98/silent-core`, `@ivlev98/silent-swc`, `@ivlev98/silent-vite`, `@ivlev98/silent-server`.

### Документация и качество

- Справочник API по пакетам (`docs/api/`) с автопроверкой полноты (`pnpm api:check`).
- Архитектурные контракты, гайд по SSR и гидрации.
- Бенчмарк против SolidJS (`pnpm bench`) и сквозные проверки SSR/гидрации.
- Пакеты публикуются как ESM с явными `.js`-расширениями и загружаются в чистом Node.
