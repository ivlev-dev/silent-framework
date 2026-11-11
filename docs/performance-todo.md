# План производительности

Текущее состояние (`0.6.2`): `renderToString` 99 900 ops/s (Solid 206 300), гидрация 1 368 ops/s в jsdom и ~8 746 ops/s в Chromium против 27 372 у Solid (0.32x), warm `pnpm build` 0.46–0.54 с, Vite build приложения Silent 56/27 мс против Solid 147/40 мс, стартовый JS 23.2 KB / 8.3 KB gzip с `view: false` и 26.4 KB / 9.5 KB gzip в default-режиме с lazy view-чанком (+8.98 KB для VM) против 12.6 KB у Solid.

## M1. Компиляторный хойстинг шаблонов

- [x] Ленивые фабрики `template`/`templateHoles`: выбор серверного/клиентского backend при вызове, а не при создании.
- [x] Вынос статических `_$templateHoles("<html>")` в модульные `const _tmpl$N`.
- [x] Повторное использование одинаковых шаблонов в пределах модуля.
- [x] Регрессионные тесты компилятора и runtime.
- [x] Замер на скомпилированных приложениях: build/bundle и браузерные фикстуры (`bench/build`, `bench/browser`).

## M2. Строковый SSR

- [ ] SSR-режим компилятора: JSX → строковая конкатенация без `templateHoles`/`insert` и мини-DOM.
- [ ] Строковые дыры для динамических атрибутов (`class`, `style`, spread).
- [ ] Внутренний `ssr-runtime` с `escape`/`escapeAttr`/`serializeValue` без объектов-узлов.
- [ ] `renderToString` fast-path для строкового результата без `installDomGlobals`.
- [ ] Скомпилированный SSR-бенчмарк Silent vs Solid.
- [ ] Цель: паритет с Solid на простых шаблонах, обгон на списках/тексте.

## M3. Гидрация

- [x] Plan-based adoption для шаблонов без метаданных.
- [x] Курсорный `shapeMatches` без массивов и `NamedNodeMap`-прокси.
- [ ] Компиляторные гидрационные ключи (`data-silent-hk` или аналог) вместо структурного поиска.
- [ ] Гидрация без материализации клиентского дерева: для статических узлов шаблона не вызывать `createElement`/`createTextNode`, а привязывать эффекты к найденным серверным узлам. Это главный рычаг: Solid почти ничего не создаёт, а Silent строит всё дерево и только потом переиспользует узлы.
- [ ] Пропуск полной проверки формы для доверенной SSR-разметки с ключами.
- [ ] Инкрементальная/ленивая гидрация статических поддеревьев.
- [x] Бенчмарк гидрации в реальном Chromium (`pnpm bench:browser`): Silent 8 746 vs Solid 27 372 ops/s.
- [x] Бенчмарк отделяет подготовку от гидрации: таймер уже не включает `innerHTML`, добавлен столбец «разбор» (контейнер + `innerHTML`). По p50: гидрация silent 0.205 ms против solid 0.065 ms (3.2×), разбор разметки 0.09 против 0.05 ms (в ops/s не входит).
- [x] Замеры стоимости: проверка атрибутов в `shapeMatches` на скорость не влияет (jsdom 1 308 против 1 368, Chromium 8 429 против 8 746 — шум), `cloneNode(true)` для снимка разметки дороже `innerHTML` (7 999 против 9 299).
- [x] Не читать `innerHTML` для отката, когда откат невозможен (сборка без ViewModel или view-рантайм уже загружен).
- [x] Этап A: `settle()` без двойного `whenIdle`/`flushSync` и удаление региона одним `Range.deleteContents()` вместо поштучных `removeChild`. В бенчмарке изменения не видны (8 549 и 7 940 против 8 233–9 090 до, p50 0.095 без изменений) — значит микро-накладные расходы не главное.
- [x] Починить подписку при гидрации, если текст передан геттером сигнала (`{count}` вместо `{count()}`).
- [ ] Цель: ≥ Solid hydrate на сопоставимом приложении.
- [x] Разобрать фиксированные 68 µs по фазам внутри `hydrate()`: `createRootResult` — 99% времени (295 из ~300 µs под профилировщиком), `ready` 0.5, `settle` 3.5, `cleanup` 3.5 µs. Асинхронная цепочка и удаление границ — не проблема, этап A был не тем местом.
- [x] Внутри `create`: адопция шаблонов (`claimNext` + `shapeMatches` + `applyPartsPlan`) ≈ 36%, остальное — `createRoot`/owner, эффекты, вставка значений. Отказ от сверки атрибутов даёт ~4% — в пределах квантования `performance.now()` (приблизительно 100 µs), поэтому мелкие фазы этим способом не измерить.
- [ ] Убрать снимок `innerHTML` в default-режиме (откат через полный клиентский рендер): замерено +6% (8 746 → 9 299).
- [x] Разделить фиксированную и построчную стоимость: прогон с `ROWS = 1` дал silent 0.068 ms и solid 0.020 ms (0.30x), с `ROWS = 20` — 0.110 и 0.037 ms (0.30x). Наклон: 2.2 µs на строку у silent против 0.86 у solid; фиксированная часть — ~68 µs, то есть две трети времени гидрации. Оптимизация обхода шаблонов сама по себе разрыв не закроет: сначала надо убрать фиксированные накладные расходы `hydrate()` (комментарии-границы, `createRoot`/owner, цепочка `await` + `whenIdle` + два `flushSync`, `disposeInstance` с удалением каждого узла).

