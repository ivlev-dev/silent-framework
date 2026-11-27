use std::collections::HashMap;
use std::rc::Rc;

use crate::color::Color;
use crate::damage::Damage;
use crate::geometry::{
    Align, Constraints, Direction, Edges, Justify, LayoutContext, Length, Point, Rect, Size,
};
use crate::signal::Signal;
use crate::theme::{FontWeight, TextStyle, Theme};
use crate::widget::{
    Border, ButtonVariant, ButtonWidget, CardProps, CheckboxWidget, ContainerProps, ControlSize,
    DataColumn, DataTableState, DataTableWidget, DividerWidget, FormProgressWidget, GridProps,
    HeadingWidget, IconName, NavWidget, ProgressWidget, SelectWidget, SurfaceTone, SwitchWidget,
    TableWidget, TagVariant, TagWidget, TextFieldWidget, TextWidget, Widget, WidgetKind,
};

pub type NodeId = u64;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    Generic,
    Group,
    Text,
    Heading,
    Button,
    TextField,
    Checkbox,
    Switch,
    Select,
    Progress,
    Navigation,
    Table,
    Card,
    Divider,
    Link,
    Radio,
    Slider,
    Otp,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum CursorShape {
    #[default]
    Default,
    Pointer,
    Text,
    Grab,
    Grabbing,
    ResizeHorizontal,
}

#[derive(Clone)]
pub struct EditBinding {
    pub value: Signal<String>,
    pub on_submit: Option<Rc<dyn Fn()>>,
    pub touched: Option<Signal<bool>>,
    pub multiline: bool,
}

#[derive(Clone)]
pub struct Interaction {
    pub enabled: bool,
    pub focusable: bool,
    pub click: Option<Rc<dyn Fn()>>,
    pub edit: Option<EditBinding>,
    pub slider: Option<Signal<f32>>,
    pub data_table: Option<DataTableState>,
    pub data_table_defaults: Option<Vec<f32>>,
}

impl Default for Interaction {
    fn default() -> Self {
        Self {
            enabled: true,
            focusable: false,
            click: None,
            edit: None,
            slider: None,
            data_table: None,
            data_table_defaults: None,
        }
    }
}

impl Interaction {
    pub fn is_interactive(&self) -> bool {
        self.enabled && (self.focusable || self.click.is_some() || self.edit.is_some())
    }

