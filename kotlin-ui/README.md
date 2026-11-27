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

- **Desktop**: `JFrame` + `SkiaLayer`/`SkiaRenderDelegate`; layout в dp, Canvas масштабируется под DPI/окно. `SkiaLayer` содержит heavyweight `Canvas`, поэтому lightweight `JTextField` под ним не виден: ввод сделан через **heavyweight `JWindow(frame)`** без декора с `JTextField`/`JPasswordField`, который показывается на месте поля и скрывается по Escape/Enter/клику вне/смене route. Окно позиционируется через `layer.locationOnScreen` и тот же `uiScale`, что layout/hit-test/caret. Клик ставит caret, Enter отправляет логин, Tab/Shift+Tab переключают поля; нативные selection, clipboard, IME и контекстное меню. Колесо мыши и drag скроллят `ScrollState`. Переключатель темы — в интерфейсе.
- **Android**: `FrameLayout` с `SilentCanvasView`; `onDraw` масштабирует Canvas по density, учитывает system bars и IME insets. Для каждого `TextField` создаётся прозрачный `EditText` (inputType email/password/number) с `TextWatcher` и bridge в `FieldBinding`; `adjustResize` держит поле над клавиатурой. Тема — системная (`uiMode`), плюс кнопка переключения.

## Демо

- **Логин**: email/password, `Checkbox`, `FormProgress`, `Button` с loading, серверная ошибка при `error@silent.dev`, fake `AuthApi` с задержкой.
- **Dashboard**: fixed top bar, responsive grid карточек, поиск по проектам, таблица от `xl` / карточки ниже, rail/bottom bar, светлая/тёмная тема, logout.
- **Настройки**: форма 1/2/3 колонки по брейкпоинтам, `Switch`, `Tag` в карточках проектов.
- Один и тот же `core`-дерево используется desktop и Android.

## Тесты

- `:core:test`: сигналы/батчи/computed/dispose; формы/валидация/completion/серверные ошибки; брейкпоинты; layout (Column/Row/Grid/Scroll/Adaptive/Expanded/hit-test, ContentPage gutters/max-width); ViewModel lifecycle/watch/computed; DI (singleton/transient/scoped/cycle/missing/ambiguous/dispose/async/auto); трансформер аннотаций; регидрация `View`.
- `:desktop:test`: offscreen-рендер 960/1280/3840, метрики шрифтов, UI-scale 1280/1920/2560/3840, клик/фокус/caret/ввод/Tab/Shift+Tab/Enter/Escape/checkbox/button через `DesktopInputTest`.
- `:android:assembleDebug`: сборка APK.

## Ограничения MVP

- Source-transform, не compiler plugin: не поддерживаются аннотированные свойства без инициализатора, несколько модификаторов в одной строке, сложные многострочные выражения с `@Computed` вне блочных скобок. Android-модуль не трансформируется (аннотации применяются в `core`); при необходимости задача `transformReactive` подключается к другому модулю.
- Авто-DI сканирует только `core`; классы других модулей — через `bind` или отдельный KSP-проход. Параметры конструктора с generic/primitive типами без default пропускаются.
- `@Watch(deep = true)` не реализован; `immediate` передаёт `prev == next`.
- `Select` переключает значения по клику, без выпадающего меню.
- Desktop overlay — отдельное `JWindow`, поэтому `import -window <main>` его не включает; для скриншота ввода используйте снимок экрана/`spectacle`.
- Таблица простая: без горизонтального скролла и виртуализации; на 840–1199 px колонки сжимаются, на узких экранах демо показывает карточки.
- Скролл — колесо/drag без видимого scrollbar.
- Accessibility не аудирован: desktop использует Swing-оверлей, Android — нативные `EditText`/View.
- Desktop Skiko runtime подключён только для Linux x64.
- `SILENT_UI_SCALE` — глобальный zoom; авто-масштаб считается от высоты экрана (1080p/1440p/2160p) и отключается при OS scale > 1, чтобы не удваивать DPI.
- Android overlay — один `EditText` на поле; невидимые за пределами `Scroll` поля скрываются, чтобы не перекрывать bottom bar. Кастомная отрисовка caret/selection не используется.
- Скриншоты в `/tmp` не коммитятся.