## M4. SSR: дальнейшие идеи

- [ ] Убрать мутацию `globalThis` из горячего пути: DOM-контекст/`AsyncLocalStorage` для core.
- [x] Убрать пересоздание/удаление DOM-глобалов на каждый рендер: `installDomGlobals(..., { keepShape: true })` оставляет свойства на `globalThis` со значением `undefined` вместо `delete`, иначе каждый вызов переводил глобальный объект в dictionary mode. 53 300 → 99 900 ops/s (+87%).
- [ ] Переиспользование буферов и `RawNode`-слотов в пределах одного рендера.
- [ ] Пул строковых буферов и один `join` на рендер.
- [ ] Быстрый путь для синхронных приложений без VM/preloader (меньше микротасок).
- [ ] Кэш скомпилированных рендер-функций шаблонов.
- [ ] Опциональный режим без hydration-маркеров для негидрируемого SSR.
- [ ] Оптимизация `renderToStream`: чанки без повторной сериализации.
- [ ] Статическая предгенерация неизменяемых поддеревьев.

## M5. Клиентский рантайм

- [ ] Хойстинг одинаковых шаблонов между компонентами одного модуля (M1).
- [ ] Склейка соседних статических текстовых узлов в шаблоне.
- [ ] Меньше замыканий/owner'ов на элемент списка.
- [ ] Event delegation для повторяющихся списков.
- [ ] Быстрый diff стилей и `spread` без повторного разбора.
- [ ] Проверить, что `For`/`Index` не регрессируют на больших списках.

## M6. Скорость сборки

- [x] Пропуск `napi build` при свежих артефактах (`scripts/build-native.mjs`).
- [x] Кэш JSON опций и загрузки SWC в Vite-плагине.
- [x] Инкрементальный TypeScript.
- [ ] `tsc -b`/project references, если даст заметный выигрыш без риска для `dist`.
- [ ] Персистентный кэш transform по хэшу содержимого (dev + build).
- [ ] Пропуск пересборки неизменившихся пакетов на уровне pnpm.
- [ ] Кэш нативных артефактов по хэшу содержимого, а не только mtime.
- [ ] Сравнение cold/warm build с Solid в CI (`pnpm bench:build`).

## M7. Размер бандла

Факты по `bench:build/silent` (36.5 KB min / 12.25 KB gzip против 12.6 KB у Solid), по данным `rollup-plugin-visualizer` (rendered / gzip):

- `core/dom.js` — 18.3 / 4.58 KB
- `core/component.js` — 14.5 / 4.02 KB
- `core/control-flow.js` — 11.8 / 3.25 KB
- `reactivity/graph.js` — 8.5 / 2.21 KB
- `core/hydration.js` — 8.5 / 2.08 KB
- `di/container.js` — 5.7 / 1.62 KB
- `core/metadata.js` — 2.9 / 1.05 KB
- `reactivity/store.js` — 1.5 / 0.61 KB
- `core/mount*` — 1.8 / 0.87 KB
- `registry`, `component-context`, `boundary`, `server-backend`, `server-hole` — по 0.2–0.35 KB gzip

Причины: mount-приложение платит за hydrate, view/VM/DI-путь, `copyReactiveState`, серверные ветки DOM и полный `For`. `createComponent` статически тянет `createViewResult`, DI и hydration, поэтому tree-shaking не может их выбросить.