    pub fn cursor(&self) -> CursorShape {
        if self.edit.is_some() {
            CursorShape::Text
        } else if self.click.is_some() || self.focusable {
            CursorShape::Pointer
        } else {
            CursorShape::Default
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum PaintData {
    None,
    Text {
        text: String,
        style: TextStyle,
        color: Color,
        align: Align,
    },
    Button {
        label: String,
        variant: ButtonVariant,
        size: ControlSize,
        icon: Option<IconName>,
        loading: bool,
        enabled: bool,
        hovered: bool,
        pressed: bool,
    },
    TextField {
        value: String,
        label: String,
        placeholder: String,
        password: bool,
        invalid: bool,
        focused: bool,
        hovered: bool,
        enabled: bool,
        leading_icon: Option<IconName>,
        caret: Option<usize>,
        selection: Option<(usize, usize)>,
        help: Option<String>,
    },
    Checkbox {
        label: String,
        checked: bool,
        focused: bool,
        hovered: bool,
    },
    Switch {
        label: String,
        checked: bool,
        focused: bool,
        hovered: bool,
    },
    Select {
        label: String,
        value: String,
        focused: bool,
    },
    Progress {
        value: f32,
        label: Option<String>,
    },
    FormProgress {
        value: f32,
        label: String,
    },
    NavItem {
        icon: IconName,
        label: String,
        selected: bool,
        vertical: bool,
        expanded: bool,
        hovered: bool,
    },
    Table {
        headers: Vec<String>,
        rows: Vec<Vec<String>>,
        weights: Vec<f32>,
        striped: bool,
        tag_column: Option<usize>,
        tag_variant: TagVariant,
        compact: bool,
        selected_row: Option<usize>,
        sort_column: Option<usize>,
        sort_ascending: bool,
        page: Option<usize>,
        pages: usize,
    },
    Tag {
        label: String,
        variant: TagVariant,
    },
    Icon {
        icon: IconName,
        color: Color,
    },
    Link {
        label: String,
        color: Color,
        hovered: bool,
    },
    IconButton {
        icon: IconName,
        label: String,
        variant: ButtonVariant,
        size: ControlSize,
        enabled: bool,
        hovered: bool,
        pressed: bool,
    },
    Fab {
        icon: IconName,
    },
    Avatar {
        initials: String,
        background: Color,
        foreground: Color,
    },
    Spinner,
    Skeleton {
        radius: f32,
    },
    Radio {
        label: String,
        checked: bool,
        focused: bool,
        hovered: bool,
    },
    Slider {
        value: f32,
        label: Option<String>,
    },
    Otp {
        value: String,
        length: usize,
        focused: bool,
    },
    DataTable {
        columns: Vec<DataColumn>,
        rows: Vec<(usize, Vec<String>)>,
        widths: Vec<f32>,
        compact: bool,
        selected: Vec<usize>,
        sort: Option<usize>,
        sort_ascending: bool,
        page: usize,
        pages: usize,
        scroll: f32,
        total_rows: usize,
        display_total: Option<usize>,
        display_range: Option<(usize, usize, usize)>,
        hover_column: Option<usize>,
        hover_row: Option<usize>,
        drag: Option<DataTableDragView>,
    },
    Divider {
        vertical: bool,
    },
}

#[derive(Clone, Debug, PartialEq)]
pub enum DataTableDragMode {
    Reorder,
    Resize,
}

#[derive(Clone, Debug, PartialEq)]
pub struct DataTableDragView {
    pub mode: DataTableDragMode,
    pub source: usize,
    pub target: usize,
    pub ghost_x: f32,
    pub width_badge: Option<f32>,
    pub applied: bool,
}

#[derive(Clone)]
pub struct LayoutNode {
    pub id: NodeId,
    pub rect: Rect,
    pub clip: Rect,
    pub background: Option<Color>,
    pub border: Option<Border>,
    pub radius: f32,
    pub shadow: f32,
    pub paint: PaintData,
    pub interaction: Interaction,
    pub role: Role,
    pub label: Option<String>,
    pub value: Option<String>,
    pub selected: bool,
    pub hovered: bool,
    pub key: Option<&'static str>,
    pub scrollable: bool,
    pub scroll_offset: f32,
    pub content_height: f32,
    pub scroll_signal: Option<Signal<f32>>,
    pub children: Vec<LayoutNode>,
}

impl LayoutNode {
    pub fn is_interactive(&self) -> bool {
        self.interaction.is_interactive()
    }

    pub fn scrollable_at(&self, point: Point) -> Option<&LayoutNode> {
        if !self.rect.contains(point) {
            return None;
        }
        for child in self.children.iter().rev() {
            if let Some(node) = child.scrollable_at(point) {
                return Some(node);
            }
        }
        self.scrollable.then_some(self)
    }

    pub fn find_key(&self, key: &str) -> Option<&LayoutNode> {
        if self.key == Some(key) {
            return Some(self);
        }
        for child in &self.children {
            if let Some(node) = child.find_key(key) {
                return Some(node);
            }
        }
        None
    }

    pub fn find(&self, id: NodeId) -> Option<&LayoutNode> {
        if self.id == id {
            return Some(self);
        }
        for child in &self.children {
            if let Some(node) = child.find(id) {
                return Some(node);
            }
        }
        None
    }

    pub fn hit(&self, point: Point) -> Option<&LayoutNode> {
        if !self.clip.contains(point) || !self.rect.contains(point) {
            return None;
        }
        for child in self.children.iter().rev() {
            if let Some(node) = child.hit(point) {
                return Some(node);
            }
        }
        if self.is_interactive() {
            Some(self)
        } else {
            None
        }
    }

    pub fn hit_any(&self, point: Point) -> Option<&LayoutNode> {
        if !self.clip.contains(point) || !self.rect.contains(point) {
            return None;
        }
        for child in self.children.iter().rev() {
            if let Some(node) = child.hit_any(point) {
                return Some(node);
            }
        }
        Some(self)
    }

    pub fn collect_focusables(&self, out: &mut Vec<NodeId>) {
        if self.interaction.enabled && self.interaction.focusable {
            out.push(self.id);
        }
        for child in &self.children {
            child.collect_focusables(out);
        }
    }

    pub fn node_count(&self) -> usize {
        1 + self
            .children
            .iter()
            .map(LayoutNode::node_count)
            .sum::<usize>()
    }

    pub fn set_clip(&mut self, clip: Rect) {
        self.clip = clip;
        for child in &mut self.children {
            child.set_clip(clip);
        }
    }

    pub fn translate(&mut self, dx: f32, dy: f32) {
        self.rect.x += dx;
        self.rect.y += dy;
        for child in &mut self.children {
            child.translate(dx, dy);
        }
    }
}

pub struct LayoutTree {
    pub root: LayoutNode,
    pub viewport: Size,
    focusables: Vec<NodeId>,
}

impl LayoutTree {
    pub fn hit_test(&self, point: Point) -> Option<&LayoutNode> {
        self.root.hit(point)
    }

    pub fn hit_test_any(&self, point: Point) -> Option<&LayoutNode> {
        self.root.hit_any(point)
    }

    pub fn find_key(&self, key: &str) -> Option<&LayoutNode> {
        self.root.find_key(key)
    }

    pub fn find(&self, id: NodeId) -> Option<&LayoutNode> {
        self.root.find(id)
    }

    pub fn focusables(&self) -> &[NodeId] {
        &self.focusables
    }

    pub fn next_focus(&self, current: Option<NodeId>, forward: bool) -> Option<NodeId> {
        if self.focusables.is_empty() {
            return None;
        }
        let len = self.focusables.len();
        let position = current.and_then(|id| self.focusables.iter().position(|f| *f == id));
        let next = match (position, forward) {
            (Some(index), true) => (index + 1) % len,
            (Some(index), false) => (index + len - 1) % len,
            (None, true) => 0,
            (None, false) => len - 1,
        };
        Some(self.focusables[next])
    }

    pub fn node_count(&self) -> usize {
        self.root.node_count()
    }
}

pub fn patch_interaction(tree: &mut LayoutTree, options: &LayoutOptions<'_>) -> Damage {
    let mut damage = Damage::NONE;
    patch_node(&mut tree.root, options, &mut damage);
    damage.expand(4.0)
}

fn patch_node(node: &mut LayoutNode, options: &LayoutOptions<'_>, damage: &mut Damage) {
    let before = node.paint.clone();
    let mut changed = false;
    let next_hovered = options.hover == Some(node.id) && node.interaction.enabled;
    if node.hovered != next_hovered {
        node.hovered = next_hovered;
        changed = true;
    }
    match &mut node.paint {
        PaintData::Button {
            hovered, pressed, ..
        } => {
            let next_hover = options.hover == Some(node.id);
            let next_press = options.pressed == Some(node.id);
            if *hovered != next_hover || *pressed != next_press {
                *hovered = next_hover;
                *pressed = next_press;
                changed = true;
            }
        }
        PaintData::IconButton {
            hovered, pressed, ..
        } => {
            let next_hover = options.hover == Some(node.id);
            let next_press = options.pressed == Some(node.id);
            if *hovered != next_hover || *pressed != next_press {
                *hovered = next_hover;
                *pressed = next_press;
                changed = true;
            }
        }
        PaintData::TextField {
            focused,
            hovered,
            caret,
            selection,
            ..
        } => {
            let next_focus = options.focus == Some(node.id);
            let next_caret = if next_focus {
                options.carets.get(&node.id).copied()
            } else {
                None
            };
            let next_selection = if next_focus {
                options.selections.get(&node.id).copied()
            } else {
                None
            };
            let next_hover = options.hover == Some(node.id) && node.interaction.enabled;
            if *focused != next_focus
                || *hovered != next_hover
                || *caret != next_caret
                || *selection != next_selection
            {
                *focused = next_focus;
                *hovered = next_hover;
                *caret = next_caret;
                *selection = next_selection;
                changed = true;
            }
        }
        PaintData::Checkbox {
            focused, hovered, ..
        }
        | PaintData::Switch {
            focused, hovered, ..
        }
        | PaintData::Radio {
            focused, hovered, ..
        } => {
            let next = options.focus == Some(node.id);
            let next_hover = options.hover == Some(node.id) && node.interaction.enabled;
            if *focused != next || *hovered != next_hover {
                *focused = next;
                *hovered = next_hover;
                changed = true;
            }
        }
        PaintData::Link { hovered, .. } => {
            let next_hover = options.hover == Some(node.id);
            if *hovered != next_hover {
                *hovered = next_hover;
                changed = true;
            }
        }
        PaintData::NavItem { hovered, .. } => {
            let next_hover = options.hover == Some(node.id);
            if *hovered != next_hover {
                *hovered = next_hover;
                changed = true;
            }
        }
        PaintData::DataTable {
            hover_column,
            hover_row,
            drag,
            ..
        } => {
            let next_hover = options
                .table_hover
                .and_then(|(id, column)| (id == node.id).then_some(column));
            let next_drag = options
                .table_drag
                .clone()
                .and_then(|(id, drag)| (id == node.id).then_some(drag));
            let next_row = options
                .table_hover_row
                .and_then(|(id, row)| (id == node.id).then_some(row));
            if *hover_column != next_hover || *hover_row != next_row || *drag != next_drag {
                *hover_column = next_hover;
                *hover_row = next_row;
                *drag = next_drag;
                changed = true;
            }
        }
        _ => {}
    }
    if changed && before != node.paint {
        *damage = damage.union(Damage::rect(node.rect));
    }
    for child in &mut node.children {
        patch_node(child, options, damage);
    }
}

pub fn compute_damage(previous: &LayoutTree, current: &LayoutTree) -> Damage {
    let mut damage = Damage::NONE;
    if previous.viewport != current.viewport {
        return Damage::full();
    }
    if !diff_node(&previous.root, &current.root, &mut damage) {
        return Damage::full();
    }
    damage
}

fn diff_node(previous: &LayoutNode, current: &LayoutNode, damage: &mut Damage) -> bool {
    if previous.id != current.id || previous.children.len() != current.children.len() {
        return false;
    }
    let visual_changed = previous.rect != current.rect
        || previous.clip != current.clip
        || previous.background != current.background
        || previous.border != current.border
        || previous.radius != current.radius
        || previous.shadow != current.shadow
        || previous.paint != current.paint
        || previous.role != current.role
        || previous.label != current.label
        || previous.value != current.value
        || previous.selected != current.selected
        || previous.interaction.enabled != current.interaction.enabled
        || previous.interaction.focusable != current.interaction.focusable;
    if visual_changed {
        *damage = damage.union(Damage::rect(previous.rect));
        *damage = damage.union(Damage::rect(current.rect));
    }
    for (old_child, new_child) in previous.children.iter().zip(current.children.iter()) {
        if !diff_node(old_child, new_child, damage) {
            return false;
        }
    }
    true
}

pub struct LayoutOptions<'a> {
    pub focus: Option<NodeId>,
    pub hover: Option<NodeId>,
    pub pressed: Option<NodeId>,
    pub table_hover: Option<(NodeId, usize)>,
    pub table_hover_row: Option<(NodeId, usize)>,
    pub table_drag: Option<(NodeId, DataTableDragView)>,
    pub carets: &'a HashMap<NodeId, usize>,
    pub selections: &'a HashMap<NodeId, (usize, usize)>,
}

impl<'a> Default for LayoutOptions<'a> {
    fn default() -> Self {
        Self::empty()
    }
}

impl<'a> LayoutOptions<'a> {
    pub fn empty() -> Self {
        static EMPTY_CARETS: std::sync::LazyLock<HashMap<NodeId, usize>> =
            std::sync::LazyLock::new(HashMap::new);
        static EMPTY_SELECTIONS: std::sync::LazyLock<HashMap<NodeId, (usize, usize)>> =
            std::sync::LazyLock::new(HashMap::new);
        Self {
            focus: None,
            hover: None,
            pressed: None,
            table_hover: None,
            table_hover_row: None,
            table_drag: None,
            carets: &EMPTY_CARETS,
            selections: &EMPTY_SELECTIONS,
        }
    }
}

struct Engine<'a> {
    theme: &'a Theme,
    viewport_width: f32,
    viewport_height: f32,
    focus: Option<NodeId>,
    hover: Option<NodeId>,
    pressed: Option<NodeId>,
    table_hover: Option<(NodeId, usize)>,
    table_hover_row: Option<(NodeId, usize)>,
    table_drag: Option<(NodeId, DataTableDragView)>,
    carets: &'a HashMap<NodeId, usize>,
    selections: &'a HashMap<NodeId, (usize, usize)>,
    next_id: NodeId,
}

pub fn layout(
    root: &Widget,
    viewport: Size,
    theme: &Theme,
    options: &LayoutOptions<'_>,
) -> LayoutTree {
    let mut engine = Engine {
        theme,
        viewport_width: viewport.width,
        viewport_height: viewport.height,
        focus: options.focus,
        hover: options.hover,
        pressed: options.pressed,
        table_hover: options.table_hover,
        table_hover_row: options.table_hover_row,
        table_drag: options.table_drag.clone(),
        carets: options.carets,
        selections: options.selections,
        next_id: 0,
    };
    let measure = engine.measure(root, viewport.width, Some(viewport.height));
    let width = match root.width {
        Length::Auto => viewport.width,
        Length::Px(value) => value.min(viewport.width),
        Length::Fraction(f) => viewport.width * f,
    };
    let height = match root.height {
        Length::Auto => measure.height.max(viewport.height),
        Length::Px(value) => value,
        Length::Fraction(f) => viewport.height * f,
    };
    let viewport_rect = Rect::new(0.0, 0.0, width, height);
    let root_node = engine.arrange(root, viewport_rect, viewport_rect);
    let mut focusables = Vec::new();
    root_node.collect_focusables(&mut focusables);
    LayoutTree {
        root: root_node,
        viewport: Size::new(width, height),
        focusables,
    }
}

impl Engine<'_> {
    fn tone_color(&self, tone: crate::widget::TextTone) -> Color {
        match tone {
            crate::widget::TextTone::Primary => self.theme.palette.text_primary,
            crate::widget::TextTone::Secondary => self.theme.palette.text_secondary,
            crate::widget::TextTone::Tertiary => self.theme.palette.text_tertiary,
            crate::widget::TextTone::Accent => self.theme.palette.primary,
            crate::widget::TextTone::OnPrimary => self.theme.palette.on_primary,
            crate::widget::TextTone::OnErrorContainer => self.theme.palette.on_error_container,
            crate::widget::TextTone::InverseOnSurface => self.theme.palette.inverse_on_surface,
            crate::widget::TextTone::Error => self.theme.palette.error,
        }
    }

    fn text_style_for_level(&self, level: u8) -> TextStyle {
        let typography = &self.theme.typography;
        match level {
            1 => typography.display_medium,
            2 => typography.headline_large,
            3 => typography.headline_medium,
            4 => typography.headline_small,
            5 => typography.title_large,
            _ => typography.title_medium,
        }
    }

    fn resolve_width(&self, widget: &Widget, measured: f32, available: f32) -> f32 {
        let available = if available.is_finite() {
            available
        } else {
            measured
        };
        let width = match widget.width {
            Length::Auto => measured.min(available),
            Length::Px(value) => value.min(available.max(0.0)),
            Length::Fraction(fraction) => available * fraction,
        };
        match widget.max_width {
            Some(max) => width.min(max.min(available.max(0.0))),
            None => width,
        }
    }

    fn padding_for(&self, widget: &Widget, fallback: Edges) -> Edges {
        widget
            .responsive_padding
            .as_ref()
            .map(|padding| padding.resolve(self.viewport_width))
            .unwrap_or(fallback)
    }

