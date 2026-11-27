use std::rc::Rc;

use crate::color::Color;
use crate::form::Field;
use crate::geometry::{Align, Direction, Edges, Justify, Length, Point};
use crate::responsive::Responsive;
use crate::signal::Signal;
use crate::theme::{FontWeight, TextStyle, Typography};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Border {
    pub width: f32,
    pub color: Color,
}

impl Border {
    pub const fn new(width: f32, color: Color) -> Self {
        Self { width, color }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ButtonVariant {
    Primary,
    Filled,
    Tonal,
    Outlined,
    Text,
    Secondary,
    Ghost,
    Danger,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TextTone {
    Primary,
    Secondary,
    Tertiary,
    Accent,
    OnPrimary,
    OnErrorContainer,
    InverseOnSurface,
    Error,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SurfaceTone {
    Page,
    Surface,
    Lowest,
    Low,
    Container,
    High,
    Highest,
    Card,
    Rail,
    Primary,
    PrimaryContainer,
    SecondaryContainer,
    ErrorContainer,
    SuccessContainer,
    WarningContainer,
    InverseSurface,
    Scrim,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TagVariant {
    Neutral,
    Primary,
    Secondary,
    Success,
    Warning,
    Error,
    Info,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ControlSize {
    Small,
    Medium,
    Large,
}

impl ControlSize {
    pub fn height(self) -> f32 {
        match self {
            ControlSize::Small => 32.0,
            ControlSize::Medium => 40.0,
            ControlSize::Large => 48.0,
        }
    }

    pub fn font_size(self) -> f32 {
        match self {
            ControlSize::Small => 12.0,
            ControlSize::Medium => 13.0,
            ControlSize::Large => 13.0,
        }
    }

    pub fn horizontal_padding(self) -> f32 {
        match self {
            ControlSize::Small => 12.0,
            ControlSize::Medium => 16.0,
            ControlSize::Large => 20.0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IconName {
    Check,
    Folder,
    ChevronDown,
    ChevronRight,
    Search,
    User,
    Lock,
    Home,
    Chart,
    Settings,
    Menu,
    Mail,
    Plus,
    ArrowRight,
}

#[derive(Clone)]
pub struct ContainerProps {
    pub direction: Direction,
    pub direction_override: Option<Responsive<Direction>>,
    pub gap: f32,
    pub align: Align,
    pub justify: Justify,
    pub wrap: bool,
    pub overlay: bool,
    pub padding: Edges,
    pub children: Vec<Widget>,
}

#[derive(Clone)]
pub struct CardProps {
    pub padding: Edges,
    pub gap: f32,
    pub children: Vec<Widget>,
    pub elevation: f32,
}

#[derive(Clone)]
pub struct GridProps {
    pub columns: Responsive<usize>,
    pub column_gap: f32,
    pub row_gap: f32,
    pub padding: Edges,
    pub children: Vec<Widget>,
}

#[derive(Clone)]
pub struct TextWidget {
    pub content: String,
    pub style: TextStyle,
    pub color: Option<Color>,
    pub tone: Option<TextTone>,
    pub align: Align,
}

#[derive(Clone)]
pub struct HeadingWidget {
    pub content: String,
    pub level: u8,
    pub color: Option<Color>,
    pub tone: Option<TextTone>,
}

#[derive(Clone)]
pub struct ButtonWidget {
    pub label: String,
    pub variant: ButtonVariant,
    pub size: ControlSize,
    pub enabled: bool,
    pub loading: bool,
    pub icon: Option<IconName>,
    pub on_click: Option<Rc<dyn Fn()>>,
}

#[derive(Clone)]
pub struct TextFieldWidget {
    pub label: String,
    pub value: Signal<String>,
    pub errors: Option<Signal<Vec<String>>>,
    pub touched: Option<Signal<bool>>,
    pub placeholder: String,
    pub password: bool,
    pub enabled: bool,
    pub help: Option<String>,
    pub on_submit: Option<Rc<dyn Fn()>>,
    pub multiline: bool,
    pub leading_icon: Option<IconName>,
    pub invalid: bool,
}

#[derive(Clone)]
pub struct LinkWidget {
    pub label: String,
    pub on_click: Option<Rc<dyn Fn()>>,
}

#[derive(Clone)]
pub struct IconButtonWidget {
    pub icon: IconName,
    pub label: String,
    pub variant: ButtonVariant,
    pub size: ControlSize,
    pub enabled: bool,
    pub on_click: Option<Rc<dyn Fn()>>,
}

#[derive(Clone)]
pub struct FabWidget {
    pub icon: IconName,
    pub label: String,
    pub on_click: Option<Rc<dyn Fn()>>,
}

#[derive(Clone)]
pub struct AvatarWidget {
    pub initials: String,
    pub size: f32,
    pub tone: SurfaceTone,
}

#[derive(Clone)]
pub struct SpinnerWidget {
    pub size: f32,
}

#[derive(Clone)]
pub struct SkeletonWidget {
    pub height: f32,
    pub radius: f32,
}

#[derive(Clone)]
pub struct RadioWidget {
    pub label: String,
    pub group: Signal<usize>,
    pub value: usize,
    pub enabled: bool,
}

#[derive(Clone)]
pub struct SliderWidget {
    pub value: Signal<f32>,
    pub label: Option<String>,
}

#[derive(Clone)]
pub struct OtpWidget {
    pub value: Signal<String>,
    pub length: usize,
}

#[derive(Clone)]
pub struct CheckboxWidget {
    pub label: String,
    pub checked: Signal<bool>,
    pub enabled: bool,
}

#[derive(Clone)]
pub struct SwitchWidget {
    pub label: String,
    pub checked: Signal<bool>,
    pub enabled: bool,
}

#[derive(Clone)]
pub struct SelectWidget {
    pub label: String,
    pub options: Vec<String>,
    pub selected: Signal<usize>,
    pub enabled: bool,
}

#[derive(Clone)]
pub struct ProgressWidget {
    pub value: f32,
    pub label: Option<String>,
}

#[derive(Clone)]
pub struct FormProgressWidget {
    pub value: f32,
    pub label: String,
}

#[derive(Clone)]
pub struct NavItem {
    pub icon: IconName,
    pub label: String,
}

#[derive(Clone)]
pub struct NavWidget {
    pub items: Vec<NavItem>,
    pub selected: Signal<usize>,
    pub on_select: Option<Rc<dyn Fn(usize)>>,
    pub vertical: Responsive<bool>,
    pub expanded: bool,
}

#[derive(Clone)]
pub struct TagWidget {
    pub label: String,
    pub variant: TagVariant,
}

#[derive(Clone)]
pub struct IconWidget {
    pub icon: IconName,
    pub tone: TextTone,
}

#[derive(Clone)]
pub struct TableWidget {
    pub headers: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub column_weights: Option<Vec<f32>>,
    pub striped: bool,
    pub tag_column: Option<usize>,
    pub tag_variant: TagVariant,
    pub compact: bool,
    pub selected_row: Option<usize>,
    pub sort_column: Option<usize>,
    pub sort_ascending: bool,
    pub page: Option<Signal<usize>>,
    pub pages: usize,
}

#[derive(Clone, Debug, PartialEq)]
pub struct DataColumn {
    pub title: String,
    pub width: f32,
    pub align: Align,
    pub tag: Option<TagVariant>,
}

#[derive(Clone)]
pub struct DataTableState {
    pub order: Signal<Vec<usize>>,
    pub widths: Signal<Vec<f32>>,
    pub compact: Signal<bool>,
    pub selected: Signal<Vec<usize>>,
    pub sort: Signal<Option<usize>>,
    pub sort_ascending: Signal<bool>,
    pub page: Signal<usize>,
    pub pages: usize,
    pub scroll: Signal<f32>,
}

#[derive(Clone)]
pub struct DataTableWidget {
    pub columns: Vec<DataColumn>,
    pub rows: Rc<Vec<Vec<String>>>,
    pub state: DataTableState,
    pub viewport_height: Option<f32>,
    pub row_height: f32,
    pub compact_row_height: f32,
    pub display_total: Option<usize>,
    pub display_range: Option<(usize, usize, usize)>,
}

#[derive(Clone)]
pub struct DividerWidget {
    pub vertical: bool,
}

#[derive(Clone)]
pub enum WidgetKind {
    Container(ContainerProps),
    Card(CardProps),
    Grid(GridProps),
    Text(TextWidget),
    Heading(HeadingWidget),
    Button(ButtonWidget),
    TextField(TextFieldWidget),
    Checkbox(CheckboxWidget),
    Switch(SwitchWidget),
    Select(SelectWidget),
    Progress(ProgressWidget),
    FormProgress(FormProgressWidget),
    Navigation(NavWidget),
    Table(TableWidget),
    Tag(TagWidget),
    Icon(IconWidget),
    Link(LinkWidget),
    IconButton(IconButtonWidget),
    Fab(FabWidget),
    Avatar(AvatarWidget),
    Spinner(SpinnerWidget),
    Skeleton(SkeletonWidget),
    Radio(RadioWidget),
    Slider(SliderWidget),
    Otp(OtpWidget),
    DataTable(DataTableWidget),
    Divider(DividerWidget),
    Spacer(f32),
}

#[derive(Clone)]
pub struct Widget {
    pub kind: WidgetKind,
    pub width: Length,
    pub height: Length,
    pub grow: f32,
    pub background: Option<Color>,
    pub radius: Option<f32>,
    pub border: Option<Border>,
    pub opacity: f32,
    pub translate: Point,
    pub max_width: Option<f32>,
    pub min_height: Option<f32>,
    pub responsive_padding: Option<Responsive<Edges>>,
    pub surface_tone: Option<SurfaceTone>,
    pub visible: Option<Responsive<bool>>,
    pub pin_bottom: bool,
    pub fill_viewport_height: bool,
    pub click: Option<Rc<dyn Fn()>>,
    pub key: Option<&'static str>,
    pub scrollable: Option<Signal<f32>>,
}

impl Widget {
    pub fn new(kind: WidgetKind) -> Self {
        Self {
            kind,
            width: Length::Auto,
            height: Length::Auto,
            grow: 0.0,
            background: None,
            radius: None,
            border: None,
            opacity: 1.0,
            translate: Point::new(0.0, 0.0),
            max_width: None,
            min_height: None,
            responsive_padding: None,
            surface_tone: None,
            visible: None,
            pin_bottom: false,
            fill_viewport_height: false,
            click: None,
            key: None,
            scrollable: None,
        }
    }

    pub fn column(children: Vec<Widget>) -> Self {
        Self::new(WidgetKind::Container(ContainerProps {
            direction: Direction::Vertical,
            direction_override: None,
            gap: 0.0,
            align: Align::Stretch,
            justify: Justify::Start,
            wrap: false,
            overlay: false,
            padding: Edges::ZERO,
            children,
        }))
    }

    pub fn container(direction: Direction, children: Vec<Widget>) -> Self {
        Self::new(WidgetKind::Container(ContainerProps {
            direction,
            direction_override: None,
            gap: 0.0,
            align: Align::Stretch,
            justify: Justify::Start,
            wrap: false,
            overlay: false,
            padding: Edges::ZERO,
            children,
        }))
    }

    pub fn boxed(children: Vec<Widget>) -> Self {
        Self::container(Direction::Vertical, children)
    }

    pub fn adaptive(direction: Responsive<Direction>, children: Vec<Widget>) -> Self {
        Self::new(WidgetKind::Container(ContainerProps {
            direction: Direction::Vertical,
            direction_override: Some(direction),
            gap: 0.0,
            align: Align::Stretch,
            justify: Justify::Start,
            wrap: false,
            overlay: false,
            padding: Edges::ZERO,
            children,
        }))
    }

    pub fn row(children: Vec<Widget>) -> Self {
        Self::new(WidgetKind::Container(ContainerProps {
            direction: Direction::Horizontal,
            direction_override: None,
            gap: 0.0,
            align: Align::Center,
            justify: Justify::Start,
            wrap: false,
            overlay: false,
            padding: Edges::ZERO,
            children,
        }))
    }

    pub fn stack(children: Vec<Widget>) -> Self {
        Self::new(WidgetKind::Container(ContainerProps {
            direction: Direction::Vertical,
            direction_override: None,
            gap: 0.0,
            align: Align::Start,
            justify: Justify::Start,
            wrap: false,
            overlay: true,
            padding: Edges::ZERO,
            children,
        }))
    }

    pub fn card(children: Vec<Widget>) -> Self {
        Self::new(WidgetKind::Card(CardProps {
            padding: Edges::all(20.0),
            gap: 0.0,
            children,
            elevation: 2.0,
        }))
    }

    pub fn grid(columns: Responsive<usize>, children: Vec<Widget>) -> Self {
        Self::new(WidgetKind::Grid(GridProps {
            columns,
            column_gap: 16.0,
            row_gap: 16.0,
            padding: Edges::ZERO,
            children,
        }))
    }

    pub fn text(content: impl Into<String>) -> Self {
        let typography = Typography::default();
        Self::new(WidgetKind::Text(TextWidget {
            content: content.into(),
            style: typography.body_medium,
            color: None,
            tone: None,
            align: Align::Start,
        }))
    }

    pub fn heading(content: impl Into<String>, level: u8) -> Self {
        Self::new(WidgetKind::Heading(HeadingWidget {
            content: content.into(),
            level: level.clamp(1, 6),
            color: None,
            tone: None,
        }))
    }

    pub fn button(label: impl Into<String>) -> Self {
        Self::new(WidgetKind::Button(ButtonWidget {
            label: label.into(),
            variant: ButtonVariant::Primary,
            size: ControlSize::Medium,
            enabled: true,
            loading: false,
            icon: None,
            on_click: None,
        }))
    }

    pub fn text_field(field: &Field<String>, label: impl Into<String>) -> Self {
        Self::new(WidgetKind::TextField(TextFieldWidget {
            label: label.into(),
            value: field.value,
            errors: Some(field.errors),
            touched: Some(field.touched),
            placeholder: String::new(),
            password: false,
            enabled: true,
            help: None,
            on_submit: None,
            multiline: false,
            leading_icon: None,
            invalid: false,
        }))
    }

    pub fn text_field_plain(label: impl Into<String>, value: Signal<String>) -> Self {
        Self::new(WidgetKind::TextField(TextFieldWidget {
            label: label.into(),
            value,
            errors: None,
            touched: None,
            placeholder: String::new(),
            password: false,
            enabled: true,
            help: None,
            on_submit: None,
            multiline: false,
            leading_icon: None,
            invalid: false,
        }))
    }

    pub fn checkbox(field: &Field<bool>, label: impl Into<String>) -> Self {
        Self::new(WidgetKind::Checkbox(CheckboxWidget {
            label: label.into(),
            checked: field.value,
            enabled: true,
        }))
    }

    pub fn checkbox_signal(label: impl Into<String>, checked: Signal<bool>) -> Self {
        Self::new(WidgetKind::Checkbox(CheckboxWidget {
            label: label.into(),
            checked,
            enabled: true,
        }))
    }

    pub fn switch(field: &Field<bool>, label: impl Into<String>) -> Self {
        Self::new(WidgetKind::Switch(SwitchWidget {
            label: label.into(),
            checked: field.value,
            enabled: true,
        }))
    }

    pub fn switch_signal(label: impl Into<String>, checked: Signal<bool>) -> Self {
        Self::new(WidgetKind::Switch(SwitchWidget {
            label: label.into(),
            checked,
            enabled: true,
        }))
    }

    pub fn select(label: impl Into<String>, options: Vec<String>, selected: Signal<usize>) -> Self {
        Self::new(WidgetKind::Select(SelectWidget {
            label: label.into(),
            options,
            selected,
            enabled: true,
        }))
    }

    pub fn progress(value: f32) -> Self {
        Self::new(WidgetKind::Progress(ProgressWidget {
            value: value.clamp(0.0, 1.0),
            label: None,
        }))
    }

    pub fn form_progress(value: f32) -> Self {
        Self::new(WidgetKind::FormProgress(FormProgressWidget {
            value: value.clamp(0.0, 1.0),
            label: "Заполнено".to_string(),
        }))
    }

    pub fn nav_rail(items: Vec<NavItem>, selected: Signal<usize>) -> Self {
        Self::new(WidgetKind::Navigation(NavWidget {
            items,
            selected,
            on_select: None,
            vertical: Responsive::constant(true),
            expanded: false,
        }))
    }

    pub fn nav_bar(items: Vec<NavItem>, selected: Signal<usize>) -> Self {
        Self::new(WidgetKind::Navigation(NavWidget {
            items,
            selected,
            on_select: None,
            vertical: Responsive::constant(false),
            expanded: false,
        }))
    }

    pub fn expanded(mut self, expanded: bool) -> Self {
        if let WidgetKind::Navigation(widget) = &mut self.kind {
            widget.expanded = expanded;
        }
        self
    }

    pub fn nav_orientation(mut self, vertical: Responsive<bool>) -> Self {
        if let WidgetKind::Navigation(widget) = &mut self.kind {
            widget.vertical = vertical;
        }
        self
    }

    pub fn data_table(
        columns: Vec<DataColumn>,
        rows: impl Into<Rc<Vec<Vec<String>>>>,
        state: DataTableState,
        viewport_height: Option<f32>,
    ) -> Self {
        Self::new(WidgetKind::DataTable(DataTableWidget {
            columns,
            rows: rows.into(),
            state,
            viewport_height,
            row_height: 56.0,
            compact_row_height: 48.0,
            display_total: None,
            display_range: None,
        }))
    }

    pub fn total_rows(mut self, total: usize) -> Self {
        if let WidgetKind::DataTable(table) = &mut self.kind {
            table.display_total = Some(total);
        }
        self
    }

    pub fn display_range(mut self, first: usize, last: usize, total: usize) -> Self {
        if let WidgetKind::DataTable(table) = &mut self.kind {
            table.display_range = Some((first, last, total));
        }
        self
    }

    pub fn table(headers: Vec<String>, rows: Vec<Vec<String>>) -> Self {
        Self::new(WidgetKind::Table(TableWidget {
            headers,
            rows,
            column_weights: None,
            striped: false,
            tag_column: None,
            tag_variant: TagVariant::Primary,
            compact: false,
            selected_row: None,
            sort_column: None,
            sort_ascending: true,
            page: None,
            pages: 1,
        }))
    }

    pub fn tag(label: impl Into<String>, variant: TagVariant) -> Self {
        Self::new(WidgetKind::Tag(TagWidget {
            label: label.into(),
            variant,
        }))
    }

    pub fn badge(label: impl Into<String>, variant: TagVariant) -> Self {
        Self::tag(label, variant)
    }

    pub fn glyph(icon: IconName) -> Self {
        Self::new(WidgetKind::Icon(IconWidget {
            icon,
            tone: TextTone::Secondary,
        }))
    }

    pub fn icon_tone(mut self, tone: TextTone) -> Self {
        if let WidgetKind::Icon(widget) = &mut self.kind {
            widget.tone = tone;
        }
        self
    }

    pub fn divider() -> Self {
        Self::new(WidgetKind::Divider(DividerWidget { vertical: false }))
    }

    pub fn vertical_divider() -> Self {
        Self::new(WidgetKind::Divider(DividerWidget { vertical: true }))
    }

    pub fn spacer(size: f32) -> Self {
        Self::new(WidgetKind::Spacer(size))
    }

    pub fn width(mut self, width: Length) -> Self {
        self.width = width;
        self
    }

    pub fn width_px(mut self, width: f32) -> Self {
        self.width = Length::Px(width);
        self
    }

    pub fn height(mut self, height: Length) -> Self {
        self.height = height;
        self
    }

    pub fn height_px(mut self, height: f32) -> Self {
        self.height = Length::Px(height);
        self
    }

    pub fn grow(mut self, grow: f32) -> Self {
        self.grow = grow;
        self
    }

    pub fn background(mut self, color: Color) -> Self {
        self.background = Some(color);
        self
    }

    pub fn radius(mut self, radius: f32) -> Self {
        self.radius = Some(radius);
        self
    }

    pub fn border(mut self, border: Border) -> Self {
        self.border = Some(border);
        self
    }

    pub fn opacity(mut self, opacity: f32) -> Self {
        self.opacity = opacity.clamp(0.0, 1.0);
        self
    }

    pub fn translate(mut self, x: f32, y: f32) -> Self {
        self.translate = Point::new(x, y);
        self
    }

    pub fn max_width(mut self, width: f32) -> Self {
        self.max_width = Some(width);
        self
    }

    pub fn min_height(mut self, height: f32) -> Self {
        self.min_height = Some(height);
        self
    }

    pub fn padding_responsive(mut self, padding: Responsive<Edges>) -> Self {
        self.responsive_padding = Some(padding);
        self
    }

    pub fn surface(mut self, tone: SurfaceTone) -> Self {
        self.surface_tone = Some(tone);
        self
    }

    pub fn visible_when(mut self, values: Responsive<bool>) -> Self {
        self.visible = Some(values);
        self
    }

    pub fn pin_bottom(mut self) -> Self {
        self.pin_bottom = true;
        self
    }

    pub fn fill_viewport_height(mut self) -> Self {
        self.fill_viewport_height = true;
        self
    }

    pub fn clickable(mut self, handler: impl Fn() + 'static) -> Self {
        self.click = Some(Rc::new(handler));
        self
    }

    pub fn key(mut self, key: &'static str) -> Self {
        self.key = Some(key);
        self
    }

    pub fn scrollable(mut self, scroll: Signal<f32>) -> Self {
        self.scrollable = Some(scroll);
        self
    }

    pub fn gap(mut self, gap: f32) -> Self {
        match &mut self.kind {
            WidgetKind::Container(props) => props.gap = gap,
            WidgetKind::Card(props) => props.gap = gap,
            WidgetKind::Grid(props) => {
                props.column_gap = gap;
                props.row_gap = gap;
            }
            _ => {}
        }
        self
    }

    pub fn padding(mut self, padding: Edges) -> Self {
        match &mut self.kind {
            WidgetKind::Container(props) => props.padding = padding,
            WidgetKind::Card(props) => props.padding = padding,
            WidgetKind::Grid(props) => props.padding = padding,
            _ => {}
        }
        self
    }

    pub fn padding_all(self, padding: f32) -> Self {
        self.padding(Edges::all(padding))
    }

    pub fn align(mut self, align: Align) -> Self {
        if let WidgetKind::Container(props) = &mut self.kind {
            props.align = align;
        }
        self
    }

    pub fn justify(mut self, justify: Justify) -> Self {
        if let WidgetKind::Container(props) = &mut self.kind {
            props.justify = justify;
        }
        self
    }

    pub fn wrap(mut self) -> Self {
        if let WidgetKind::Container(props) = &mut self.kind {
            props.wrap = true;
        }
        self
    }

    pub fn style(mut self, style: TextStyle) -> Self {
        if let WidgetKind::Text(widget) = &mut self.kind {
            widget.style = style;
        }
        self
    }

    pub fn color(mut self, color: Color) -> Self {
        match &mut self.kind {
            WidgetKind::Text(widget) => widget.color = Some(color),
            WidgetKind::Heading(widget) => widget.color = Some(color),
            _ => {}
        }
        self
    }

    pub fn tone(mut self, tone: TextTone) -> Self {
        match &mut self.kind {
            WidgetKind::Text(widget) => widget.tone = Some(tone),
            WidgetKind::Heading(widget) => widget.tone = Some(tone),
            _ => {}
        }
        self
    }

    pub fn variant(mut self, variant: ButtonVariant) -> Self {
        if let WidgetKind::Button(widget) = &mut self.kind {
            widget.variant = variant;
        }
        self
    }

    pub fn size(mut self, size: ControlSize) -> Self {
        if let WidgetKind::Button(widget) = &mut self.kind {
            widget.size = size;
        }
        self
    }

    pub fn enabled(mut self, enabled: bool) -> Self {
        match &mut self.kind {
            WidgetKind::Button(widget) => widget.enabled = enabled,
            WidgetKind::TextField(widget) => widget.enabled = enabled,
            WidgetKind::Checkbox(widget) => widget.enabled = enabled,
            WidgetKind::Switch(widget) => widget.enabled = enabled,
            WidgetKind::Select(widget) => widget.enabled = enabled,
            _ => {}
        }
        self
    }

    pub fn loading(mut self, loading: bool) -> Self {
        if let WidgetKind::Button(widget) = &mut self.kind {
            widget.loading = loading;
        }
        self
    }

    pub fn icon(mut self, icon: IconName) -> Self {
        if let WidgetKind::Button(widget) = &mut self.kind {
            widget.icon = Some(icon);
        }
        self
    }

    pub fn on_click(mut self, handler: impl Fn() + 'static) -> Self {
        if let WidgetKind::Button(widget) = &mut self.kind {
            widget.on_click = Some(Rc::new(handler));
        }
        self
    }

    pub fn on_submit(mut self, handler: impl Fn() + 'static) -> Self {
        if let WidgetKind::TextField(widget) = &mut self.kind {
            widget.on_submit = Some(Rc::new(handler));
        }
        self
    }

    pub fn on_select(mut self, handler: impl Fn(usize) + 'static) -> Self {
        if let WidgetKind::Navigation(widget) = &mut self.kind {
            widget.on_select = Some(Rc::new(handler));
        }
        self
    }

    pub fn placeholder(mut self, placeholder: impl Into<String>) -> Self {
        if let WidgetKind::TextField(widget) = &mut self.kind {
            widget.placeholder = placeholder.into();
        }
        self
    }

    pub fn password(mut self) -> Self {
        if let WidgetKind::TextField(widget) = &mut self.kind {
            widget.password = true;
        }
        self
    }

    pub fn help(mut self, help: impl Into<String>) -> Self {
        if let WidgetKind::TextField(widget) = &mut self.kind {
            widget.help = Some(help.into());
        }
        self
    }

    pub fn progress_label(mut self, label: impl Into<String>) -> Self {
        if let WidgetKind::Progress(widget) = &mut self.kind {
            widget.label = Some(label.into());
        }
        self
    }

    pub fn form_label(mut self, label: impl Into<String>) -> Self {
        if let WidgetKind::FormProgress(widget) = &mut self.kind {
            widget.label = label.into();
        }
        self
    }

    pub fn column_weights(mut self, weights: Vec<f32>) -> Self {
        if let WidgetKind::Table(widget) = &mut self.kind {
            widget.column_weights = Some(weights);
        }
        self
    }

    pub fn multiline(mut self) -> Self {
        if let WidgetKind::TextField(widget) = &mut self.kind {
            widget.multiline = true;
        }
        self
    }

    pub fn leading_icon(mut self, icon: IconName) -> Self {
        if let WidgetKind::TextField(widget) = &mut self.kind {
            widget.leading_icon = Some(icon);
        }
        self
    }

    pub fn invalid(mut self, invalid: bool) -> Self {
        if let WidgetKind::TextField(widget) = &mut self.kind {
            widget.invalid = invalid;
        }
        self
    }

    pub fn link(label: impl Into<String>) -> Self {
        Self::new(WidgetKind::Link(LinkWidget {
            label: label.into(),
            on_click: None,
        }))
    }

    pub fn link_click(mut self, handler: impl Fn() + 'static) -> Self {
        if let WidgetKind::Link(widget) = &mut self.kind {
            widget.on_click = Some(Rc::new(handler));
        }
        self
    }

    pub fn icon_button(icon: IconName, label: impl Into<String>) -> Self {
        Self::new(WidgetKind::IconButton(IconButtonWidget {
            icon,
            label: label.into(),
            variant: ButtonVariant::Text,
            size: ControlSize::Medium,
            enabled: true,
            on_click: None,
        }))
    }

    pub fn icon_button_click(mut self, handler: impl Fn() + 'static) -> Self {
        if let WidgetKind::IconButton(widget) = &mut self.kind {
            widget.on_click = Some(Rc::new(handler));
        }
        self
    }

    pub fn fab(icon: IconName, label: impl Into<String>) -> Self {
        Self::new(WidgetKind::Fab(FabWidget {
            icon,
            label: label.into(),
            on_click: None,
        }))
    }

    pub fn fab_click(mut self, handler: impl Fn() + 'static) -> Self {
        if let WidgetKind::Fab(widget) = &mut self.kind {
            widget.on_click = Some(Rc::new(handler));
        }
        self
    }

    pub fn avatar(initials: impl Into<String>) -> Self {
        Self::new(WidgetKind::Avatar(AvatarWidget {
            initials: initials.into(),
            size: 36.0,
            tone: SurfaceTone::SecondaryContainer,
        }))
    }

    pub fn spinner() -> Self {
        Self::new(WidgetKind::Spinner(SpinnerWidget { size: 24.0 }))
    }

    pub fn skeleton(height: f32) -> Self {
        Self::new(WidgetKind::Skeleton(SkeletonWidget {
            height,
            radius: 8.0,
        }))
    }

    pub fn radio(label: impl Into<String>, group: Signal<usize>, value: usize) -> Self {
        Self::new(WidgetKind::Radio(RadioWidget {
            label: label.into(),
            group,
            value,
            enabled: true,
        }))
    }

    pub fn slider(value: Signal<f32>, label: Option<String>) -> Self {
        Self::new(WidgetKind::Slider(SliderWidget { value, label }))
    }

    pub fn otp(value: Signal<String>, length: usize) -> Self {
        Self::new(WidgetKind::Otp(OtpWidget {
            value,
            length: length.max(1),
        }))
    }

    pub fn table_compact(mut self, compact: bool) -> Self {
        if let WidgetKind::Table(widget) = &mut self.kind {
            widget.compact = compact;
        }
        self
    }

    pub fn selected_row(mut self, row: usize) -> Self {
        if let WidgetKind::Table(widget) = &mut self.kind {
            widget.selected_row = Some(row);
        }
        self
    }

    pub fn sort(mut self, column: usize, ascending: bool) -> Self {
        if let WidgetKind::Table(widget) = &mut self.kind {
            widget.sort_column = Some(column);
            widget.sort_ascending = ascending;
        }
        self
    }

    pub fn pagination(mut self, page: Signal<usize>, pages: usize) -> Self {
        if let WidgetKind::Table(widget) = &mut self.kind {
            widget.page = Some(page);
            widget.pages = pages.max(1);
        }
        self
    }

    pub fn striped(mut self, striped: bool) -> Self {
        if let WidgetKind::Table(widget) = &mut self.kind {
            widget.striped = striped;
        }
        self
    }

    pub fn tag_column(mut self, column: usize, variant: TagVariant) -> Self {
        if let WidgetKind::Table(widget) = &mut self.kind {
            widget.tag_column = Some(column);
            widget.tag_variant = variant;
        }
        self
    }

    pub fn children(&self) -> Option<&[Widget]> {
        match &self.kind {
            WidgetKind::Container(props) => Some(&props.children),
            WidgetKind::Card(props) => Some(&props.children),
            WidgetKind::Grid(props) => Some(&props.children),
            _ => None,
        }
    }

    pub fn children_mut(&mut self) -> Option<&mut Vec<Widget>> {
        match &mut self.kind {
            WidgetKind::Container(props) => Some(&mut props.children),
            WidgetKind::Card(props) => Some(&mut props.children),
            WidgetKind::Grid(props) => Some(&mut props.children),
            _ => None,
        }
    }

    pub fn track_signals(&self) {
        match &self.kind {
            WidgetKind::TextField(widget) => {
                let _ = widget.value.get();
                if let Some(errors) = widget.errors {
                    let _ = errors.get();
                }
                if let Some(touched) = widget.touched {
                    let _ = touched.get();
                }
            }
            WidgetKind::Checkbox(widget) => {
                let _ = widget.checked.get();
            }
            WidgetKind::Switch(widget) => {
                let _ = widget.checked.get();
            }
            WidgetKind::Select(widget) => {
                let _ = widget.selected.get();
            }
            WidgetKind::Navigation(widget) => {
                let _ = widget.selected.get();
            }
            WidgetKind::Radio(widget) => {
                let _ = widget.group.get();
            }
            WidgetKind::Slider(widget) => {
                let _ = widget.value.get();
            }
            WidgetKind::Otp(widget) => {
                let _ = widget.value.get();
            }
            WidgetKind::DataTable(widget) => {
                let _ = widget.state.order.get();
                let _ = widget.state.widths.get();
                let _ = widget.state.compact.get();
                let _ = widget.state.selected.get();
                let _ = widget.state.sort.get();
                let _ = widget.state.sort_ascending.get();
                let _ = widget.state.page.get();
                let _ = widget.state.scroll.get();
            }
            _ => {}
        }
        if let Some(children) = self.children() {
            for child in children {
                child.track_signals();
            }
        }
    }
}

pub fn display_large() -> TextStyle {
    Typography::default().display_large
}

pub fn display_medium() -> TextStyle {
    Typography::default().display_medium
}

pub fn headline_large() -> TextStyle {
    Typography::default().headline_large
}

pub fn headline_medium() -> TextStyle {
    Typography::default().headline_medium
}

pub fn headline_small() -> TextStyle {
    Typography::default().headline_small
}

pub fn title_large() -> TextStyle {
    Typography::default().title_large
}

pub fn title_medium() -> TextStyle {
    Typography::default().title_medium
}

pub fn title_small() -> TextStyle {
    Typography::default().title_small
}

pub fn body_large() -> TextStyle {
    Typography::default().body_large
}

pub fn body_medium() -> TextStyle {
    Typography::default().body_medium
}

pub fn body_small() -> TextStyle {
    Typography::default().body_small
}

pub fn label_large() -> TextStyle {
    Typography::default().label_large
}

pub fn label_medium() -> TextStyle {
    Typography::default().label_medium
}

pub fn label_small() -> TextStyle {
    Typography::default().label_small
}

pub fn caption() -> TextStyle {
    TextStyle::new(11.0, 14.0, FontWeight::Regular)
}

pub fn brand() -> TextStyle {
    Typography::default().brand
}

pub fn subtitle() -> TextStyle {
    Typography::default().subtitle
}

pub fn hint() -> TextStyle {
    Typography::default().hint
}

pub fn footer() -> TextStyle {
    Typography::default().footer
}

#[macro_export]
macro_rules! column {
    ([$($children:expr),* $(,)?]) => {
        $crate::widget::Widget::column(vec![$($children),*])
    };
    (gap: $gap:expr, [$($children:expr),* $(,)?]) => {
        $crate::widget::Widget::column(vec![$($children),*]).gap($gap)
    };
    (padding: $padding:expr, [$($children:expr),* $(,)?]) => {
        $crate::widget::Widget::column(vec![$($children),*]).padding_all($padding)
    };
    (gap: $gap:expr, padding: $padding:expr, [$($children:expr),* $(,)?]) => {
        $crate::widget::Widget::column(vec![$($children),*])
            .gap($gap)
            .padding_all($padding)
    };
    ($($children:expr),* $(,)?) => {
        $crate::widget::Widget::column(vec![$($children),*])
    };
}

#[macro_export]
macro_rules! row {
    ([$($children:expr),* $(,)?]) => {
        $crate::widget::Widget::row(vec![$($children),*])
    };
    (gap: $gap:expr, [$($children:expr),* $(,)?]) => {
        $crate::widget::Widget::row(vec![$($children),*]).gap($gap)
    };
    (padding: $padding:expr, [$($children:expr),* $(,)?]) => {
        $crate::widget::Widget::row(vec![$($children),*]).padding_all($padding)
    };
    (gap: $gap:expr, padding: $padding:expr, [$($children:expr),* $(,)?]) => {
        $crate::widget::Widget::row(vec![$($children),*])
            .gap($gap)
            .padding_all($padding)
    };
    ($($children:expr),* $(,)?) => {
        $crate::widget::Widget::row(vec![$($children),*])
    };
}

#[macro_export]
macro_rules! text {
    ($content:expr) => {
        $crate::widget::Widget::text($content)
    };
    ($content:expr, style: $style:expr) => {
        $crate::widget::Widget::text($content).style($style)
    };
    ($content:expr, style: $style:expr, color: $color:expr) => {
        $crate::widget::Widget::text($content)
            .style($style)
            .color($color)
    };
}

#[macro_export]
macro_rules! heading {
    ($content:expr, $level:expr) => {
        $crate::widget::Widget::heading($content, $level)
    };
}

#[macro_export]
macro_rules! text_field {
    ($field:expr, label: $label:expr, password $(,)?) => {
        $crate::widget::Widget::text_field($field, $label).password()
    };
    ($field:expr, label: $label:expr $(,)?) => {
        $crate::widget::Widget::text_field($field, $label)
    };
}

#[macro_export]
macro_rules! checkbox {
    ($field:expr, label: $label:expr $(,)?) => {
        $crate::widget::Widget::checkbox($field, $label)
    };
}

#[macro_export]
macro_rules! button {
    ($label:expr $(,)?) => {
        $crate::widget::Widget::button($label)
    };
    ($label:expr, enabled: $enabled:expr $(,)?) => {
        $crate::widget::Widget::button($label).enabled($enabled)
    };
    ($label:expr, enabled: $enabled:expr, loading: $loading:expr $(,)?) => {
        $crate::widget::Widget::button($label)
            .enabled($enabled)
            .loading($loading)
    };
}

#[macro_export]
macro_rules! form_progress {
    ($form:expr $(,)?) => {
        $crate::widget::Widget::form_progress($form.completion())
    };
}
