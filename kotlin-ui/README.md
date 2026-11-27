# Silent UI для Kotlin (MVP)

Самостоятельный Gradle-проект: общий `core`, desktop-рендерер на Skiko и Android-рендерер на `View` + `Canvas` + нативные `EditText`. Без Compose, без внешних UI-фреймворков.

## Структура

```
kotlin-ui/
├── core/        Kotlin/JVM: сигналы, ViewModel/View, DI, формы, токены, layout, виджеты, UiRenderer, демо
├── desktop/     JVM + Skiko: окно, Painter, Java Swing overlay для IME, offscreen-скриншоты
├── android/     com.android.application: Canvas-рендерер, EditText overlay, системная тема
├── ksp/         KSP-процессор: индекс реализаций и фабрики конструкторов для DI
├── tools/       Трансформер исходников @Reactive/@Computed/@Watch
├── buildSrc/    Gradle-задача transformReactive
├── settings.gradle.kts
├── build.gradle.kts
└── gradle.properties
```

Версии: Kotlin `2.2.20`, KSP `2.2.20-2.0.4`, AGP `9.5.2`, compileSdk/targetSdk `37`, minSdk `26`, JVM target `17`, toolchain `21`. Skiko `0.156.1`, runtime `linux-x64`.

## Запуск

```bash
cd kotlin-ui

gradle :core:test
gradle :desktop:test
gradle :desktop:run

gradle :android:assembleDebug
# APK: android/build/outputs/apk/debug/android-debug.apk
adb install -r android/build/outputs/apk/debug/android-debug.apk
```

Скриншоты desktop (offscreen Skia, без открытия окна):

```bash
gradle :desktop:run --args="--screenshot /tmp/silent-ui-login.png"
gradle :desktop:run --args="--screenshot /tmp/silent-ui-dashboard.png --dashboard --size=1440x900"
gradle :desktop:run --args="--screenshot /tmp/silent-ui-4k.png --dashboard --size=3840x2160"
gradle :desktop:run --args="--screenshot /tmp/silent-ui-mobile.png --dashboard --size=390x844"
gradle :desktop:run --args="--screenshot /tmp/silent-ui-settings.png --dashboard --nav=settings --size=1440x900"
gradle :desktop:run --args="--screenshot /tmp/silent-ui-hover.png --gallery --hover --size=1440x900"
gradle :desktop:run --args="--gallery --hover=button"
```

Desktop UI scale: `SILENT_UI_SCALE=1.5` — override, `--ui-scale=2` — для snapshot. По умолчанию масштаб считается от высоты экрана в user space: 1080p → 1.0, 1440p → 1.33, 2160p → 2.0; при OS-масштабировании (`defaultTransform.scaleX > 1`) остаётся 1.0, потому что surface уже масштабирован. Стартовое окно — `1440×900 dp × uiScale` (минимум 1280×850, не больше рабочей области). `SILENT_UI_RENDER_API=software` включает software Skiko. Android-скриншоты: `adb exec-out screencap -p > /tmp/android.png`; для 390×844 `wm size 1170x2532` + `wm density 480`.

Первый запуск скачивает Skiko, KSP и Android-зависимости из Maven Central/Google. SDK ожидается в `/opt/android-sdk` (или через `ANDROID_HOME`).

## Архитектура

### Реактивность

- `Signal<T>` — чтение; чтение внутри `Effect`, `Computed` или `DependencyTracker` подписывает.
- `MutableSignal<T>` — запись через `set`/`update`; уведомления батчатся (`batch { ... }`) и дедуплицируются по эффекту.
- `Computed<T>` — ленивый, мемоизированный, сам управляет подписками на зависимости.
- `Effect` и `Scope` — запуск, перезапуск, каскадное освобождение.
- `DependencyTracker` — используется платформами: один проход раскладки/рисования собирает зависимости, изменение любого сигнала вызывает перерисовку. Это же обеспечивает «регидрацию» `View` при изменении состояния.

### ViewModel, View, hooks