    fn surface_color(&self, tone: SurfaceTone) -> Color {
        let palette = &self.theme.palette;
        match tone {
            SurfaceTone::Page => palette.page,
            SurfaceTone::Surface => palette.surface_container,
            SurfaceTone::Lowest => palette.surface_container_lowest,
            SurfaceTone::Low => palette.surface_container_low,
            SurfaceTone::Container => palette.surface_container,
            SurfaceTone::High => palette.surface_container_high,
            SurfaceTone::Highest => palette.surface_container_highest,
            SurfaceTone::Card => self.theme.card_surface(),
            SurfaceTone::Rail => self.theme.rail_surface(),
            SurfaceTone::Primary => palette.primary,
            SurfaceTone::PrimaryContainer => palette.primary_container,
            SurfaceTone::SecondaryContainer => palette.secondary_container,
            SurfaceTone::ErrorContainer => palette.error_container,
            SurfaceTone::SuccessContainer => palette.success_container,
            SurfaceTone::WarningContainer => palette.warning_container,
            SurfaceTone::InverseSurface => palette.inverse_surface,
            SurfaceTone::Scrim => palette.scrim.with_alpha(0.5),
        }
    }

    fn resolve_height(&self, widget: &Widget, measured: f32) -> f32 {
        if widget.fill_viewport_height {
            return self.viewport_height;
        }
        let height = match widget.height {
            Length::Auto => measured,
            Length::Px(value) => value,
            Length::Fraction(fraction) => fraction * measured.max(1.0),
        };
        match widget.min_height {
            Some(min) => height.max(min),
            None => height,
        }
    }

    fn measure(
        &self,
        widget: &Widget,
        available_width: f32,
        available_height: Option<f32>,
    ) -> Size {
        if let Some(visible) = &widget.visible {
            if !visible.resolve(self.viewport_width) {
                return Size::ZERO;
            }
        }
        let available = if available_width.is_finite() {
            available_width.max(0.0)
        } else {
            4096.0
        };
        let size = match &widget.kind {
            WidgetKind::Container(props) => {
                self.measure_container(props, available, self.padding_for(widget, props.padding))
            }
            WidgetKind::Card(props) => {
                self.measure_card(props, available, self.padding_for(widget, props.padding))
            }
            WidgetKind::Grid(props) => {
                self.measure_grid(props, available, self.padding_for(widget, props.padding))
            }
            WidgetKind::Text(text) => measure_text(&text.content, text.style, available),
            WidgetKind::Heading(heading) => measure_text(
                &heading.content,
                self.text_style_for_level(heading.level),
                available,
            ),
            WidgetKind::Button(button) => self.measure_button(button),
            WidgetKind::TextField(field) => self.measure_text_field(field, available),
            WidgetKind::Checkbox(checkbox) => self.measure_checkbox(checkbox, available),
            WidgetKind::Switch(switch) => self.measure_switch(switch, available),
            WidgetKind::Select(select) => self.measure_select(select, available),
            WidgetKind::Progress(progress) => self.measure_progress(progress, available),
            WidgetKind::FormProgress(progress) => self.measure_form_progress(progress, available),
            WidgetKind::Navigation(nav) => self.measure_nav(nav, available, available_height),
            WidgetKind::Table(table) => self.measure_table(table, available),
            WidgetKind::Tag(tag) => self.measure_tag(tag),
            WidgetKind::Icon(_) => Size::new(self.theme.sizes.icon, self.theme.sizes.icon),
            WidgetKind::Link(link) => {
                measure_text(&link.label, self.theme.typography.body_medium, available)
            }
            WidgetKind::IconButton(button) => Size::new(button.size.height(), button.size.height()),
            WidgetKind::Fab(_) => Size::new(56.0, 56.0),
            WidgetKind::Avatar(avatar) => Size::new(avatar.size, avatar.size),
            WidgetKind::Spinner(spinner) => Size::new(spinner.size, spinner.size),
            WidgetKind::Skeleton(skeleton) => Size::new(available, skeleton.height),
            WidgetKind::Radio(radio) => {
                let text = measure_text(
                    &radio.label,
                    self.theme.typography.body_medium,
                    (available - 26.0).max(0.0),
                );
                Size::new(26.0 + text.width, text.height.max(24.0))
            }
            WidgetKind::Slider(slider) => {
                let label = slider.label.is_some();
                Size::new(available, if label { 44.0 } else { 24.0 })
            }
            WidgetKind::Otp(otp) => Size::new(
                otp.length as f32 * 40.0 + (otp.length as f32 - 1.0) * 8.0,
                48.0,
            ),
            WidgetKind::DataTable(table) => {
                let compact = table.state.compact.peek();
                let row_height = if compact {
                    table.compact_row_height
                } else {
                    table.row_height
                };
                let height = table.viewport_height.unwrap_or(
                    self.theme.sizes.table_header_height
                        + table.rows.len().min(8) as f32 * row_height
                        + 48.0
                        + if table.state.selected.peek().is_empty() {
                            0.0
                        } else {
                            40.0
                        },
                );
                Size::new(available, height)
            }
            WidgetKind::Divider(divider) => {
                if divider.vertical {
                    Size::new(1.0, available_height.unwrap_or(1.0))
                } else {
                    Size::new(available, 1.0)
                }
            }
            WidgetKind::Spacer(size) => Size::new(*size, *size),
        };
        let width = self.resolve_width(widget, size.width, available);
        let height = if widget.scrollable.is_some() {
            if widget.fill_viewport_height {
                self.viewport_height
            } else {
                0.0
            }
        } else {
            self.resolve_height(widget, size.height.max(0.0))
        };
        Size::new(width.max(0.0), height.max(0.0))
    }

    fn measure_container(&self, props: &ContainerProps, available: f32, padding: Edges) -> Size {
        let inner_width = (available - padding.horizontal()).max(0.0);
        if props.overlay {
            let mut size = Size::ZERO;
            for child in &props.children {
                let child_size = self.measure(child, inner_width, None);
                size.width = size.width.max(child_size.width);
                size.height = size.height.max(child_size.height);
            }
            return Size::new(
                size.width + padding.horizontal(),
                size.height + padding.vertical(),
            );
        }
        let direction = props
            .direction_override
            .as_ref()
            .map(|value| value.resolve(self.viewport_width))
            .unwrap_or(props.direction);
        match direction {
            Direction::Vertical => {
                let mut width: f32 = 0.0;
                let mut height: f32 = 0.0;
                let mut flow_count = 0usize;
                for child in &props.children {
                    let child_size = self.measure(child, inner_width, None);
                    width = width.max(child_size.width);
                    if child.pin_bottom {
                        continue;
                    }
                    if flow_count > 0 {
                        height += props.gap;
                    }
                    height += child_size.height;
                    flow_count += 1;
                }
                Size::new(width + padding.horizontal(), height + padding.vertical())
            }
            Direction::Horizontal => {
                let sizes = self.measure_row_children(props, inner_width);
                let mut total_width: f32 = 0.0;
                let mut line_height: f32 = 0.0;
                let mut max_line_width: f32 = 0.0;
                let mut height: f32 = 0.0;
                let mut count = 0usize;
                for size in &sizes {
                    if props.wrap && count > 0 && total_width + props.gap + size.width > inner_width
                    {
                        max_line_width = max_line_width.max(total_width);
                        height += line_height + props.gap;
                        total_width = 0.0;
                        line_height = 0.0;
                        count = 0;
                    }
                    if count > 0 {
                        total_width += props.gap;
                    }
                    total_width += size.width;
                    line_height = line_height.max(size.height);
                    count += 1;
                }
                max_line_width = max_line_width.max(total_width);
                height += line_height;
                Size::new(
                    max_line_width.min(inner_width) + padding.horizontal(),
                    height + padding.vertical(),
                )
            }
        }
    }

    fn measure_row_children(&self, props: &ContainerProps, inner_width: f32) -> Vec<Size> {
        let count = props.children.len();
        let mut sizes = vec![Size::ZERO; count];
        if props.wrap {
            for (index, child) in props.children.iter().enumerate() {
                sizes[index] = self.measure(child, inner_width, None);
            }
            return sizes;
        }
        let gaps = props.gap * (count as f32 - 1.0).max(0.0);
        let mut fixed_width = 0.0;
        let mut grow_total = 0.0;
        for (index, child) in props.children.iter().enumerate() {
            if child.grow > 0.0 {
                grow_total += child.grow;
            } else {
                let size = self.measure(child, inner_width, None);
                fixed_width += size.width;
                sizes[index] = size;
            }
        }
        let remaining = (inner_width - fixed_width - gaps).max(0.0);
        for (index, child) in props.children.iter().enumerate() {
            if child.grow > 0.0 {
                let allocation = if grow_total > 0.0 {
                    remaining * child.grow / grow_total
                } else {
                    remaining
                };
                let mut size = self.measure(child, allocation, None);
                size.width = allocation;
                sizes[index] = size;
            }
        }
        sizes
    }

    fn measure_card(&self, props: &CardProps, available: f32, padding: Edges) -> Size {
        let inner = (available - padding.horizontal()).max(0.0);
        let mut width: f32 = 0.0;
        let mut height: f32 = 0.0;
        for (index, child) in props.children.iter().enumerate() {
            let child_size = self.measure(child, inner, None);
            width = width.max(child_size.width);
            height += child_size.height;
            if index + 1 < props.children.len() {
                height += props.gap;
            }
        }
        Size::new(width + padding.horizontal(), height + padding.vertical())
    }

    fn measure_grid(&self, props: &GridProps, available: f32, padding: Edges) -> Size {
        let inner = (available - padding.horizontal()).max(0.0);
        let columns = props.columns.resolve(self.viewport_width).max(1);
        let cell = ((inner - props.column_gap * (columns as f32 - 1.0)) / columns as f32).max(0.0);
        let mut row_heights: Vec<f32> = Vec::new();
        for (index, child) in props.children.iter().enumerate() {
            let row = index / columns;
            let child_size = self.measure(child, cell, None);
            if row_heights.len() <= row {
                row_heights.push(0.0);
            }
            row_heights[row] = row_heights[row].max(child_size.height);
        }
        let rows = props.children.len().div_ceil(columns).max(1);
        let height = row_heights.iter().sum::<f32>() + props.row_gap * (rows as f32 - 1.0);
        Size::new(inner + padding.horizontal(), height + padding.vertical())
    }

