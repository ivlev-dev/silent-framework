# ui-rust — GPU UI на Rust (MVP)

Отдельный Rust-workspace с тем же дизайном Silent UI: реактивные сигналы, формы,
View/ViewModel, DI, damage-aware GPU-рендерер на `wgpu` и порт компонентов
Silent UI. Desktop — **только Wayland**, Vulkan с fallback на GL.

## Состав

```
ui-rust/
  derive/        proc-macro: #[derive(ViewModel)], #[view_model], #[derive(Injectable)]
  core/          сигналы, формы, тема, брейкпоинты, layout, виджеты, ViewModel/View, DI, UI-рантайм
  render/        wgpu-рендерер, батчинг, lyon-геометрия, glyphon-текст, headless PNG
  platform/      winit-окно, ввод, IME, clipboard, desktop-раннер
  accessibility/ accesskit-дерево из layout-дерева
  demo/          login, dashboard, gallery, desktop и headless
  PARITY.md      карта компонентов: статус, виртуализация, DnD, анимации
```

Это вложенный workspace: он не входит в корневой `Cargo.toml` и не меняет
существующие крейты. Все команды ниже выполняются из `ui-rust/`.

## Стек и совместимость

Подобраны версии, которые действительно сходятся по `wgpu`:

| crate | версия |
| --- | --- |
| `wgpu` | 30.0.2 |
| `winit` | 0.30.13 |
| `cosmic-text` | 0.19 |
| `glyphon` | 0.12 (требует `wgpu 30` + `cosmic-text 0.19`) |
| `lyon` | 1.0.19 |
| `accesskit` | 0.25.2 |
| `pollster` / `bytemuck` | 0.4 / 1.25 |

`glyphon 0.12` — последняя версия, совместимая с `wgpu 30`; более старые
`glyphon` требуют `wgpu 28/29/25`. При обновлении `wgpu` проверяйте матрицу
`glyphon` → `wgpu` → `cosmic-text`.

## Запуск

```bash
cd ui-rust
env -u DISPLAY WAYLAND_DISPLAY=wayland-1 cargo run -p ui-demo
env -u DISPLAY WAYLAND_DISPLAY=wayland-1 cargo run -p ui-demo --release
```

Desktop поддерживает **только Wayland**: `winit` собран без feature `x11`,
X11/XWayland не используется. Без `WAYLAND_DISPLAY` приложение завершится с
понятной ошибкой. `DISPLAY` можно не выставлять.

Переменные окружения:

```bash
WGPU_BACKEND=vulkan RUST_LOG=info \
  env -u DISPLAY WAYLAND_DISPLAY=wayland-1 cargo run -p ui-demo
WGPU_BACKEND=gl RUST_LOG=info \
  env -u DISPLAY WAYLAND_DISPLAY=wayland-1 cargo run -p ui-demo
```

`WGPU_BACKEND` принимает `vulkan`, `gl`/`gles`, `metal`, `dx12`, `all`,
`primary`, `auto` и списки через `,`/`|`/`+`.

Масштаб: для 4K-мониторов UI работает в 2× (`effective_ui_scale`), стартовое
окно — 68% рабочей области (60–75%), но не меньше 960×640; 2560+ — 1.5×.
`winit::scale_factor` учитывается, рендер идёт в физических пикселях без
интерполяции текста.

Демо: экран логина (предзаполнен `demo@silent.dev` / `secret123`, кнопка
«Войти» запускает фейковый `AuthApi` с задержкой 420 мс), dashboard и
галерея компонентов (`--screen gallery`). `Ctrl+D` — тема; «Выйти» возвращает
на логин. В галерее секции переключаются rail/bottom navigation, поповеры
открываются кнопками и закрываются кликом по backdrop или Escape.

### Headless-скриншот

Готовые кадры лежат в `ui-rust/screenshots/` (генерируются snapshot-тестом):
`login|dashboard|gallery-{390x844|840x900|1440x900|1920x1080|3840x2160}-{light|dark}.png`,
секции галереи `gallery-section-{1..5}-1440-dark.png`, hover —
`hover-{button|nav|row}-1440-dark.png`.