```kotlin
class LoginVM(private val auth: AuthApi) : ViewModel() {
    @Reactive var serverMessage = ""
    @Computed val canSubmit get() = form.isValid && !form.isSubmitting.value

    @Watch("serverMessage")
    fun onMessage(next: String, prev: String) { /* ... */ }

    override fun created() { /* ... */ }
}
```

Hooks: `created`, `beforeMount`, `mounted`, `updated`, `beforeUnmount`, `unmounted`, `onDispose`; `dispose()` (открытый для override) запускает всю цепочку. `scope` освобождает сигналы/эффекты, созданные в VM. `mounted` и `disposed` доступны как свойства.

`View { fun content(): Widget }`; `component(vm, view)` и `screen(vm)` монтируют VM при первом измерении и освобождают при `dispose()` компонента.

### Аннотации без декораторов

До компиляции `:core` запускается `transformReactive`:

- `@Reactive var email = ""` → `var email by reactive("email", "")`
- `@Computed val canSubmit get() = ...` → memoized `Computed`, зарегистрированный по имени
- `@Watch("email", immediate = true)` → `watchOf("email", true)` с типизированными аргументами и `(next, prev)`

Трансформер поддерживает однострочные и блочные `get() = ...`, явные типы, `immediate`; `deep` зарезервирован. IDE видит исходные аннотации, сборка компилирует сгенерированные исходники в `core/build/generated/reactive`. Тесты трансформера — `:core:test`.

### DI без обязательных bind

KSP сканирует классы `dev.ivlev.silent.ui.**`, строит:

- фабрики конструкторов с constructor injection;
- индекс `интерфейс/абстрактный класс → реализации` (одна реализация — alias, несколько — `AmbiguousDependencyException`, ноль — `MissingDependencyException`);
- `GeneratedDi.register(container)`.

```kotlin
val container = container() // авто-загрузка GeneratedDi
val vm = container.resolve<AppVM>()
val async = container.resolveAsync<AppVM>()
```

`bind` остаётся для override:

```kotlin
val container = container {
    bind<AuthApi> { FakeAuthApi(delayMs = 0) }
}
```

Lifetimes: `singleton`, `scoped`, `transient`; `createScope()`; `dispose()` освобождает `Disposable`/`AutoCloseable`. Циклы определяются по стеку типов. Ошибки типизированы и содержат `KClass`.

Авто-DI использует reflection один раз при загрузке сгенерированного индекса; горячий путь разрешения графа — обычные вызовы фабрик.

### Layout и виджеты

- `Box`, `Column`, `Row`, `Stack`, `Grid`, `Scroll`, `Screen`, `Expanded`, `Spacer`.
- `AdaptiveScaffold`: `xl` и шире — rail, уже — bottom bar.
- `ResponsiveContent`: таблица от `xl`, карточки ниже.
- `ContentPage`: gutters 16 до `xl` и 32 от `xl`, max-width 1440, центрирование на широких окнах.
- Виджеты: `Text`, `Heading`, `Button`, `IconButton`, `TextField`, `Checkbox`, `Switch`, `Select`, `Card`, `Divider`, `Progress`, `FormProgress`, `Table`, `Tag`, `NavigationRail/Bar`.
- Демо-настройки используют `Grid(columns = responsive(xs = 1, md = 2, xl = 3))` — форма в 1/2/3 колонки.
- `Widget` строит `RenderNode`; `UiRenderer` рисует дерево через абстрактный `Painter` (`rect`, `roundRect`, `line`, `text`, `clip`, `translate`, `save/restore`).
- Токены и брейкпоинты повторяют `packages/ui/src/tokens/breakpoints.json`: `xs 0, sm 360, md 480, lg 600, xl 840, 2xl 1200, 3xl 1600, 4xl 1920, 5xl 2560, 6xl 3840`. `responsive(xs = ..., md = ...)` резолвится mobile-first.

### Формы