    fn measure_button(&self, button: &ButtonWidget) -> Size {
        let icon_space = if button.icon.is_some() {
            self.theme.sizes.icon + 8.0
        } else {
            0.0
        };
        let loading_space = if button.loading { 18.0 } else { 0.0 };
        let label = measure_text(
            &button.label,
            TextStyle::new(
                button.size.font_size(),
                button.size.height(),
                FontWeight::Medium,
            ),
            f32::INFINITY,
        );
        Size::new(
            label.width + icon_space + loading_space + button.size.horizontal_padding() * 2.0,
            button.size.height(),
        )
    }

    fn measure_text_field(&self, field: &TextFieldWidget, available: f32) -> Size {
        let label_height = self.theme.typography.label_large.line_height;
        let helper = field.help.is_some()
            || field
                .errors
                .map(|errors| !errors.peek().is_empty())
                .unwrap_or(false);
        let input_height = if field.multiline {
            120.0
        } else {
            self.theme.scaled(self.theme.sizes.input_height)
        };
        Size::new(
            available.max(220.0),
            label_height + 6.0 + input_height + if helper { 24.0 } else { 0.0 },
        )
    }

    fn measure_checkbox(&self, checkbox: &CheckboxWidget, available: f32) -> Size {
        let text = measure_text(
            &checkbox.label,
            self.theme.typography.body_medium,
            (available - 26.0).max(0.0),
        );
        Size::new(26.0 + text.width, text.height.max(24.0))
    }

    fn measure_switch(&self, switch: &SwitchWidget, available: f32) -> Size {
        let text = measure_text(
            &switch.label,
            self.theme.typography.body_medium,
            (available - 56.0).max(0.0),
        );
        Size::new(56.0 + text.width, text.height.max(24.0))
    }

    fn measure_select(&self, _select: &SelectWidget, available: f32) -> Size {
        let label_height = self.theme.typography.label_large.line_height;
        Size::new(
            available,
            label_height + 6.0 + self.theme.scaled(self.theme.sizes.input_height),
        )
    }

    fn measure_progress(&self, progress: &ProgressWidget, available: f32) -> Size {
        let label = progress.label.is_some();
        Size::new(available, if label { 28.0 } else { 8.0 })
    }

    fn measure_form_progress(&self, _progress: &FormProgressWidget, available: f32) -> Size {
        Size::new(available, 40.0)
    }

    fn measure_nav(&self, nav: &NavWidget, available: f32, available_height: Option<f32>) -> Size {
        if nav.vertical.resolve(self.viewport_width) {
            let width = if nav.expanded {
                self.theme.sizes.nav_rail_width
            } else {
                self.theme.sizes.nav_rail_collapsed
            };
            Size::new(width, available_height.unwrap_or(480.0))
        } else {
            Size::new(available, self.theme.sizes.nav_bar_height)
        }
    }

    fn measure_table(&self, table: &TableWidget, available: f32) -> Size {
        let rows = table.rows.len() as f32;
        let row_height = if table.compact {
            self.theme.sizes.table_row_compact
        } else {
            self.theme.scaled(self.theme.sizes.table_row_height)
        };
        let footer = if table.page.is_some() { 48.0 } else { 0.0 };
        Size::new(
            available,
            self.theme.sizes.table_header_height + rows * row_height + footer,
        )
    }

    fn measure_tag(&self, tag: &TagWidget) -> Size {
        let style = self.theme.typography.label_medium;
        let width = measure_text(&tag.label, style, f32::INFINITY).width;
        Size::new(width + 16.0, self.theme.scaled(24.0))
    }

    fn arrange(&mut self, widget: &Widget, rect: Rect, clip: Rect) -> LayoutNode {
        let id = self.next_id;
        self.next_id += 1;
        if let Some(visible) = &widget.visible {
            if !visible.resolve(self.viewport_width) {
                let hidden = Rect::new(rect.x, rect.y, 0.0, 0.0);
                return LayoutNode {
                    id,
                    rect: hidden,
                    clip: hidden,
                    background: None,
                    border: None,
                    radius: 0.0,
                    shadow: 0.0,
                    paint: PaintData::None,
                    interaction: Interaction::default(),
                    role: Role::Generic,
                    label: None,
                    value: None,
                    selected: false,
                    hovered: false,
                    key: widget.key,
                    scrollable: false,
                    scroll_offset: 0.0,
                    content_height: 0.0,
                    scroll_signal: None,
                    children: Vec::new(),
                };
            }
        }
        let clip = clip.intersect(&rect);
        let mut node = match &widget.kind {
            WidgetKind::Container(props) => self.arrange_container(id, widget, props, rect, clip),
            WidgetKind::Card(props) => self.arrange_card(id, widget, props, rect, clip),
            WidgetKind::Grid(props) => self.arrange_grid(id, widget, props, rect, clip),
            WidgetKind::Text(text) => self.arrange_text(id, widget, text, rect, clip),
            WidgetKind::Heading(heading) => self.arrange_heading(id, widget, heading, rect, clip),
            WidgetKind::Button(button) => self.arrange_button(id, button, rect, clip),
            WidgetKind::TextField(field) => self.arrange_text_field(id, field, rect, clip),
            WidgetKind::Checkbox(checkbox) => self.arrange_checkbox(id, checkbox, rect, clip),
            WidgetKind::Switch(switch) => self.arrange_switch(id, switch, rect, clip),
            WidgetKind::Select(select) => self.arrange_select(id, select, rect, clip),
            WidgetKind::Progress(progress) => self.arrange_progress(id, progress, rect, clip),
            WidgetKind::FormProgress(progress) => {
                self.arrange_form_progress(id, progress, rect, clip)
            }
            WidgetKind::Navigation(nav) => self.arrange_nav(id, nav, rect, clip),
            WidgetKind::Table(table) => self.arrange_table(id, table, rect, clip),
            WidgetKind::Tag(tag) => self.arrange_tag(id, widget, tag, rect, clip),
            WidgetKind::Icon(icon) => self.arrange_icon(id, widget, icon, rect, clip),
            WidgetKind::Link(link) => self.arrange_link(id, widget, link, rect, clip),
            WidgetKind::IconButton(button) => {
                self.arrange_icon_button(id, widget, button, rect, clip)
            }
            WidgetKind::Fab(fab) => self.arrange_fab(id, widget, fab, rect, clip),
            WidgetKind::Avatar(avatar) => self.arrange_avatar(id, widget, avatar, rect, clip),
            WidgetKind::Spinner(spinner) => self.arrange_spinner(id, widget, spinner, rect, clip),
            WidgetKind::Skeleton(skeleton) => {
                self.arrange_skeleton(id, widget, skeleton, rect, clip)
            }
            WidgetKind::Radio(radio) => self.arrange_radio(id, widget, radio, rect, clip),
            WidgetKind::Slider(slider) => self.arrange_slider(id, widget, slider, rect, clip),
            WidgetKind::Otp(otp) => self.arrange_otp(id, widget, otp, rect, clip),
            WidgetKind::DataTable(table) => self.arrange_data_table(id, widget, table, rect, clip),
            WidgetKind::Divider(divider) => self.arrange_divider(id, divider, rect, clip),
            WidgetKind::Spacer(_) => {
                self.base_node(id, rect, clip, PaintData::None, Role::Generic, widget)
            }
        };
        if widget.translate.x != 0.0 || widget.translate.y != 0.0 {
            node.translate(widget.translate.x, widget.translate.y);
        }
        if let Some(signal) = widget.scrollable {
            let offset = signal.get().max(0.0);
            let content_height = node
                .children
                .iter()
                .map(|child| child.rect.bottom())
                .fold(node.rect.y, f32::max)
                - node.rect.y;
            let max_offset = (content_height - node.rect.height).max(0.0);
            let offset = offset.min(max_offset);
            for child in &mut node.children {
                child.translate(0.0, -offset);
                child.set_clip(node.rect);
            }
            node.scrollable = true;
            node.scroll_offset = offset;
            node.content_height = content_height.max(node.rect.height);
            node.scroll_signal = Some(signal);
        }
        node
    }

    fn base_node(
        &self,
        id: NodeId,
        rect: Rect,
        clip: Rect,
        paint: PaintData,
        role: Role,
        widget: &Widget,
    ) -> LayoutNode {
        LayoutNode {
            id,
            rect,
            clip,
            background: widget
                .background
                .or_else(|| widget.surface_tone.map(|tone| self.surface_color(tone))),
            border: widget.border,
            radius: widget.radius.unwrap_or(0.0),
            shadow: 0.0,
            paint,
            interaction: Interaction {
                click: widget.click.clone(),
                ..Interaction::default()
            },
            role,
            label: None,
            value: None,
            selected: false,
            hovered: false,
            key: widget.key,
            scrollable: false,
            scroll_offset: 0.0,
            content_height: 0.0,
            scroll_signal: None,
            children: Vec::new(),
        }
    }

