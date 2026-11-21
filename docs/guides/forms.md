# Формы и SSR

Пример `examples/forms` показывает полный цикл: сервер рендерит форму через `renderToString`, клиент адоптирует разметку через `hydrate`, после чего ввод, валидация и отправка работают как в обычном SPA. Отдельно разобран `formId`, потому что от него зависят `id` полей и связи `label`/`for`, `aria-describedby`.

## Что рендерится на сервере

Разметка строится тем же кодом, что и на клиенте: `App` → `AppVM` → `ProfileForm`. На каждый запрос `renderToString` создаёт новый request scope, а `AppVM` привязан как transient — поэтому форма и её поля не переживают запрос:

```tsx
// examples/forms/src/entry-server.tsx
import { Container } from "@ivlev-dev/silent-di";
import { renderToString } from "@ivlev-dev/silent-server";
import { App } from "./app";
import { AppVM } from "./app.vm";

export async function render(url = "/"): Promise<{ html: string; head: string }> {
  const container = new Container("forms-ssr", undefined, {
    implicitBindings: "error",
  });
  container.bind(AppVM, AppVM).inTransientScope();
  try {
    return await renderToString(App, { container });
  } finally {
    container.dispose();
  }
}
```

`renderToString` сам сериализует `title`/`meta` в `head` и дожидается асинхронной готовности формы. Возвращённый `html` содержит серверные маркеры гидрации (`silent-*`, `data-silent-*`) — вставляйте его в контейнер как есть.

`index.html` служит шаблоном и для dev, и для production-сборки:

```html
<head>
  <!--app-head-->
</head>
<body>
  <div id="app"><!--app-html--></div>
  <script type="module" src="/src/entry-client.tsx"></script>
</body>
```

## Гидрация

Клиент не монтирует приложение заново, а адоптирует серверные узлы:

```tsx
// examples/forms/src/entry-client.tsx
const container = new Container("forms-example", undefined, {
  implicitBindings: "error",
});
container.bind(AppVM, AppVM).inTransientScope();

await hydrate(root, App, {
  container,
  onMismatch: (error) => console.warn(`[forms] гидрация: ${error.message}`),
});
```

Вход запускается после `DOMContentLoaded` (или сразу, если DOM уже готов). `hydrate` умеет работать и с пустым `#app`: тогда он откатывается на клиентский рендер. Благодаря этому один и тот же `entry-client` подходит для SSR и для обычного `vite dev` без серверного рендера.

`src/main.tsx` оставлен тонкой обёрткой над `entry-client` — его можно подключать в dev-сценариях, где SSR не нужен.

## `formId` и стабильные `id`

`ProfileForm` создаётся с фиксированным `formId`:

```ts
readonly form = new ProfileForm({ formId: "profile" });
```

Отсюда берутся предсказуемые идентификаторы:

| Поле | `id` |
| --- | --- |
| Имя | `profile-name` |
| Email | `profile-email` |
| Город | `profile-address.city` |
| Регион | `profile-address.state` |

Сервер и клиент строят одну и ту же форму одним и тем же кодом, поэтому `id` совпадают. Это важно для гидрации: `label[for]`, `aria-describedby` и `aria-invalid` ссылаются на конкретные узлы, и при расхождении `hydrate` может откатиться на клиентский рендер.

Не полагайтесь на автоматические имена классов или счётчики: при минификации и при разном порядке создания форм они могут измениться. `formId` фиксирует идентификаторы явно. Вложенная форма адреса получает префикс родителя (`address.city`), поэтому её `id` тоже стабильны.

## Что сохраняется после гидрации

Серверная разметка уже содержит:

- `required` и `aria-required="true"` у обязательных полей;
- звёздочку `<span aria-hidden="true"> *</span>` в `label`;
- `placeholder`, `autocomplete`, `aria-describedby`, `hint`;
- начальные значения полей из декораторов (`age = 18`);
- `novalidate` и кнопку отправки, заблокированную до готовности формы.

После `hydrate` эти атрибуты не пересоздаются, а остаются на адоптированных узлах. Ошибки валидации на сервере не рендерятся: они появляются после ввода/blur или попытки отправки. В примере это проверяется сценарием `scripts/ssr-e2e.mjs`: невалидный email даёт `role="alert"`, пустой город — ошибку обязательного поля, корректные значения — сообщение «Профиль сохранён».