`FormModel` + `field("")`: `required`, `email`, `url`, `minLength`, `maxLength`, `pattern`, `min`, `max`, `custom`, `validate`; `touched`, `error`, `valid`, `isDirty`, `completion` (0..1), `submit`, `reset`, `setFieldErrors`, `isSubmitting`. Ошибки показываются после касания/отправки, серверные — сразу и очищаются при редактировании.

### Платформы

- **Desktop**: `JFrame` + `SkiaLayer`/`SkiaRenderDelegate`; layout в dp, Canvas масштабируется под DPI/окно. `SkiaLayer` содержит heavyweight `Canvas`, поэтому lightweight `JTextField` под ним не виден: ввод сделан через **heavyweight `JWindow(frame)`** без декора с `JTextField`/`JPasswordField`, который показывается на месте поля и скрывается по Escape/Enter/клику вне/смене route. Окно позиционируется через `layer.locationOnScreen` и тот же `uiScale`, что layout/hit-test/caret. Клик ставит caret, Enter отправляет логин, Tab/Shift+Tab переключают поля; нативные selection, clipboard, IME и контекстное меню. Колесо мыши и drag скроллят `ScrollState` (в галерее виден scrollbar). Переключатель темы — в интерфейсе.
- **Hover**: Skiko layer слушает `mouseMoved`/`mouseExited`, делает hit-test с путём по дереву и передаёт `hoveredPath`/`pressedPath`/`hoverPoint` в `UiRenderer`. Перерисовка идёт только в union старых/новых hover-регионов (frame-cache + `Canvas.clipRect`); Android использует `invalidate(Rect)` и `onHoverListener`. Курсоры: pointer/text/hand/grab/grabbing/col-resize. Hover не срабатывает на disabled и не забирает фокус.
- **Android**: `FrameLayout` с `SilentCanvasView`; `onDraw` масштабирует Canvas по density, учитывает system bars и IME insets. Для каждого `TextField` создаётся прозрачный `EditText` (inputType email/password/number) с `TextWatcher` и bridge в `FieldBinding`; `adjustResize` держит поле над клавиатурой. Тема — системная (`uiMode`), плюс кнопка переключения.

## Данные API

Desktop и Android читают `@Proto`-модели из `kotlin/protocol` и декодируют ответы `Accept: application/x-silent-protocol`.

- `GET /api/projects?page=&pageSize=&sort=&order=&q=&status=&owner=&tag=`
- `GET /api/meta`
- Схемы повторяют `examples/ui/server/src/model.rs` (`ProjectPage`, `Project`, `ProjectMeta`, `ProjectStatus`).
- Базовый URL: `SILENT_API_URL`, по умолчанию `http://127.0.0.1:6108`.
- Desktop — `java.net.http.HttpClient`; Android — `HttpURLConnection`. Сеть никогда не выполняется на UI-потоке, результат приходит через `UiThread`.
- При ошибке/пустом ответе UI показывает предупреждение, Dashboard остаётся на локальных данных, Projects — на локальном fallback.

Запуск сервера:

```bash
cargo run -p silent-example-ui-server
# Android-эмулятор: adb reverse tcp:6108 tcp:6108
```

## Демо

- **Логин**: email/password, `Checkbox`, `FormProgress`, `Button` с loading, серверная ошибка при `error@silent.dev`, fake `AuthApi` с задержкой.
- **Dashboard**: как web-пример — top bar с иконкой темы и аватаром «АЛ» (выход в профиле), 6 метрик с векторными иконками, «Статусы» с прогрессом, «Команда и теги» чипами, «Последние проекты»; данные с `/api/projects` и `/api/meta`, при недоступности — локальный fallback и предупреждение; панели 1.15:1 от 1024 и 1.35:1 от 1920; rail 260 с иконками, bottom bar, светлая/тёмная тема.
- **Проекты**: отдельная страница с серверным `DataTable`: поиск, фильтры по статусу/владельцу/тегу, сортировка, выбор строк, пагинация, загрузка/ошибка/empty; на узких экранах — карточки.
- **Галерея**: все компоненты и формы, состояния default/focus/error/disabled/loading/empty, overlay-примеры, адаптив 390–3840, light/dark.
- **Настройки**: форма 1/2/3 колонки по брейкпоинтам, `Switch`, `Tag` в карточках проектов.
- Один и тот же `core`-дерево используется desktop и Android.