    fn arrange_container(
        &mut self,
        id: NodeId,
        widget: &Widget,
        props: &ContainerProps,
        rect: Rect,
        clip: Rect,
    ) -> LayoutNode {
        let mut node = self.base_node(id, rect, clip, PaintData::None, Role::Group, widget);
        let padding = self.padding_for(widget, props.padding);
        let inner = rect.inset(padding);
        if props.overlay {
            for child in &props.children {
                let size = self.measure(child, inner.width, Some(inner.height));
                let child_rect = Rect::new(inner.x, inner.y, inner.width, size.height);
                let child_node = self.arrange(child, child_rect, inner);
                node.children.push(child_node);
            }
            return node;
        }
        let direction = props
            .direction_override
            .as_ref()
            .map(|value| value.resolve(self.viewport_width))
            .unwrap_or(props.direction);
        let sizes: Vec<Size> = match direction {
            Direction::Vertical => props
                .children
                .iter()
                .map(|child| self.measure(child, inner.width, None))
                .collect(),
            Direction::Horizontal => self.measure_row_children(props, inner.width),
        };
        match direction {
            Direction::Vertical => {
                let flow_count = props
                    .children
                    .iter()
                    .filter(|child| !child.pin_bottom)
                    .count();
                let total_height: f32 = props
                    .children
                    .iter()
                    .enumerate()
                    .filter(|(_, child)| !child.pin_bottom)
                    .map(|(index, _)| sizes[index].height)
                    .sum::<f32>()
                    + props.gap * (flow_count as f32 - 1.0).max(0.0);
                let free = (inner.height - total_height).max(0.0);
                let grow_total: f32 = props
                    .children
                    .iter()
                    .filter(|child| !child.pin_bottom)
                    .map(|child| child.grow)
                    .sum();
                let start_offset = if grow_total == 0.0 {
                    match props.justify {
                        Justify::Center => free / 2.0,
                        Justify::End => free,
                        _ => 0.0,
                    }
                } else {
                    0.0
                };
                let mut cursor_y = inner.y + start_offset;
                let mut placed = 0usize;
                for (index, child) in props.children.iter().enumerate() {
                    if child.pin_bottom {
                        continue;
                    }
                    let extra = if grow_total > 0.0 && child.grow > 0.0 {
                        free * child.grow / grow_total
                    } else {
                        0.0
                    };
                    let height = sizes[index].height + extra;
                    let (x, width) = match props.align {
                        Align::Stretch => (inner.x, inner.width),
                        Align::Center => (
                            inner.x + (inner.width - sizes[index].width) / 2.0,
                            sizes[index].width,
                        ),
                        Align::End => (
                            inner.x + inner.width - sizes[index].width,
                            sizes[index].width,
                        ),
                        Align::Start => (inner.x, sizes[index].width),
                    };
                    let child_rect = Rect::new(x, cursor_y, width, height);
                    node.children.push(self.arrange(child, child_rect, inner));
                    cursor_y += height;
                    placed += 1;
                    if placed < flow_count {
                        cursor_y += props.gap;
                    }
                }
                for (index, child) in props.children.iter().enumerate() {
                    if !child.pin_bottom {
                        continue;
                    }
                    let height = sizes[index].height;
                    let y = inner.bottom() - height;
                    let width = match props.align {
                        Align::Stretch => inner.width,
                        _ => sizes[index].width,
                    };
                    let x = match props.align {
                        Align::Center => inner.x + (inner.width - width) / 2.0,
                        Align::End => inner.x + inner.width - width,
                        _ => inner.x,
                    };
                    let child_rect = Rect::new(x, y, width, height);
                    node.children.push(self.arrange(child, child_rect, inner));
                }
            }
            Direction::Horizontal => {
                let mut lines: Vec<Vec<(usize, Size)>> = vec![Vec::new()];
                let mut line_width = 0.0;
                for (index, size) in sizes.iter().enumerate() {
                    let needs_new = props.wrap
                        && !lines.last().map(|line| line.is_empty()).unwrap_or(true)
                        && line_width + props.gap + size.width > inner.width;
                    if needs_new {
                        lines.push(Vec::new());
                        line_width = 0.0;
                    }
                    if !lines.last().map(|line| line.is_empty()).unwrap_or(true) {
                        line_width += props.gap;
                    }
                    line_width += size.width;
                    lines
                        .last_mut()
                        .expect("at least one line")
                        .push((index, *size));
                }
                let line_heights: Vec<f32> = lines
                    .iter()
                    .map(|line| {
                        line.iter()
                            .map(|(_, size)| size.height)
                            .fold(0.0_f32, f32::max)
                    })
                    .collect();
                let total_height: f32 = line_heights.iter().sum::<f32>()
                    + props.gap * (lines.len() as f32 - 1.0).max(0.0);
                let free = (inner.height - total_height).max(0.0);
                let gravity = match props.justify {
                    Justify::Center => free / 2.0,
                    Justify::End => free,
                    _ => 0.0,
                };
                let mut cursor_y = inner.y + gravity;
                for (line_index, line) in lines.iter().enumerate() {
                    let line_width: f32 = line.iter().map(|(_, size)| size.width).sum::<f32>()
                        + props.gap * (line.len() as f32 - 1.0).max(0.0);
                    let mut cursor_x = match props.justify {
                        Justify::SpaceBetween if line.len() > 1 => inner.x,
                        Justify::Center => inner.x + (inner.width - line_width) / 2.0,
                        Justify::End => inner.x + inner.width - line_width,
                        _ => inner.x,
                    };
                    let space = if props.justify == Justify::SpaceBetween && line.len() > 1 {
                        (inner.width - line_width) / (line.len() as f32 - 1.0) + props.gap
                    } else {
                        props.gap
                    };
                    for (position, (index, size)) in line.iter().enumerate() {
                        let child = &props.children[*index];
                        let height = if props.align == Align::Stretch {
                            if props.wrap {
                                line_heights[line_index]
                            } else {
                                inner.height
                            }
                        } else {
                            size.height
                        };
                        let y = match props.align {
                            Align::Center => {
                                cursor_y + (line_heights[line_index] - size.height) / 2.0
                            }
                            Align::End => cursor_y + line_heights[line_index] - size.height,
                            _ => cursor_y,
                        };
                        let child_rect = Rect::new(cursor_x, y, size.width, height);
                        node.children.push(self.arrange(child, child_rect, inner));
                        cursor_x += size.width;
                        if position + 1 < line.len() {
                            cursor_x += space;
                        }
                    }
                    cursor_y += line_heights[line_index] + props.gap;
                }
            }
        }
        node
    }

    fn arrange_card(
        &mut self,
        id: NodeId,
        widget: &Widget,
        props: &CardProps,
        rect: Rect,
        clip: Rect,
    ) -> LayoutNode {
        let mut node = self.base_node(id, rect, clip, PaintData::None, Role::Card, widget);
        node.background = widget
            .background
            .or_else(|| widget.surface_tone.map(|tone| self.surface_color(tone)))
            .or(Some(self.theme.card_surface()));
        node.radius = widget.radius.unwrap_or(self.theme.radius.card);
        node.border = widget
            .border
            .or(Some(Border::new(1.0, self.theme.palette.outline_variant)));
        node.shadow = props.elevation;
        let padding = self.padding_for(widget, props.padding);
        let inner = rect.inset(padding);
        let sizes: Vec<Size> = props
            .children
            .iter()
            .map(|child| self.measure(child, inner.width, None))
            .collect();
        let mut cursor_y = inner.y;
        for (index, child) in props.children.iter().enumerate() {
            let rect = Rect::new(inner.x, cursor_y, inner.width, sizes[index].height);
            node.children.push(self.arrange(child, rect, inner));
            cursor_y += sizes[index].height;
            if index + 1 < props.children.len() {
                cursor_y += props.gap;
            }
        }
        node
    }

    fn arrange_grid(
        &mut self,
        id: NodeId,
        widget: &Widget,
        props: &GridProps,
        rect: Rect,
        clip: Rect,
    ) -> LayoutNode {
        let mut node = self.base_node(id, rect, clip, PaintData::None, Role::Group, widget);
        let padding = self.padding_for(widget, props.padding);
        let inner = rect.inset(padding);
        let columns = props.columns.resolve(self.viewport_width).max(1);
        let cell =
            ((inner.width - props.column_gap * (columns as f32 - 1.0)) / columns as f32).max(0.0);
        let mut row_heights: Vec<f32> = Vec::new();
        for (index, child) in props.children.iter().enumerate() {
            let row = index / columns;
            let size = self.measure(child, cell, None);
            if row_heights.len() <= row {
                row_heights.push(0.0);
            }
            row_heights[row] = row_heights[row].max(size.height);
        }
        let mut y = inner.y;
        for (index, child) in props.children.iter().enumerate() {
            let row = index / columns;
            let column = index % columns;
            if column == 0 && index > 0 {
                y += row_heights[row - 1] + props.row_gap;
            }
            let x = inner.x + column as f32 * (cell + props.column_gap);
            let rect = Rect::new(x, y, cell, row_heights[row]);
            node.children.push(self.arrange(child, rect, inner));
        }
        node
    }

    fn arrange_text(
        &mut self,
        id: NodeId,
        widget: &Widget,
        text: &TextWidget,
        rect: Rect,
        clip: Rect,
    ) -> LayoutNode {
        let color = text
            .color
            .or_else(|| text.tone.map(|tone| self.tone_color(tone)))
            .unwrap_or(self.theme.palette.text_primary);
        let mut node = self.base_node(
            id,
            rect,
            clip,
            PaintData::Text {
                text: text.content.clone(),
                style: text.style,
                color,
                align: text.align,
            },
            Role::Text,
            widget,
        );
        node.label = Some(text.content.clone());
        node
    }

    fn arrange_heading(
        &mut self,
        id: NodeId,
        widget: &Widget,
        heading: &HeadingWidget,
        rect: Rect,
        clip: Rect,
    ) -> LayoutNode {
        let style = self.text_style_for_level(heading.level);
        let color = heading
            .color
            .or_else(|| heading.tone.map(|tone| self.tone_color(tone)))
            .unwrap_or(self.theme.palette.text_primary);
        let mut node = self.base_node(
            id,
            rect,
            clip,
            PaintData::Text {
                text: heading.content.clone(),
                style,
                color,
                align: Align::Start,
            },
            Role::Heading,
            widget,
        );
        node.label = Some(heading.content.clone());
        node
    }

    fn arrange_button(
        &mut self,
        id: NodeId,
        button: &ButtonWidget,
        rect: Rect,
        clip: Rect,
    ) -> LayoutNode {
        let radius = self.theme.radius.md;
        let background = match button.variant {
            ButtonVariant::Primary | ButtonVariant::Filled => {
                if button.enabled {
                    self.theme.palette.primary
                } else {
                    self.theme.palette.disabled
                }
            }
            ButtonVariant::Tonal => {
                if button.enabled {
                    self.theme.palette.secondary_container
                } else {
                    self.theme.palette.disabled
                }
            }
            ButtonVariant::Secondary | ButtonVariant::Outlined => {
                self.theme.palette.surface_container_lowest
            }
            ButtonVariant::Ghost | ButtonVariant::Text => Color::TRANSPARENT,
            ButtonVariant::Danger => self.theme.palette.error,
        };
        let mut node = self.base_node(
            id,
            rect,
            clip,
            PaintData::Button {
                label: button.label.clone(),
                variant: button.variant,
                size: button.size,
                icon: button.icon,
                loading: button.loading,
                enabled: button.enabled,
                hovered: self.hover == Some(id),
                pressed: self.pressed == Some(id),
            },
            Role::Button,
            &Widget::text(""),
        );
        node.background = Some(background);
        node.radius = radius;
        if matches!(
            button.variant,
            ButtonVariant::Secondary | ButtonVariant::Outlined
        ) {
            node.border = Some(Border::new(1.0, self.theme.palette.outline_variant));
        }
        node.interaction.enabled = button.enabled && !button.loading;
        node.interaction.focusable = button.enabled && !button.loading;
        node.interaction.click = button.on_click.clone();
        node.label = Some(button.label.clone());
        node
    }