```bash
cargo run -p ui-demo -- --headless --width 1440 --height 900 --out /tmp/login.png
cargo run -p ui-demo -- --headless --dark --width 3840 --height 2160 --out /tmp/login-4k-dark.png
cargo run -p ui-demo -- --headless --screen dashboard --width 1920 --height 1080 --out /tmp/dash.png
cargo run -p ui-demo -- --headless --screen gallery --section 3 --width 1440 --height 900 --out /tmp/gallery-data.png
cargo run -p ui-demo -- --headless --screen gallery --popover 2 --width 1440 --height 900 --out /tmp/popover.png
cargo test -p ui-demo --test snapshots
```

`--headless` рендерит кадр в offscreen-текстуру и читает пиксели через
`copy_texture_to_buffer` + `map_async`, затем пишет PNG. Окно не нужно.

### Производительность и бенчмарк

```bash
cargo run -p ui-demo --release -- --perf 120
```

Замеры (Vulkan, offscreen, Wayland-профиль, 120 кадров; release):

```
1440x900  idle: 0/120 кадров, 0 px
1440x900  input: avg 0.56 ms, p99 1.13 ms, 28 880 px/frame
1440x900  hover: avg 0.47 ms, p99 0.95 ms, 22 624 px/frame
1440x900  table-10k-scroll: avg 1.81 ms, p99 3.24 ms, 7 visible rows
1440x900  full: avg 0.74 ms, p99 0.98 ms
3840x2160 idle: 0/120 кадров, 0 px
3840x2160 input: avg 0.89 ms, p99 2.55 ms, 28 880 px/frame
3840x2160 hover: avg 0.69 ms, p99 0.73 ms
3840x2160 table-10k-scroll: avg 2.35 ms, p99 3.43 ms, 7 visible rows
3840x2160 full: avg 1.04 ms, p99 1.36 ms
resize 1440x900<->3840x2160 (scale 1/2): avg 1.87 ms, p99 15.61 ms
```

- Damage: изменения сигналов дают union прямоугольников; idle не рендерит
  кадры, `ControlFlow::Wait`.
- Input/hover перерисовывают только поле/кнопку; полный кадр — screen change,
  scroll, resize.
- Кэш shaping: ключ `(текст, стиль, ширина, высота, scale)`, LRU 2048 записей,
  ключи текущего кадра не эвиктятся. Layout кэшируется по revision; hover/focus
  патчат paint без пересчёта layout.
- DataTable виртуализирован: при 10 000 строк в paint попадают только видимые
  (+overscan) строки, sticky header/footer.
- Surface present mode: `Mailbox`, fallback `Immediate`, затем `AutoVsync`.
- Pipeline/atlas создаются один раз; resize меняет только surface/сцену,
  resize-события коалесцируются в один redraw.

## API

### Реактивность

```rust
use ui_core::{Signal, Computed, effect, batch, Scope};

let email = Signal::new(String::new());
let valid = Computed::new(move || email.get().contains('@'));

let scope = Scope::new(|| {
    effect(move || {
        let _ = email.get();
    });
});

batch(|| {
    email.set("user@example.com".into());
});
scope.dispose();
```

- `Signal<T>` — дешёвый `Copy`-handle; `get()` подписывает текущий scope/effect,
  `peek()` — нет.
- `Computed<T>` ленивый, кэшируется и инвалидируется по зависимостям.
- `Effect` перезапускается при изменении зависимостей; `batch` объединяет
  уведомления в один проход.
- `Scope` владеет эффектами/сигналами и освобождает их. Рантайм потоковый
  (`thread_local`), `Signal` не `Send` — UI-состояние живёт в UI-потоке.

### Формы

```rust
use ui_core::form::{Field, FormState, FieldAccess};

let email: Field<String> = Field::new("email", "Email").required().rule(
    "Некорректный email",
    |value| value.contains('@'),
);
let password = Field::<String>::new("password", "Пароль")
    .required()
    .min_length(8);

let state = FormState::new();
let fields: Vec<&dyn FieldAccess> = vec![&email, &password];
assert!(!state.validate(&fields));
assert_eq!(state.completion(&fields), 0.0);
```

`Field` хранит `value`/`touched`/`errors`; поддерживаются `required`, `email`
(через `email_rule`), `min_length`, `max_length`, произвольные правила,
`touched`/серверные ошибки через `set_field_errors`, `completion` 0..1 и
`reset`. Builder-подход выбран вместо обязательного derive: правила
типобезопасны и не требуют proc-macro для форм.

### ViewModel + View

