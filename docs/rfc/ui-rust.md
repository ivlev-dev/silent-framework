# RFC: Silent UI для Rust (GPU, desktop + mobile)

## Статус

Draft → MVP.

## Цель

GPU-ускоренный UI-фреймворк на Rust с тем же дизайном/формами/адаптивностью, что `@ivlev-dev/silent-ui`. Замена Slint для приложений Silent-класса.

Не цель: универсальный toolkit уровня Qt/Slint в MVP.

## Принципы

- Реактивные сигналы (`Signal<T>`, `Computed`, `Effect`) и fine-grained обновления.
- Формы как структуры с derive-макросом и валидацией.
- Один layout-движок, адаптивность по брейкпоинтам Silent UI.
- GPU-рендерер на `wgpu` (Vulkan/Metal/DX12/OpenGL), а не сырой Vulkan/OpenGL.
- Текст — `cosmic-text`/`glyphon`, геометрия — `lyon`, доступность — `accesskit`, окна/ввод — `winit`.
- Desktop и mobile используют один core; рендерер/ввод — платформенные.

## Брейкпоинты

Те же, что в `packages/ui/src/tokens/breakpoints.json`:

`xs 0`, `sm 360`, `md 480`, `lg 600`, `xl 840`, `2xl 1200`, `3xl 1600`, `4xl 1920`, `5xl 2560`, `6xl 3840`.

Mobile-first: значение выбирается по последнему достигнутому брейкпоинту. Layout-параметры принимают `Responsive<T>`:

```rust
Row {
    direction: responsive(Mobile => Column, Xl => Row),
    columns: responsive(Xs => 1, Md => 2, Xl => 3),
}
```

## API

```rust
#[derive(UiForm)]
struct LoginForm {
    #[reactive, required, email]
    email: Reactive<String>,
    #[reactive, required, min_length(8)]
    password: Reactive<String>,
    #[reactive]
    remember: Reactive<bool>,
}

impl LoginForm {
    #[computed]
    fn can_submit(&self) -> bool { !self.email.get().is_empty() && self.password.get().len() >= 8 }

    #[watch(self.email)]
    fn email_changed(&self, next: &str, prev: Option<&str>) { }
}

fn login_screen(form: &LoginForm) -> Widget {
    column!(gap: 16, padding: 24, [
        text!("Вход", style: headline_medium()),
        text_field!(form.email, label: "Email"),
        text_field!(form.password, label: "Пароль", password),
        checkbox!(form.remember, label: "Запомнить"),
        button!("Войти", enabled: form.is_valid(), loading: form.is_submitting()),
        form_progress!(form),
    ])
}
```

- `Reactive<T>`/`Signal<T>` — `Copy`-дешёвый handle; чтение подписывает текущий scope.
- `#[reactive]` — proc-macro атрибут: поле остаётся `Reactive<T>`, генерируются `get/set`-методы и регистрация в ViewModel.
- Прямой синтаксис `vm.count = 1` в Rust невозможен (нет property accessors/перегрузки присваивания). **Решение принято:** используем `vm.count.set(1)` / `vm.count.get()` (и сгенерированные `set_*`/аксессоры при необходимости). Source-preprocessor ради точного синтаксиса не используем.
- `FormModel` trait: `is_valid`, `is_dirty`, `completion`, `submit`, `set_field_errors`.
- `Widget` — типизированное описание узла; layout tree пересобирается только при структурных изменениях, значения обновляются точечно.

## View + ViewModel + DI

API повторяет Silent Framework: `ViewModel`, `View`, `Container`.

```rust
struct LoginVM {
    auth: Arc<dyn AuthApi>,
    email: Signal<String>,
    password: Signal<String>,
}

impl ViewModel for LoginVM {
    fn view(&self) -> Widget {
        column![
            text_field!(self.email, label: "Email"),
            text_field!(self.password, label: "Пароль", password),
            button!("Войти", enabled: self.can_submit(), on_click: self.submit()),
            form_progress!(self.completion()),
        ]
    }
}
```

- `ViewModel` trait: `view`, `on_mount`, `on_dispose`, `scope`.
- `View`/`component(vm, view_fn)` связывает VM и дерево, владеет dispose.
- Сигналы VM живут в scope; обновления точечные.