    fn arrange_text_field(
        &mut self,
        id: NodeId,
        field: &TextFieldWidget,
        rect: Rect,
        clip: Rect,
    ) -> LayoutNode {
        let value = field.value.get();
        let errors = field.errors.map(|errors| errors.get()).unwrap_or_default();
        let touched = field.touched.map(|touched| touched.get()).unwrap_or(false);
        let focused = self.focus == Some(id);
        let invalid = touched && !errors.is_empty();
        let caret = if focused {
            self.carets.get(&id).copied()
        } else {
            None
        };
        let selection = if focused {
            self.selections.get(&id).copied()
        } else {
            None
        };
        let mut node = self.base_node(
            id,
            rect,
            clip,
            PaintData::TextField {
                value,
                label: field.label.clone(),
                placeholder: field.placeholder.clone(),
                password: field.password,
                invalid,
                focused,
                hovered: self.hover == Some(id),
                enabled: field.enabled,
                leading_icon: field.leading_icon,
                caret,
                selection,
                help: errors.first().cloned().or_else(|| field.help.clone()),
            },
            Role::TextField,
            &Widget::text(""),
        );
        node.value = Some(field.value.peek());
        node.interaction.enabled = field.enabled;
        node.interaction.focusable = field.enabled;
        node.interaction.edit = Some(EditBinding {
            value: field.value,
            on_submit: field.on_submit.clone(),
            touched: field.touched,
            multiline: field.multiline,
        });
        node.label = Some(field.label.clone());
        node
    }

    fn arrange_checkbox(
        &mut self,
        id: NodeId,
        checkbox: &CheckboxWidget,
        rect: Rect,
        clip: Rect,
    ) -> LayoutNode {
        let checked = checkbox.checked.get();
        let mut node = self.base_node(
            id,
            rect,
            clip,
            PaintData::Checkbox {
                label: checkbox.label.clone(),
                checked,
                focused: self.focus == Some(id),
                hovered: self.hover == Some(id),
            },
            Role::Checkbox,
            &Widget::text(""),
        );
        node.interaction.enabled = checkbox.enabled;
        node.interaction.focusable = checkbox.enabled;
        let signal = checkbox.checked;
        node.interaction.click = Some(Rc::new(move || signal.update(|value| *value = !*value)));
        node.label = Some(checkbox.label.clone());
        node.selected = checked;
        node
    }

    fn arrange_switch(
        &mut self,
        id: NodeId,
        switch: &SwitchWidget,
        rect: Rect,
        clip: Rect,
    ) -> LayoutNode {
        let checked = switch.checked.get();
        let mut node = self.base_node(
            id,
            rect,
            clip,
            PaintData::Switch {
                label: switch.label.clone(),
                checked,
                focused: self.focus == Some(id),
                hovered: self.hover == Some(id),
            },
            Role::Switch,
            &Widget::text(""),
        );
        node.interaction.enabled = switch.enabled;
        node.interaction.focusable = switch.enabled;
        let signal = switch.checked;
        node.interaction.click = Some(Rc::new(move || signal.update(|value| *value = !*value)));
        node.label = Some(switch.label.clone());
        node.selected = checked;
        node
    }

    fn arrange_select(
        &mut self,
        id: NodeId,
        select: &SelectWidget,
        rect: Rect,
        clip: Rect,
    ) -> LayoutNode {
        let selected = select.selected.get();
        let value = select
            .options
            .get(selected)
            .cloned()
            .unwrap_or_else(|| "—".to_string());
        let mut node = self.base_node(
            id,
            rect,
            clip,
            PaintData::Select {
                label: select.label.clone(),
                value,
                focused: self.focus == Some(id),
            },
            Role::Select,
            &Widget::text(""),
        );
        node.interaction.enabled = select.enabled;
        node.interaction.focusable = select.enabled;
        let signal = select.selected;
        let count = select.options.len().max(1);
        node.interaction.click = Some(Rc::new(move || {
            signal.update(|value| *value = (*value + 1) % count);
        }));
        node.label = Some(select.label.clone());
        node.value = Some(select.options.get(selected).cloned().unwrap_or_default());
        node
    }

    fn arrange_progress(
        &mut self,
        id: NodeId,
        progress: &ProgressWidget,
        rect: Rect,
        clip: Rect,
    ) -> LayoutNode {
        let mut node = self.base_node(
            id,
            rect,
            clip,
            PaintData::Progress {
                value: progress.value,
                label: progress.label.clone(),
            },
            Role::Progress,
            &Widget::text(""),
        );
        node.value = Some(format!("{:.0}%", progress.value * 100.0));
        node
    }

    fn arrange_form_progress(
        &mut self,
        id: NodeId,
        progress: &FormProgressWidget,
        rect: Rect,
        clip: Rect,
    ) -> LayoutNode {
        let mut node = self.base_node(
            id,
            rect,
            clip,
            PaintData::FormProgress {
                value: progress.value,
                label: progress.label.clone(),
            },
            Role::Progress,
            &Widget::text(""),
        );
        node.value = Some(format!("{:.0}%", progress.value * 100.0));
        node
    }

    fn arrange_nav(&mut self, id: NodeId, nav: &NavWidget, rect: Rect, clip: Rect) -> LayoutNode {
        let selected = nav.selected.get();
        let vertical = nav.vertical.resolve(self.viewport_width);
        let expanded = nav.expanded && vertical;
        let mut node = self.base_node(
            id,
            rect,
            clip,
            PaintData::None,
            Role::Navigation,
            &Widget::text(""),
        );
        let count = nav.items.len().max(1) as f32;
        let item_height = if expanded {
            44.0
        } else if vertical {
            64.0
        } else {
            rect.height
        };
        for (index, item) in nav.items.iter().enumerate() {
            let child_rect = if vertical {
                Rect::new(
                    rect.x,
                    rect.y + (item_height + 4.0) * index as f32,
                    rect.width,
                    item_height,
                )
            } else {
                let width = rect.width / count;
                Rect::new(rect.x + width * index as f32, rect.y, width, rect.height)
            };
            let child_id = self.next_id;
            self.next_id += 1;
            let mut child = LayoutNode {
                id: child_id,
                rect: child_rect,
                clip: clip.intersect(&child_rect),
                background: if index == selected {
                    Some(self.theme.nav_selected_surface())
                } else {
                    None
                },
                border: None,
                radius: self.theme.radius.md,
                shadow: 0.0,
                paint: PaintData::NavItem {
                    icon: item.icon,
                    label: item.label.clone(),
                    selected: index == selected,
                    vertical,
                    expanded,
                    hovered: self.hover == Some(child_id),
                },
                interaction: Interaction::default(),
                role: Role::Generic,
                label: Some(item.label.clone()),
                value: None,
                selected: index == selected,
                hovered: false,
                key: None,
                scrollable: false,
                scroll_offset: 0.0,
                content_height: 0.0,
                scroll_signal: None,
                children: Vec::new(),
            };
            if let Some(handler) = nav.on_select.clone() {
                child.interaction.click = Some(Rc::new(move || handler(index)));
            }
            child.interaction.focusable = nav.on_select.is_some();
            node.children.push(child);
        }
        node
    }

    fn arrange_table(
        &mut self,
        id: NodeId,
        table: &TableWidget,
        rect: Rect,
        clip: Rect,
    ) -> LayoutNode {
        let weights = table
            .column_weights
            .clone()
            .unwrap_or_else(|| vec![1.0; table.headers.len().max(1)]);
        self.base_node(
            id,
            rect,
            clip,
            PaintData::Table {
                headers: table.headers.clone(),
                rows: table.rows.clone(),
                weights,
                striped: table.striped,
                tag_column: table.tag_column,
                tag_variant: table.tag_variant,
                compact: table.compact,
                selected_row: table.selected_row,
                sort_column: table.sort_column,
                sort_ascending: table.sort_ascending,
                page: table.page.map(|page| page.get()),
                pages: table.pages,
            },
            Role::Table,
            &Widget::text(""),
        )
    }

    fn arrange_icon(
        &mut self,
        id: NodeId,
        widget: &Widget,
        icon: &crate::widget::IconWidget,
        rect: Rect,
        clip: Rect,
    ) -> LayoutNode {
        self.base_node(
            id,
            rect,
            clip,
            PaintData::Icon {
                icon: icon.icon,
                color: self.tone_color(icon.tone),
            },
            Role::Generic,
            widget,
        )
    }

    fn arrange_tag(
        &mut self,
        id: NodeId,
        widget: &Widget,
        tag: &TagWidget,
        rect: Rect,
        clip: Rect,
    ) -> LayoutNode {
        let mut node = self.base_node(
            id,
            rect,
            clip,
            PaintData::Tag {
                label: tag.label.clone(),
                variant: tag.variant,
            },
            Role::Text,
            widget,
        );
        node.label = Some(tag.label.clone());
        node
    }

    fn arrange_link(
        &mut self,
        id: NodeId,
        widget: &Widget,
        link: &crate::widget::LinkWidget,
        rect: Rect,
        clip: Rect,
    ) -> LayoutNode {
        let mut node = self.base_node(
            id,
            rect,
            clip,
            PaintData::Link {
                label: link.label.clone(),
                color: self.theme.palette.primary,
                hovered: self.hover == Some(id),
            },
            Role::Link,
            widget,
        );
        node.interaction.focusable = link.on_click.is_some();
        node.interaction.click = link.on_click.clone();
        node.label = Some(link.label.clone());
        node
    }