## Состояние и начальные значения

Состояние формы **не сериализуется автоматически**. На сервере и клиенте должны получиться одинаковые начальные значения, иначе разметка разойдётся. Есть два подхода:

1. Значения заданы в самой форме (декораторы, инициализаторы полей) — как в примере.
2. Данные приходят из БД/сессии: сериализуйте их в документ и примените до гидрации либо передайте через props и `setValues` на обеих сторонах.

```ts
// одинаково на сервере и клиенте
const container = new Container("forms");
container.bind(AppVM, () => {
  const vm = new AppVM();
  vm.form.setValues({ name: data.name, email: data.email });
  return vm;
});
```

Если сервер отрендерил значения, а клиент стартует с пустыми, `hydrate` увидит расхождение `value` и перерисует форму клиентски. Это не ошибка ввода, а несовпадение начального состояния.

Серверные ошибки (`setFieldErrors`) тоже не передаются автоматически: если они нужны после перезагрузки, их нужно сериализовать вместе с данными и применить до гидрации.

## Сборка и запуск

```bash
pnpm --filter @ivlev-dev/silent-example-forms build
pnpm --filter @ivlev-dev/silent-example-forms start   # NODE_ENV=production
curl -s http://localhost:5176/ | grep profile-name
```

Скрипты примера:

| Скрипт | Что делает |
| --- | --- |
| `dev` | `node server.mjs`: Vite в middleware-режиме + SSR на каждый запрос |
| `build:client` | `vite build` → `dist/client` (хешированные ассеты и `index.html`) |
| `build:ssr` | `vite build --ssr src/entry-server.tsx --outDir dist/server` |
| `build` | клиентская и серверная сборки |
| `start` | production-сервер поверх `dist/client` и `dist/server` |

`vite.config.ts` держит рантайм и пакеты формы внешними для SSR:

```ts
export default defineConfig({
  plugins: [silent()],
  build: { outDir: "dist/client" },
  ssr: {
    external: [
      "@ivlev-dev/silent-core",
      "@ivlev-dev/silent-di",
      "@ivlev-dev/silent-form",
      "@ivlev-dev/silent-reactivity",
      "@ivlev-dev/silent-server",
      "@ivlev-dev/silent-validation",
    ],
  },
});
```

Без `ssr.external` Vite встроит вторую копию `@ivlev-dev/silent-core` в серверный граф: у приложения и `renderToString` окажутся разные `whenIdle`/`setServerMode`, и асинхронная готовность формы перестанет работать.

`server.mjs` в dev грузит `entry-server.tsx` через `vite.ssrLoadModule`, в production — `dist/server/entry-server.js`; статика отдаётся из `dist/client`, ошибки рендера возвращают 500. Порт по умолчанию — `5176`, переопределяется через `PORT`.

## Ограничения

- Состояние формы, файлы и серверные ошибки не сериализуются автоматически.
- `<input type="file">` нельзя восстановить из HTML: после гидрации файл нужно выбирать заново. Поэтому `avatar` в примере — обычное поле с ручной загрузкой.
- Нельзя опираться на `window`/`document` во время серверного рендера: код формы должен выполняться в обоих окружениях.
- `renderToString` сериализует рендеры внутри процесса, поэтому под нагрузку масштабируйте процессами Node, а не параллельными вызовами в одном процессе.
- Кнопка отправки заблокирована, пока `form.isReady === false` (обязательные поля пусты или идёт валидация). После неудачной попытки отправки форма остаётся неготовой, пока ошибки не исправлены — это ожидаемое поведение, а не баг примера.

## Проверки

```bash
pnpm --filter @ivlev-dev/silent-example-forms typecheck
pnpm --filter @ivlev-dev/silent-example-forms build
pnpm test:ssr
pnpm test:e2e
```

`pnpm test:ssr` поднимает Vite-SSR, проверяет HTML формы (id, `required`, звёздочки, отсутствие ошибок), гидрирует страницу в Chromium, вводит значения, получает ошибки и успешную отправку, затем проверяет production-сервер из `dist/server`, если сборка уже выполнена. Обычный `pnpm test:e2e` проверяет ту же форму в режиме клиентского монтирования.