```rust
use std::sync::Arc;
use ui_core::{view_model, Reactive, Widget};
use ui_core::view_model::ViewModel;

#[derive(ui_core::ViewModel)]
struct LoginVm {
    #[reactive] email: Reactive<String>,
    #[reactive] password: Reactive<String>,
}

#[view_model]
impl LoginVm {
    fn view(&self) -> Widget {
        Widget::column(vec![
            Widget::text_field_plain("Email", self.email),
        ])
        .padding_all(24.0)
    }

    #[computed]
    fn can_submit(&self) -> bool {
        self.email.get().contains('@') && self.password.get().len() >= 8
    }

    #[watch(self.email)]
    fn on_email(&self) {
    }
}

let vm = LoginVm::new();
let view = ui_core::View::new(vm);
let widget = view.widget();
```

- `#[derive(ViewModel)]` на структуре генерирует `__vm_id`, `__reactive_ids`,
  getter/setter (`vm.email()`, `vm.set_email(x)`, `vm.email_signal()`).
- `#[view_model]` на `impl` подключает `#[computed]` и `#[watch]`, генерирует
  `impl ViewModel` (форвардит `view`, `on_mount`, `on_dispose`, `on_frame`,
  `scope`, watchers).
- `View` создаёт scope, если VM его не отдаёт, и «усыновляет» все
  `#[reactive]`-сигналы. `dispose`/`Drop` вызывают `on_dispose`, освобождают
  watchers, computed-кэш и scope. Сигналы VM умирают вместе с view.
- Точечные обновления: effect пересобирает только `Widget`-дерево, layout
  пересчитывается при изменении ревизии сигналов или размера.

Ограничения Rust, о которых нужно знать:

- Нет property accessors/перегрузки присваивания: `vm.email = x` невозможно.
  Используйте `vm.email.set(x)`, `vm.email.get()` или сгенерированный
  `vm.set_email(x)`.
- `#[computed]` мемоизируется по глобальной ревизии сигналов (а не по
  точечному dependency-графу вызова). Чтение сигналов внутри метода
  подписывает view; при любом изменении сигналов метод пересчитывается.
- `#[watch(self.email, self.password)]` подписывается только на перечисленные
  поля; первый запуск пропускается. Произвольные чтения в теле метода не
  добавляют подписки — перечисляйте зависимости явно.
- Derive поддерживает только именованные структуры без generics. Если нет ни
  одного `#[reactive]`-поля, `vm_id` общий для типа (используется
  `type_vm_id`), computed-кэш будет общим — добавляйте хотя бы одно
  реактивное поле.
- VM, написанная вручную без derive, должна реализовать `reactive_ids()`
  (id сигналов), иначе `View` не сможет забрать их в свой scope и освободить
  при dispose.

### DI без обязательного bind

```rust
use ui_core::{Container, Injectable};
use std::sync::Arc;

#[derive(ui_core::Injectable)]
#[provides(AuthApi)]
struct FakeAuthApi {
    #[init(std::time::Duration::from_millis(420))]
    latency: std::time::Duration,
}

#[derive(ui_core::Injectable)]
struct LoginService {
    #[inject] auth: Arc<dyn AuthApi>,
    #[inject] config: AppConfig,
    #[init(3usize)] retries: usize,
}

let container = Container::new();
let api = container.resolve_trait::<dyn AuthApi>()?;
let service = container.resolve::<LoginService>()?;
```

- `#[derive(Injectable)]` регистрирует фабрику через `inventory`; `resolve`
  авто-инстанцирует без `bind`. Поля: `#[inject]` (резолв из контейнера,
  `Arc<dyn Trait>` — через `resolve_trait`), `#[init(expr)]`, иначе
  `Default::default()`.
- `#[provides(Trait)]` индексирует trait → единственная реализация. Несколько
  реализаций одного trait дают `DiError::Ambiguous` со списком провайдеров.
- `bind::<T, _>(factory)` / `bind_arc::<dyn Trait, _>(factory)` — override
  авто-регистрации, вручную. `singleton` (по умолчанию), `scoped`, `transient`.
- `resolve_async` / `bind_async` — async API; фабрики sync, `bind_async`
  блокирующе дожидается future (MVP без runtime).