    fn arrange_icon_button(
        &mut self,
        id: NodeId,
        widget: &Widget,
        button: &crate::widget::IconButtonWidget,
        rect: Rect,
        clip: Rect,
    ) -> LayoutNode {
        let background = match button.variant {
            ButtonVariant::Primary | ButtonVariant::Filled => self.theme.palette.primary,
            ButtonVariant::Tonal => self.theme.palette.secondary_container,
            ButtonVariant::Danger => self.theme.palette.error,
            _ => Color::TRANSPARENT,
        };
        let mut node = self.base_node(
            id,
            rect,
            clip,
            PaintData::IconButton {
                icon: button.icon,
                label: button.label.clone(),
                variant: button.variant,
                size: button.size,
                enabled: button.enabled,
                hovered: self.hover == Some(id),
                pressed: self.pressed == Some(id),
            },
            Role::Button,
            widget,
        );
        node.background = Some(background);
        node.radius = self.theme.radius.md;
        if matches!(
            button.variant,
            ButtonVariant::Secondary | ButtonVariant::Outlined
        ) {
            node.border = Some(Border::new(1.0, self.theme.palette.outline_variant));
        }
        node.interaction.enabled = button.enabled;
        node.interaction.focusable = button.enabled;
        node.interaction.click = button.on_click.clone();
        node.label = Some(button.label.clone());
        node
    }

    fn arrange_fab(
        &mut self,
        id: NodeId,
        widget: &Widget,
        fab: &crate::widget::FabWidget,
        rect: Rect,
        clip: Rect,
    ) -> LayoutNode {
        let mut node = self.base_node(
            id,
            rect,
            clip,
            PaintData::Fab { icon: fab.icon },
            Role::Button,
            widget,
        );
        node.background = Some(self.theme.palette.primary);
        node.radius = rect.width / 2.0;
        node.shadow = 2.0;
        node.interaction.focusable = fab.on_click.is_some();
        node.interaction.click = fab.on_click.clone();
        node.label = Some(fab.label.clone());
        node
    }

    fn arrange_avatar(
        &mut self,
        id: NodeId,
        widget: &Widget,
        avatar: &crate::widget::AvatarWidget,
        rect: Rect,
        clip: Rect,
    ) -> LayoutNode {
        let background = self.surface_color(avatar.tone);
        let mut node = self.base_node(
            id,
            rect,
            clip,
            PaintData::Avatar {
                initials: avatar.initials.clone(),
                background,
                foreground: self.theme.palette.on_surface,
            },
            Role::Text,
            widget,
        );
        node.background = Some(background);
        node.radius = rect.width / 2.0;
        node.label = Some(avatar.initials.clone());
        node
    }

    fn arrange_spinner(
        &mut self,
        id: NodeId,
        widget: &Widget,
        _spinner: &crate::widget::SpinnerWidget,
        rect: Rect,
        clip: Rect,
    ) -> LayoutNode {
        self.base_node(id, rect, clip, PaintData::Spinner, Role::Progress, widget)
    }

    fn arrange_skeleton(
        &mut self,
        id: NodeId,
        widget: &Widget,
        skeleton: &crate::widget::SkeletonWidget,
        rect: Rect,
        clip: Rect,
    ) -> LayoutNode {
        let mut node = self.base_node(
            id,
            rect,
            clip,
            PaintData::Skeleton {
                radius: skeleton.radius,
            },
            Role::Generic,
            widget,
        );
        node.background = Some(self.theme.palette.surface_container_high);
        node.radius = skeleton.radius;
        node
    }

    fn arrange_radio(
        &mut self,
        id: NodeId,
        widget: &Widget,
        radio: &crate::widget::RadioWidget,
        rect: Rect,
        clip: Rect,
    ) -> LayoutNode {
        let checked = radio.group.get() == radio.value;
        let mut node = self.base_node(
            id,
            rect,
            clip,
            PaintData::Radio {
                label: radio.label.clone(),
                checked,
                focused: self.focus == Some(id),
                hovered: self.hover == Some(id),
            },
            Role::Radio,
            widget,
        );
        node.interaction.enabled = radio.enabled;
        node.interaction.focusable = radio.enabled;
        let group = radio.group;
        let value = radio.value;
        node.interaction.click = Some(Rc::new(move || group.set(value)));
        node.label = Some(radio.label.clone());
        node.selected = checked;
        node
    }

    fn arrange_slider(
        &mut self,
        id: NodeId,
        widget: &Widget,
        slider: &crate::widget::SliderWidget,
        rect: Rect,
        clip: Rect,
    ) -> LayoutNode {
        let mut node = self.base_node(
            id,
            rect,
            clip,
            PaintData::Slider {
                value: slider.value.get().clamp(0.0, 1.0),
                label: slider.label.clone(),
            },
            Role::Slider,
            widget,
        );
        node.interaction.focusable = true;
        node.interaction.slider = Some(slider.value);
        node.value = Some(format!("{:.0}%", slider.value.peek() * 100.0));
        node
    }

    fn arrange_otp(
        &mut self,
        id: NodeId,
        widget: &Widget,
        otp: &crate::widget::OtpWidget,
        rect: Rect,
        clip: Rect,
    ) -> LayoutNode {
        let focused = self.focus == Some(id);
        let mut node = self.base_node(
            id,
            rect,
            clip,
            PaintData::Otp {
                value: otp.value.get(),
                length: otp.length,
                focused,
            },
            Role::Otp,
            widget,
        );
        node.interaction.focusable = true;
        node.interaction.edit = Some(EditBinding {
            value: otp.value,
            on_submit: None,
            touched: None,
            multiline: false,
        });
        node.value = Some(otp.value.peek());
        node
    }

    fn arrange_data_table(
        &mut self,
        id: NodeId,
        widget: &Widget,
        table: &DataTableWidget,
        rect: Rect,
        clip: Rect,
    ) -> LayoutNode {
        let compact = table.state.compact.get();
        let row_height = if compact {
            table.compact_row_height
        } else {
            table.row_height
        };
        let width_signal = table.state.widths.get();
        let order = normalized_order(&table.state.order.get(), table.columns.len());
        let widths: Vec<f32> = order
            .iter()
            .map(|index| {
                width_signal
                    .get(*index)
                    .copied()
                    .unwrap_or_else(|| table.columns[*index].width)
            })
            .collect();
        let selected = table.state.selected.get();
        let sort = table.state.sort.get();
        let sort_ascending = table.state.sort_ascending.get();
        let page = table.state.page.get();
        let scroll = table.state.scroll.get();
        let columns: Vec<DataColumn> = order
            .iter()
            .map(|index| table.columns[*index].clone())
            .collect();
        let header_height = self.theme.sizes.table_header_height;
        let footer_height = 48.0 + if selected.is_empty() { 0.0 } else { 40.0 };
        let body_height = (rect.height - header_height - footer_height).max(0.0);
        let visible_rows = (body_height / row_height).ceil() as usize + 2;
        let start_row = (scroll / row_height).floor().max(0.0) as usize;
        let start_row = start_row.min(table.rows.len());
        let end_row = (start_row + visible_rows).min(table.rows.len());
        let rows: Vec<(usize, Vec<String>)> = table.rows[start_row..end_row]
            .iter()
            .cloned()
            .enumerate()
            .map(|(offset, row)| (start_row + offset, row))
            .collect();
        let hover_column = self
            .table_hover
            .and_then(|(node, column)| (node == id).then_some(column));
        let drag = self
            .table_drag
            .clone()
            .and_then(|(node, drag)| (node == id).then_some(drag));
        let mut node = self.base_node(
            id,
            rect,
            clip,
            PaintData::DataTable {
                columns,
                rows,
                widths,
                compact,
                selected,
                sort,
                sort_ascending,
                page,
                pages: table.state.pages,
                scroll,
                total_rows: table.rows.len(),
                display_total: table.display_total,
                display_range: table.display_range,
                hover_column,
                hover_row: self
                    .table_hover_row
                    .and_then(|(node, row)| (node == id).then_some(row)),
                drag,
            },
            Role::Table,
            widget,
        );
        node.interaction.focusable = true;
        node.interaction.data_table = Some(table.state.clone());
        node.interaction.data_table_defaults =
            Some(table.columns.iter().map(|column| column.width).collect());
        node.value = Some(format!("{} rows", table.rows.len()));
        node.background = Some(self.theme.palette.surface_container_lowest);
        node.radius = 0.0;
        node
    }

    fn arrange_divider(
        &mut self,
        id: NodeId,
        divider: &DividerWidget,
        rect: Rect,
        clip: Rect,
    ) -> LayoutNode {
        self.base_node(
            id,
            rect,
            clip,
            PaintData::Divider {
                vertical: divider.vertical,
            },
            Role::Divider,
            &Widget::text(""),
        )
    }
}

pub fn pagination_slots(page: usize, pages: usize) -> Vec<usize> {
    const GAP: usize = usize::MAX;
    let pages = pages.max(1);
    let current = page.min(pages - 1);
    if pages <= 7 {
        return (0..pages).collect();
    }
    let mut slots = vec![0];
    let start = current.saturating_sub(1).max(1);
    let end = (current + 1).min(pages - 2);
    if start > 1 {
        slots.push(GAP);
    }
    for index in start..=end {
        if index != 0 && index != pages - 1 {
            slots.push(index);
        }
    }
    if end + 1 < pages - 1 {
        slots.push(GAP);
    }
    slots.push(pages - 1);
    slots
}

fn normalized_order(order: &[usize], len: usize) -> Vec<usize> {
    let mut result: Vec<usize> = order.iter().copied().filter(|index| *index < len).collect();
    for index in 0..len {
        if !result.contains(&index) {
            result.push(index);
        }
    }
    result
}

pub fn measure_text(text: &str, style: TextStyle, max_width: f32) -> Size {
    let max_width = if max_width.is_finite() {
        max_width.max(1.0)
    } else {
        f32::INFINITY
    };
    let mut lines = 0usize;
    let mut widest: f32 = 0.0;
    for raw_line in text.split('\n') {
        let mut current = String::new();
        let mut current_width = 0.0;
        let mut line_count = 1usize;
        for word in raw_line.split(' ') {
            let word_width = word_width(word, style.size);
            let space_width = char_width(' ', style.size);
            let candidate = if current.is_empty() {
                word_width
            } else {
                current_width + space_width + word_width
            };
            if candidate > max_width && !current.is_empty() {
                widest = widest.max(current_width);
                line_count += 1;
                current.clear();
                current.push_str(word);
                current_width = word_width;
            } else {
                if !current.is_empty() {
                    current.push(' ');
                    current_width += space_width;
                }
                current.push_str(word);
                current_width += word_width;
            }
        }
        widest = widest.max(current_width);
        lines += line_count;
    }
    let lines = lines.max(1);
    Size::new(widest.min(max_width), lines as f32 * style.line_height)
}

