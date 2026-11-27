# RFC: Silent UI для Kotlin (Android + Desktop)

## Статус

Draft → MVP.

## Цель

Повторить дизайн-систему и API `@ivlev-dev/silent-ui` для Kotlin: классы как формы, реактивные сигналы, адаптивная раскладка по брейкпоинтам Silent UI, нативные desktop и Android.

Не цель: побайтовый паритет с Jetpack Compose. Compose заменяется только в приложениях Silent-класса.

## Принципы

- Один общий модуль `core`: сигналы, формы, валидация, темы, layout, дерево виджетов.
- Два рендерера: desktop (JVM + Skiko/Skia) и Android (Canvas + нативные EditText/IME).
- Нет Compose runtime/compiler. Только Kotlin, Skiko и платформенные API.
- Один API на обеих платформах: `Column`, `Row`, `Grid`, `TextField`, `Button`, `Form`, `Responsive`.
- Токены и брейкпоинты генерируются из `packages/ui/src/tokens/tokens.json`/`breakpoints.json`.
- Доступность и IME — через нативные мосты, не собственный текстовый движок.

## Брейкпоинты

Источник истины — `packages/ui/src/tokens/breakpoints.json`, mobile-first:

| Токен | px | em |
| --- | ---: | ---: |
| xs | 0 | 0 |
| sm | 360 | 22.5 |
| md | 480 | 30 |
| lg | 600 | 37.5 |
| xl | 840 | 52.5 |
| 2xl | 1200 | 75 |
| 3xl | 1600 | 100 |
| 4xl | 1920 | 120 |
| 5xl | 2560 | 160 |
| 6xl | 3840 | 240 |

Правила:
- `Responsive` выбирает значение по `width >= breakpoint`, начиная с `xs`.
- Layout-компоненты принимают `columns = responsive(xs = 1, md = 2, xl = 3)` и `direction = responsive(xs = Column, xl = Row)`.
- Навигация: `xl` и шире — rail; уже — bottom bar.
- Таблица: до `xl` — горизонтальный скролл/карточки, от `xl` — полная таблица.
- Формы: 1 колонка до `md`, 2 до `xl`, 3 от `xl`.

## API

```kotlin
class LoginForm : FormModel() {
    @Reactive var email = ""
    @Reactive var password = ""
    @Reactive var remember = false

    @Computed val canSubmit get() = email.isNotBlank() && password.length >= 8
}

fun LoginScreen(form: LoginForm): Widget = screen {
    Column(gap = 16, padding = 24) {
        Text("Вход", style = Typography.headlineMedium)
        TextField(form::email, label = "Email", hint = "Рабочая почта")
        TextField(form::password, label = "Пароль", type = FieldType.Password)
        Checkbox(form::remember, label = "Запомнить")
        Button("Войти", enabled = form.isValid, loading = form.isSubmitting, onClick = form::submit)
        FormProgress(form)
    }
}
```

- `@Reactive` на `var` — геттер/сеттер через сигнал (compiler transform, не delegate в пользовательском коде).
- `@Computed` на getter — мемоизированное вычисление.
- `@Watch(selector, options)` на методе — эффект с `(next, prev)`.
- `@Reactive`/`@Computed`/`@Watch` обрабатываются Kotlin compiler plugin (IR) или source preprocessing в Gradle; IDE видит аннотации, сборка — преобразованный код.
- `FormModel` — `isValid`, `isDirty`, `completion` (0..1), `submit`, `reset`, `setFieldErrors`.
- `Widget` — неизменяемое описание дерева; реактивность — точечные биндинги, без виртуального DOM.
- `@UiModel`/`@Field` — альтернатива DSL для KSP-генерации.

## View + ViewModel + DI

API повторяет Silent Framework: `ViewModel`, `View`, `container`.

```kotlin
class LoginVM(
    private val auth: AuthApi,
) : ViewModel() {
    var email by signal("")
    var password by signal("")
    val canSubmit = computed { email().isNotBlank() && password().length >= 8 }
    val completion = formCompletion(email, password)

    suspend fun submit() {
        if (!canSubmit()) return
        auth.login(email(), password())
    }
}

class LoginView(private val vm: LoginVM) : View {
    override fun content(): Widget = screen {
        Column(gap = 16) {
            TextField(vm::email, label = "Email")
            TextField(vm::password, label = "Пароль", type = Password)
            Button("Войти", enabled = vm.canSubmit(), onClick = vm::submit)
            FormProgress(vm.completion)
        }
    }
}
```