- Циклы обнаруживаются по стеку резолва (`DiError::Cycle` с цепочкой типов).
- `Container::scope()` создаёт дочерний scope; `dispose()` чистит scoped-кэш,
  дочерние scope и блокирует дальнейший резолв.
- Trait-объекты требуют `Send + Sync + 'static`. VM с `Signal` не `Send`,
  поэтому VM не регистрируется в DI — она создаётся вручную, а зависимости
  (`AuthApi`) резолвятся из контейнера. Это осознанное ограничение
  thread-local UI-рантайма.

## Токены и визуальный язык

Тема перенесена из `packages/ui/src/tokens/tokens.css` и
`packages/ui/src/styles/themes.css` (light/dark):

- светлая палитра ink/teal/mist/ivory: `primary #0E2A47`, `secondary #1F4E6B`,
  `accent #9FB8C9`, `surface #F2F5F7`, `surface-container-lowest #FFFFFF`,
  `on-surface #081A2E`, `outline-variant #C9D8E2`; страница — `#FAFBFC`;
- тёмная — soft charcoal: `surface #17181B`, `surface-container-lowest #131417`,
  `low #1D1E22`, `container #232428`, `high #2A2B30`, `highest #333439`,
  `on-surface #ECECEF`, `variant #C9C9D0`, `muted #9C9CA5`,
  `outline #85858F`, `outline-variant #3C3D44`, `primary #D9D5CB`,
  `on-primary #141416`, `primary-container #34343A`;
- error/success/warning контейнеры на токенах;
- типографика: display/headline/title/body/label по токенам, brand 14/18,
  subtitle 15/22.5, label 13/18.2, hint и footer 12/16;
- spacing 4/8/12/16/20/24/32/48, radius xs 4, control 10, card 16, dialog 20;
- elevation 0–5 (мягкие многослойные тени), density 1.0;
- контролы 32/40/48, input 44, иконки 14/18/22, focus ring 2 px.

Компоненты и правила:

- `Card`: surface-container-lowest, hairline `outline-variant`, radius 16,
  padding 20 (dashboard) / 32 (login), gap 20–24, elevation 2.
- `Button`: filled/tonal/outlined/text (+ старые primary/secondary/ghost),
  32/40/48, radius 10, label 12–13.
- `TextField`: label → 6 px → input 44 px → hint 6 px; ошибка 12/16;
  focus ring 2 px; пароль и placeholder на токенах.
- `Checkbox` 18 px с gap 8, `Switch` 44×24 (knob 18, inset 3), `Select` 44 px.
- `Tag/Badge`: варианты neutral/primary/secondary/success/warning/error/info,
  высота 24, label 12, одна строка.
- `Table`/`DataTable`: header 44, row 48 (compact 44), padding 12/16,
  tag-колонка — однострочный чип; углы таблицы квадратные, внешняя карточка
  скруглена; bulk-панель выбранных строк — над пагинацией; virtualization +
  drag/resize колонок (см. `PARITY.md`).
- `Progress`/`FormProgress`: label 12, track 6 px, primary bar.
- `NavigationRail` 260 px (expanded, hairline right), `NavigationBar` 64 px.
- Page shell: rail 260 → на `<840px` скрывается в pinned bottom navigation;
  TopAppBar 56 px; content max 1440; gutters 16/24/32; section gap 24.
- Hover: Button/IconButton (state layer 8%), nav items, таблицы (строки/шапка),
  поля (outline), checkbox/switch/radio, ссылки, интерактивные Card/Tag;
  курсор pointer/text/grab/grabbing/col-resize; disabled не реагирует.
- Поповеры (ColorPicker, DatePicker, Select, TreeSelect, Menu) — top-layer
  Stack: backdrop, клик вне и Escape закрывают, панель не обрезается карточкой.

Брейкпоинты синхронизированы с `packages/ui/src/tokens/breakpoints.json`:
`xs 0, sm 360, md 480, lg 600, xl 840, 2xl 1200, 3xl 1600, 4xl 1920, 5xl 2560,
6xl 3840`. Mobile-first: `Responsive<T>` выбирает значение по последнему
достигнутому брейкпоинту, `responsive!(Xs => 1, Md => 2, Xl => 3)`.