- [x] Анализ бандла через `rollup-plugin-visualizer` (временная зависимость удалена).
- [x] Вынести `hydrate` из `mount.ts` в отдельный модуль (нужно для code-splitting).
- [x] Разделить `component-lite` (meta === null) и `component-view` (VM/DI/preloader/hydration).
- [x] В `mount`/`hydrate` для компонентов без VM использовать light-путь, для VM — динамический import view-рантайма.
- [x] Убрать `copyReactiveState`/`store`, `registry`, `component-context`, `boundary`, DI из стартового light-пути.
- [x] `bench:build` теперь показывает `start JS`, `start gzip` и `all JS` отдельно.

Результат: стартовый JS **35.7 → 29.7 KB min (12.25 → 10.2 KB gzip)**, lazy `component-view` — 8.98 KB / 3.66 KB gzip. Стартовый чанк всё ещё содержит `dom.js` 4.58 KB gzip, `control-flow.js` 3.25, `graph.js` 2.21, `hydration.js` 2.08, `vite/preload-helper` 1.32.

- [x] Убрать структурную гидрацию из стартового чанка через `hydration-state`/`hydration-proxy`; ленивый view-рантайм регистрирует её при загрузке.
- [x] Вынести DOM-гидрацию (`settleNodes`/`writeRegion`/`insertHydrated`) в `dom-hydration` за реестр `dom-hydration-state`; тяжёлый `hydration`-рантайм грузится из `hydrate()` динамическим `import()`, поэтому в mount-only сборке его нет.
- [x] Вынести server-only `server-backend`/`server-hole` за `server-state`/`server-proxy`.
- [x] Добавить `view: false` в Vite-плагин: без VM-рантайма и dynamic import, без `vite/preload-helper`.
- [x] `start JS` для counter+list: 35.7 → **27.0 KB** (default, VM lazy) и **23.9 KB** с `view: false`; Solid 12.6 KB.
- [x] `start JS` после выноса DOM-гидрации: **26.4 KB** (default) и **23.2 KB** с `view: false`; Solid 12.6 KB.
- [x] `bench:build` отдельно считает `start JS`, `start gzip`, `all JS`.
- [x] Бюджет ≤ 25 KB start для `view: false` достигнут.
- [ ] Дожать default-режим (27.0 KB): `dom` 4.58 KB gzip, `control-flow` 3.25, `graph` 2.21, `metadata` 1.05, `component-lite` 0.93.
- [ ] Проверить размер `For`/`Show` и сгенерированного кода (соседние тексты, лишние обёртки).
- [ ] Разделить client/server entry через package `exports`/условия `browser`/`node`.
- [ ] Убрать неиспользуемые helper'ы из сгенерированного кода.

## M8. Бенчмарки и регрессии

- [x] SSR Silent vs Solid (`pnpm bench:ssr`).
- [x] Гидрация Silent vs Solid (`pnpm bench:hydrate`).
- [x] Сборка одинаковых приложений (`pnpm bench:build`).
- [x] Браузерные бенчмарки через Playwright (`pnpm bench:browser`).
- [ ] Скомпилированные приложения вместо ручных runtime-хелперов (для SSR и runtime).
- [ ] Память/GC и размер HTML.
- [ ] CI-порог регрессии по ops/s и времени сборки.
- [x] Скрипт CPU-профиля с топом функций.

Профиль Chromium (`pnpm bench:profile silent`) по 200 гидрациям: `(program)` 33.9%, GC 7.8%, `removeChild` 5.1%, а остальное размазано по минифицированным функциям `index`/`hydration`/`hydration-state` чанков. Вывод: узкого места в нашей логике нет — стоимость распределена между аллокациями, GC и DOM-операциями; одним из самых заметных остаётся `removeChild` при `dispose()` и очистке регионов.

## M9. Нативный компилятор (отложено)

- [ ] LTO: уже `thin`; оценить `fat` отдельным профилем.
- [ ] AVX2: runtime-dispatch baseline + AVX2.
- [ ] Аллокатор: mimalloc отсутствует; при необходимости сравнить jemalloc.

## M10. Надёжность

- [ ] Golden-тесты SSR-разметки (маркеры, атрибуты, порядок).
- [ ] Fuzz/негативные тесты гидрации.
- [ ] Снимок публичного API в CI.
- [ ] Проверка, что bench-зависимости не попадают в npm-пакеты.