- `ViewModel`: `mounted`/`disposed`, `onMount`, `onDispose`, `scope`; сигналы и эффекты привязаны к scope.
- `View`: `content(): Widget`; `render(viewModel)`/`component(vm) { view }` создаёт дерево и dispose.
- `View` не зависит от DI: VM приходит снаружи.

### DI без декораторов

```kotlin
val vm = container.resolve<LoginVM>()
```

- **Без явного bind**: KSP-процессор сканирует все классы, строит индекс «интерфейс → единственная реализация» и фабрики конструкторов; контейнер авто-создаёт зависимости по типам.
- Constructor injection: параметры конструктора разрешаются рекурсивно; интерфейс без реализации/с несколькими реализациями — ошибка с подсказкой.
- Scopes (`singleton`, `scoped`, `transient`), async `resolveAsync`, циклы → ошибка, dispose scope.
- `bind` остаётся как явное переопределение, но не обязателен.
- Аннотации нужны только для ViewModel-полей (`@Reactive`/`@Computed`/`@Watch`), не для DI.

## Компоненты

MVP: `Box`, `Column`, `Row`, `Stack`, `Grid`, `Text`, `Heading`, `Button`, `IconButton`, `TextField`, `Checkbox`, `Switch`, `Select`, `Card`, `Divider`, `Progress`, `Form`, `FormProgress`, `Responsive`.

Полный набор — все компоненты `packages/ui`: Accordion, Alert, AlertDialog, Avatar, Badge, Breadcrumbs, Chip, ColorPicker, DatePicker, DateRangePicker, Dialog, Drawer, EmptyState, Fab, FileUpload, List, Menu, NavigationBar/Rail, Pagination, Popover, SearchField, SegmentedButton, Sheet, Skeleton, Snackbar, Table/DataTable, Tabs, Tag, Tooltip, TopAppBar, TreeSelect.

## Рендереры

### Desktop (JVM)

- Окно: AWT `JFrame` + Skiko `SkiaLayer` (или Skiko AWT `SkikoView`).
- Рисование: Skia Canvas, шрифты Skia Paragraph, изображения Skia.
- Ввод: общий event-цикл; для текста — нативный `JTextField`-оверлей с bridge в `TextFieldState` (IME, selection, clipboard).
- Accessibility: Java Access Bridge через `AccessibleContext` для ключевых виджетов.

### Android

- `View`-контейнер с `onDraw(Canvas)`; общий layout → пиксели.
- Ввод: нативные `EditText`/`Autofill`/IME-оверлеи; координация с деревом.
- Accessibility: `AccessibilityNodeProvider`/virtual view hierarchy.
- Touch/gestures, density, safe-area insets.

## Формы

- Общий `FormModel` и правила: required, min/max, minLength/maxLength, pattern, email, url, custom async.
- `FormProgress` считает заполненные обязательные поля / все обязательные; отображается `N%`.
- Ошибки: `touched`/`submit` стратегии, `setFieldErrors` для серверных ошибок.
- Интеграция с `silent-protocol` для отправки данных.

## Стили

- Токены: цвета, типографика, spacing, radius, elevation, density.
- Генерация `Theme.kt` из JSON (тот же источник, что CSS).
- Тёмная/светлая тема, `prefers-color-scheme` на desktop, system dark на Android.

## Производительность

- MVP: 60 fps на списке 1 000 строк в desktop; Android — не хуже системных View.
- Реактивность: O(1) обновление поля, без перерисовки всего дерева.
- Ленивые списки/виртуализация с `xl`-таблицами.

## MVP

1. Gradle KMP-проект: `ui-kotlin/core`, `ui-kotlin/desktop`, `ui-kotlin/android-demo`.
2. Общий core: сигналы, формы, валидация, темы, layout, breakpoints.
3. Desktop-рендерер Skiko: окно, форма логина, dashboard (rail/bottom по breakpoint), список.
4. Android-демо: та же форма и dashboard на Canvas + EditText.
5. ViewModel + DI: контейнер, scopes, пример LoginVM/LoginView с фейковым AuthApi.
6. Тесты: layout/breakpoints, формы/прогресс, реактивность, DI/VM lifecycle; скриншоты desktop/Android.
6. README и запуск.

## Дальше

- Все компоненты, DataTable, DnD, файлы, даты/цвета.
- Accessibility-аудит, IME, autofill.
- KMP iOS/Web.
- Генератор кода из TS-токенов и схем форм.