Виджеты: `Box`/`Column`/`Row`/`Stack`/`Grid`, `Text`, `Heading`, `Label`,
`Link`, `Button`, `IconButton`, `Fab`, `TextField`, `Textarea`, `Checkbox`,
`Switch`, `Radio`, `Select`, `Slider`, `OTP`, `Card`, `Divider`, `Tag/Badge`,
`Chip`, `Avatar`, `Spinner`, `Skeleton`, `Progress`, `FormProgress`,
`NavigationRail/Bar`, `TopAppBar`, `Table`, `DataTable`, `Accordion`, `List`,
`Tabs`/`Breadcrumbs`/`Pagination` (композиции). Полная карта — `PARITY.md`.
Поддерживаются `padding`, `gap`, `align`, `justify`, `wrap`, `grow`,
`max_width`, `min_height`, `key`, `clickable`, адаптивные
padding/видимость/направление, `pin_bottom`, `fill_viewport_height`.

Layout пересчитывается только при смене revision/размера/темы; hover, focus,
pressed и каретка патчат paint-состояние без нового layout. `Card` учитывает
`gap` и в измерении, и в раскладке (есть тест); flex-контейнеры используют
явные gap без margin collapse. Текст в layout измеряется приближённо,
финальный shaping делает `cosmic-text`; возможны небольшие расхождения
переносов. DataTable/List-виртуализация есть для DataTable; generic scroll
контейнеров пока нет (см. ограничения).

## Рендерер

- `wgpu::Instance` → adapter → device; Vulkan приоритет, GL fallback.
- Один render pass на кадр: все прямоугольники, иконки и текст батчатся.
- `Widget::translate(dx, dy)` сдвигает поддерево без пересчёта layout; клип
  наследуется от родителя, текст дополнительно ограничивается `TextBounds`.
- Геометрия rounded rect и иконок — `lyon` (fill/stroke), один vertex/index
  buffer на кадр; альфа-блендинг.
- Текст — `cosmic-text` shaping + `glyphon` атлас, clip через `TextBounds`.
- Карточки с тенью, чекбоксы, switch, поля, таблица, прогресс, nav-элементы
  рисуются процедурно.
- Surface: `Mailbox`/`Immediate` (без блокировки на resize), sRGB-формат;
  resize/scale factor обрабатываются, pipeline/atlas не пересоздаются.
- MSAA 4× для сцены, затем blit в surface/PNG; единый `rounded_rect` рисует
  fill+stroke по одной геометрии, stroke внутрь на половину толщины.
- Resize: события коалесцируются, surface configure + scene resize один раз
  перед redraw.

## Ввод

`winit` mouse/keyboard/touch, hit-test по layout-дереву, focus/tab-порядок,
редактирование текста (caret, Shift+стрелки/Home/End, выделение, Ctrl+A,
Backspace/Delete с выделением), Enter для
submit/активации, Escape для blur, `Ctrl+C/V/X` и clipboard через `arboard`
(с fallback на memory), `WindowEvent::Ime::Commit` как базовая поддержка IME.
Hover меняет состояние и курсор (`Pointer/Text/Grab/Grabbing/ResizeHorizontal`),
damage — только старый/новый прямоугольник. Колесо: DataTable скроллит
виртуализированные строки (full-viewport damage), остальные — full viewport.
`PointerLeave` сбрасывает hover.

## Accessibility

`ui-accessibility` строит `accesskit::TreeUpdate` из layout-дерева: роли,
label/value, bounds, disabled/toggled/selected, focus, children. Покрыто
тестами. Интеграция `accesskit_winit::Adapter` — следующий шаг; базовое дерево
уже готово.

## Тесты