## Тесты

- `:core:test`: сигналы/батчи/computed/dispose; формы/валидация/completion/серверные ошибки; брейкпоинты; layout (Column/Row/Grid/Scroll/Adaptive/Expanded/hit-test, ContentPage gutters/max-width); ViewModel lifecycle/watch/computed; DI; трансформер аннотаций; регидрация `View`; damage merge/idle skip/кэш текста; виртуализация 10k строк; drag/resize/density DataTable; рендер всех секций галереи на 360–3840.
- `:desktop:test`: offscreen-рендер 960/1280/3840, метрики шрифтов, UI-scale, ввод/фокус/caret/Tab/Shift+Tab/Enter/Escape/checkbox/button через `DesktopInputTest`.
- `:android:assembleDebug`: сборка APK.

## Ограничения MVP

- Source-transform, не compiler plugin: не поддерживаются аннотированные свойства без инициализатора, несколько модификаторов в одной строке, сложные многострочные выражения с `@Computed` вне блочных скобок. Android-модуль не трансформируется (аннотации применяются в `core`); при необходимости задача `transformReactive` подключается к другому модулю.
- Авто-DI сканирует только `core`; классы других модулей — через `bind` или отдельный KSP-проход. Параметры конструктора с generic/primitive типами без default пропускаются.
- `@Watch(deep = true)` не реализован; `immediate` передаёт `prev == next`.
- Desktop overlay — отдельное `JWindow`, поэтому `import -window <main>` его не включает; для скриншота ввода используйте снимок экрана/`spectacle`.
- Table: без горизонтального скролла и resize/selection; на узких экранах демо показывает карточки. DataTable: виртуализация, resize и reorder колонок.
- Скролл — колесо/трекпад, drag и touch; scrollbar рисуется в правом краю `Scroll`.
- Accessibility не аудирован: desktop использует Swing-оверлей, Android — нативные `EditText`/View.
- Desktop Skiko runtime подключён только для Linux x64.
- `SILENT_UI_SCALE` — глобальный zoom; авто-масштаб считается от высоты экрана (1080p/1440p/2160p) и отключается при OS scale > 1, чтобы не удваивать DPI.
- Hover-стили: state layer 8% (`on-primary` для filled, `on-surface` для остальных), pressed 12%; поля — border; таблицы — строки/заголовки; disabled не реагирует. `--hover=button|table|nav` в desktop-демо программно ставит hover без клика для скриншотов.
- Скролл: колесо/трекпад и touch; индикатор в правом краю `Scroll`; sticky top bar и sticky header DataTable.
- Перф-бенчмарки (core-тест): 10k hover-updates ≈ 14 ms, damage строки таблицы 38 400 px² вместо 384 000 000 px² всего 10k-таблицы; 10k строк рендерят 55 текстовых команд и 4 узла. Idle не вызывает кадров (0% CPU за 5 с), layout кэшируется до изменения сигналов.
- Android overlay — один `EditText` на поле; невидимые за пределами `Scroll` поля скрываются, чтобы не перекрывать bottom bar. Кастомная отрисовка caret/selection не используется.
- Скриншоты в `/tmp` не коммитятся.
- Таблица: DnD/resize колонок реализованы, строки и tree-nodes — нет; time-based анимации не подключены.
- Виртуализация: DataTable/Table/List рисуют только видимые строки; полная перерисовка кадра остаётся, damage-регион вычисляется, но Skiko/Android частичный blit не выполняют.
- Тёмная тема: soft charcoal (`#17181B`), контраст проверен `ThemeContrastTest`.
- `PARITY.md` содержит статус каждого компонента и отличия от web.