fn word_width(word: &str, size: f32) -> f32 {
    word.chars().map(|c| char_width(c, size)).sum()
}

fn char_width(c: char, size: f32) -> f32 {
    match c {
        ' ' => size * 0.34,
        'i' | 'l' | 'j' | 't' | 'f' | 'r' | 'I' | '.' | ',' | ':' | ';' | '!' | '\'' => size * 0.36,
        'm' | 'w' | 'M' | 'W' | 'Ш' | 'Щ' | 'Ж' | 'М' | 'Ф' => size * 0.98,
        c if c.is_uppercase() => size * 0.74,
        c if c.is_ascii() => size * 0.62,
        _ => size * 0.68,
    }
}

pub fn constraints_for(viewport: Size, theme: &Theme) -> Constraints {
    Constraints {
        max_width: Some(viewport.width),
        max_height: Some(viewport.height),
        min_width: theme.sizes.control_height,
        min_height: 0.0,
    }
}

pub fn layout_context<'a>(theme: &'a Theme, viewport: Size) -> LayoutContext<'a> {
    LayoutContext {
        theme,
        viewport_width: viewport.width,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::responsive::Breakpoint;
    use crate::responsive::Responsive;
    use crate::widget::NavItem;

    fn theme() -> Theme {
        Theme::light()
    }

    fn column(children: Vec<Widget>) -> Widget {
        Widget::column(children)
    }

    #[test]
    fn column_stacks_children_with_gap() {
        let widget = column(vec![
            Widget::text("one").height_px(20.0),
            Widget::text("two").height_px(30.0),
        ])
        .gap(10.0)
        .padding_all(16.0);
        let tree = layout(
            &widget,
            Size::new(300.0, 400.0),
            &theme(),
            &LayoutOptions::empty(),
        );
        assert_eq!(tree.root.children.len(), 2);
        assert_eq!(tree.root.children[0].rect.y, 16.0);
        assert_eq!(tree.root.children[1].rect.y, 46.0);
        assert_eq!(tree.root.children[1].rect.height, 30.0);
    }

    #[test]
    fn row_wraps_items() {
        let widget = Widget::row(
            (0..4)
                .map(|_| Widget::text("abcdefghij").height_px(20.0).width_px(100.0))
                .collect(),
        )
        .wrap()
        .gap(10.0);
        let tree = layout(
            &widget,
            Size::new(250.0, 300.0),
            &theme(),
            &LayoutOptions::empty(),
        );
        assert_eq!(tree.root.children.len(), 4);
        assert_eq!(tree.root.children[0].rect.y, tree.root.children[1].rect.y);
        assert!(tree.root.children[2].rect.y > tree.root.children[1].rect.y);
    }

    #[test]
    fn grid_uses_responsive_columns() {
        let widget = Widget::grid(
            crate::responsive!(Xs => 1usize, Md => 2, Xl => 3),
            (0..6)
                .map(|i| Widget::text(format!("{i}")).height_px(40.0))
                .collect(),
        );
        let small = layout(
            &widget,
            Size::new(400.0, 600.0),
            &theme(),
            &LayoutOptions::empty(),
        );
        let wide = layout(
            &widget,
            Size::new(900.0, 600.0),
            &theme(),
            &LayoutOptions::empty(),
        );
        assert!(small.root.children[0].rect.width > wide.root.children[0].rect.width);
        assert!(small.root.children[1].rect.y > small.root.children[0].rect.y);
        assert_eq!(wide.root.children[0].rect.y, wide.root.children[1].rect.y);
        assert_eq!(wide.root.children[0].rect.y, wide.root.children[2].rect.y);
    }

    #[test]
    fn stack_overlays_children() {
        let widget = Widget::stack(vec![
            Widget::text("a").height_px(100.0),
            Widget::text("b").height_px(50.0),
        ])
        .padding_all(8.0);
        let tree = layout(
            &widget,
            Size::new(300.0, 200.0),
            &theme(),
            &LayoutOptions::empty(),
        );
        assert_eq!(tree.root.children[0].rect.x, tree.root.children[1].rect.x);
        assert_eq!(tree.root.children[0].rect.y, tree.root.children[1].rect.y);
    }

    #[test]
    fn hit_test_finds_button() {
        let widget = column(vec![
            Widget::text("title").height_px(30.0),
            Widget::button("Save").on_click(|| {}).height_px(40.0),
        ])
        .gap(10.0)
        .padding_all(20.0);
        let tree = layout(
            &widget,
            Size::new(300.0, 300.0),
            &theme(),
            &LayoutOptions::empty(),
        );
        let button = &tree.root.children[1];
        let hit = tree.hit_test(button.rect.center()).expect("button hit");
        assert_eq!(hit.id, button.id);
        assert!(tree.hit_test(Point::new(1.0, 1.0)).is_none());
    }

    #[test]
    fn disabled_button_is_not_hit() {
        let widget = Widget::button("Save").enabled(false).height_px(40.0);
        let tree = layout(
            &widget,
            Size::new(300.0, 300.0),
            &theme(),
            &LayoutOptions::empty(),
        );
        assert!(tree.hit_test(tree.root.rect.center()).is_none());
    }

    #[test]
    fn focus_order_follows_tree() {
        let widget = column(vec![
            Widget::text_field(&crate::form::Field::<String>::new("a", "A"), "A"),
            Widget::button("B").on_click(|| {}),
        ]);
        let tree = layout(
            &widget,
            Size::new(320.0, 500.0),
            &theme(),
            &LayoutOptions::empty(),
        );
        assert_eq!(tree.focusables().len(), 2);
        let first = tree.next_focus(None, true).expect("first");
        assert_eq!(first, tree.focusables()[0]);
        let second = tree.next_focus(Some(first), true).expect("second");
        assert_eq!(second, tree.focusables()[1]);
        let wrapped = tree.next_focus(Some(second), true).expect("wrapped");
        assert_eq!(wrapped, first);
        let backward = tree.next_focus(Some(first), false).expect("backward");
        assert_eq!(backward, second);
    }

    #[test]
    fn clip_and_rects_are_finite() {
        let widget = column(vec![Widget::text("x").width_px(2000.0)]).padding_all(10.0);
        let tree = layout(
            &widget,
            Size::new(100.0, 100.0),
            &theme(),
            &LayoutOptions::empty(),
        );
        assert!(tree.root.rect.width <= 100.0);
        assert!(tree.root.children[0].rect.width <= 100.0);
    }

    #[test]
    fn text_measure_wraps() {
        let style = TextStyle::new(16.0, 24.0, FontWeight::Regular);
        let size = measure_text("hello world hello world", style, 100.0);
        assert!(size.height >= 48.0);
        assert!(size.width <= 100.0);
    }

    #[test]
    fn responsive_columns_change_grid_layout() {
        let widget = Widget::grid(
            Responsive::new(&[(Breakpoint::Xs, 1usize), (Breakpoint::Lg, 4)]),
            (0..4)
                .map(|i| Widget::text(format!("{i}")).height_px(20.0))
                .collect(),
        );
        let narrow = layout(
            &widget,
            Size::new(300.0, 400.0),
            &theme(),
            &LayoutOptions::empty(),
        );
        let wide = layout(
            &widget,
            Size::new(650.0, 400.0),
            &theme(),
            &LayoutOptions::empty(),
        );
        assert!(narrow.root.children[1].rect.y > narrow.root.children[0].rect.y);
        assert_eq!(wide.root.children[0].rect.y, wide.root.children[3].rect.y);
    }

    #[test]
    fn card_applies_padding_gap_and_tokens() {
        let widget = Widget::card(vec![
            Widget::text("first").height_px(20.0),
            Widget::text("second").height_px(30.0),
        ])
        .padding_all(28.0)
        .gap(20.0);
        let theme = theme();
        let tree = layout(
            &widget,
            Size::new(600.0, 400.0),
            &theme,
            &LayoutOptions::empty(),
        );
        assert_eq!(tree.root.radius, theme.radius.card);
        assert_eq!(tree.root.children[0].rect.y, 28.0);
        assert_eq!(tree.root.children[1].rect.y, 28.0 + 20.0 + 20.0);
        assert_eq!(tree.root.children[0].rect.x, 28.0);
    }

    #[test]
    fn card_gap_is_measured_not_only_arranged() {
        let widget = Widget::card(vec![
            Widget::text("first").height_px(20.0),
            Widget::text("second").height_px(30.0),
        ])
        .padding_all(20.0)
        .gap(16.0);
        let wrapper = Widget::column(vec![widget]);
        let tree = layout(
            &wrapper,
            Size::new(400.0, 300.0),
            &theme(),
            &LayoutOptions::empty(),
        );
        assert_eq!(tree.root.children[0].rect.height, 20.0 + 30.0 + 16.0 + 40.0);
    }

    #[test]
    fn nav_items_create_hit_targets() {
        let selected = Signal::new(0usize);
        let widget = Widget::nav_rail(
            vec![
                NavItem {
                    icon: IconName::Home,
                    label: "Home".into(),
                },
                NavItem {
                    icon: IconName::Chart,
                    label: "Stats".into(),
                },
            ],
            selected,
        )
        .on_select(move |index| selected.set(index));
        let tree = layout(
            &widget,
            Size::new(800.0, 600.0),
            &theme(),
            &LayoutOptions::empty(),
        );
        assert_eq!(tree.root.children.len(), 2);
        let second = &tree.root.children[1];
        let hit = tree.hit_test(second.rect.center()).expect("hit");
        (hit.interaction.click.as_ref().expect("click"))();
        assert_eq!(selected.get(), 1);
    }
}

#[cfg(test)]
mod pagination_tests {
    use super::pagination_slots;

    #[test]
    fn pagination_slots_show_edges_and_current_page() {
        assert_eq!(pagination_slots(0, 5), vec![0, 1, 2, 3, 4]);
        let slots = pagination_slots(11, 24);
        assert_eq!(slots.first(), Some(&0));
        assert_eq!(slots.last(), Some(&23));
        assert!(slots.contains(&11));
        assert!(slots.contains(&10));
        assert!(slots.contains(&12));
        assert_eq!(slots.len(), 7);
    }
}