```bash
cd ui-rust
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

Покрыто:

- сигналы: подписки, computed-цепочки, batch, untracked, dispose scope;
- формы: required/email/min_length, completion, серверные ошибки, reset;
- ViewModel-макросы: reactive get/set, computed-мемоизация, watch, dispose,
  перерисовка через `Ui`;
- DI: auto-регистрация, trait-объекты, ambiguous, циклы, scopes, async,
  dispose, `bind` override;
- layout: column/row/grid/stack, wrap, hit-test, focus/tab, брейкпоинты;
- input: клики, ввод текста, checkbox, clipboard, hover, Escape;
- accessibility: роли, bounds, focus;
- headless-рендер: размер, фон (light/dark), наличие accent-цвета, PNG,
  стабильность кадров;
- snapshot-тесты: токены, dark soft-charcoal, радиусы/углы (пиксели вне
  радиуса), switch knob внутри трека, scale 4K→2×, окно 60–75%, login card
  460/gap 20, отсутствие overflow, bottom navigation, все размеры/темы;
- damage: partial vs full pixel equality, union, idle-skip, hover damage
  old/new only, hover pixels vs normal;
- text cache: reuse, invalidation по стилю/ширине/scale, resize 1440↔3840 и
  scale 1/2, 1200+ команд, лимит 2048 без eviction текущего кадра;
- DataTable: 10k строк виртуализированы, scroll, row selection, density,
  column reorder/resize, hover без layout rebuild;
- demo: DI-резолв `AuthApi`, успешный/неуспешный логин, клик по кнопке через
  `Ui`, наличие полей/прогресса, hover screenshots.

Headless-тесты пропускаются с сообщением, если GPU-адаптер недоступен.

## Mobile: что готово и что нужно

Архитектура разделена на `core`/`render`/`platform`; ввод и окно
платформенные, layout и виджеты общие. Платформенные части закрыты трейтами
`WindowBackend`, `RenderBackend`, `InputBackend` (desktop-реализации:
`Window`/`SurfaceBackend`/`WinitInput`), поэтому Android/iOS-бэкенды
подключаются без изменений core и layout.

Для Android/iOS нужно:

1. **Android window**: `GameActivity` (рекомендуется для `wgpu`/`winit`) или
   `NativeActivity`; собрать `cdylib`, `android_main`, `AndroidManifest.xml`,
   `minSdk` и Vulkan-фичу. `winit` 0.30 поддерживает Android.
2. **Touch/жесты**: уже есть `WindowEvent::Touch` → `PointerDown/Move/Up`;
   добавить multi-touch (pinch/scroll), long-press, drag и safe-area insets.
3. **IME**: на Android — `InputConnection` (commitText/deleteSurroundingText/
   composing), на iOS — `UITextInput`; текущий `Ime::Commit` — только база.
4. **Density**: `scale_factor` уже прокидывается в layout/рендер; проверить
   `dpi` и safe-area на устройствах с вырезом.
5. **Backend**: Android — Vulkan (fallback GLES), iOS — Metal; проверить
   surface format/present mode.
6. **Clipboard/dialogs/files**: заменить `arboard` на платформенные шины
   (Android ClipboardManager, iOS UIPasteboard).
7. **Accessibility**: подключить `accesskit_android`/`accesskit_ios`.
8. **Жизненный цикл**: pause/resume, lost surface/device, восстановление.

## Ограничения MVP

- X11/XWayland не поддерживается; только Wayland. X11-сборка winit отключена.
- Нет generic-скролла и виртуализации List/дерева; виртуализирован только
  DataTable. Скролл DataTable — full-viewport damage (по требованию), не
  частичный.
- Column DnD/resize работают, но reorder без плавной анимации; row/tree DnD,
  auto-expand и клавиатурный DnD не реализованы. `prefers-reduced-motion`
  пока не влияет (анимаций почти нет).
- Оверлеи поповеров — top-layer с backdrop/Escape/click-outside, но без
  focus-trap и полноценного a11y-фокуса.
- RichTextEditor — визуальный тулбар + textarea, без реального rich-модели;
  FileUpload/DateRange — базовые панели без загрузки/календарной логики;
  Combobox/TreeSelect — select-подобные превью.
- Нет градиентов, виртуальной клавиатуры и codegen из TS-токенов.
- Текст в layout измеряется приближённо; переносы могут отличаться от
  `cosmic-text` на сложных шрифтах.
- Таблица не эллипсирует и не виртуализирует ячейки; на узких экранах
  колонки сжимаются и текст обрезается.
- `Signal` потоковый (thread-local); фоновая работа возвращает результат в
  UI-поток через канал (как в `LoginVm`), а не пишет сигналы из потока.
- `#[computed]` инвалидируется по глобальной ревизии, а не по точному графу
  вызовов; `#[watch]` требует явных зависимостей.
- DI-провайдеры trait-объектов — `Send + Sync`; VM в DI не кладётся.
- Нет codegen из TS-токенов: цвета/типографика заданы в `Theme`, брейкпоинты
  синхронизированы с JSON вручную (тестом).
- Нет `UiForm` derive: формы строятся builder'ом (`Field`/`FormState`) —
  это осознанный выбор, правила типизированы и не требуют макроса.