### DI без декораторов

```rust
let mut c = Container::new();
c.bind::<dyn AuthApi, _>(|| Arc::new(FakeAuthApi));
c.bind::<LoginVM, _>(|c| LoginVM::new(c.resolve::<dyn AuthApi>()));
let vm = c.resolve::<LoginVM>();
```

- `TypeId` + `Any`, `resolve::<T>()`, scopes, async resolve, cycle detection, dispose.
- **Без явного bind**: `#[derive(Injectable)]` на типе регистрирует фабрику через `inventory`/`linkme`; интерфейсы (trait objects) находят единственную реализацию по индексу. `bind` — только переопределение.
- Rust не умеет авто-инстанцировать произвольный тип без derive/macro; `Injectable` — минимальный маркер, не декоратор полей.
- Trait-объекты поддерживаются; фабрики принимают `&Container`.

## Компоненты

MVP: `Box`, `Column`, `Row`, `Stack`, `Grid`, `Text`, `Heading`, `Button`, `IconButton`, `TextField`, `Checkbox`, `Switch`, `Select`, `Card`, `Divider`, `Progress`, `Form`, `FormProgress`, `Responsive`.

Полный набор — все компоненты `packages/ui` (38), включая DataTable, TreeSelect, Date/Color pickers, FileUpload, RichTextEditor, навигацию, оверлеи.

## Архитектура

```
ui-rust/
  core/        signals, forms, validation, theme, layout, widgets
  render/      wgpu renderer, text, images, gradients, layers
  platform/    winit window, input, IME, clipboard, dialogs
  accessibility/
  demo-desktop/
  demo-android/ (позже)
```

### Рендеринг

- `wgpu::Instance` → Surface; приоритет Vulkan, fallback GL/DX12/Metal.
- Один render pass на кадр: батчинг прямоугольников/текста/иконок; атлас глифов.
- `cosmic-text` shaping + `glyphon` атлас; `lyon` для rounded rect/путей.
- Damage/clip-регионы; перерисовка только изменённых областей (MVP — полный кадр).
- Целевой бюджет: 16.6 ms на кадр, 60 fps на desktop; 120 Hz при наличии.

### Ввод

- `winit` mouse/touch/keyboard; hit-test по layout-tree.
- Текст: скрытый/нативный IME-бридж; на desktop — `winit` IME + clipboard; на Android — `InputConnection`.
- Фокус, tab-порядок, hover/press, scroll, drag.

### Accessibility

- `accesskit` дерево, обновление при изменении структуры/фокуса.
- Роли/имена/значения/состояния для всех виджетов MVP.

### Формы

- `UiForm` derive: поля, required, validators, async validators.
- `FormProgress` — заполненные обязательные / все.
- Ошибки: touched/submit, серверные `set_field_errors`.
- Интеграция с `silent-protocol` для отправки.

### Стили

- Токены генерируются из TS JSON в `Theme` (цвета, типографика, spacing, radius, density).
- Светлая/тёмная тема, системная тема, high-contrast позже.

## Mobile

- `winit` Android/iOS поддержка; один core и layout.
- Android: `NativeActivity`/`GameActivity`, IME, touch, safe-area, density.
- iOS: Metal backend, UITextInput-бридж (позже).
- MVP: desktop-демо + архитектура с mobile-таргетами; Android-демо после стабилизации core.

## MVP

1. Crate `ui-rust` с `core`, `render`, `platform`.
2. `winit` + `wgpu` окно; Vulkan/GL fallback.
3. Текст через `cosmic-text`/`glyphon`; rounded rect/иконки.
4. Реактивность, layout, breakpoints, темы.
5. Компоненты MVP, форма логина + dashboard, `LoginVM`/`LoginView` с DI.
6. Тесты layout/forms/reactive; скриншот/рендер-тест; запуск demo.
7. README, бенчмарк кадра.

## Дальше

- Все компоненты, виртуализация, DataTable, DnD, файлы.
- Android/iOS демо, IME/accessibility-аудит.
- Повреждения/damage-регионы, layers, анимации.
- Генератор кода из TS-схем.
