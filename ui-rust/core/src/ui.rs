use std::collections::HashMap;

use crate::clipboard::{Clipboard, MemoryClipboard};
use crate::damage::Damage;
use crate::geometry::{Point, Rect, Size};
use crate::layout::{
    layout, CursorShape, EditBinding, LayoutOptions, LayoutTree, NodeId, PaintData,
};
use crate::layout::{DataTableDragMode, DataTableDragView, LayoutNode, PaintData as UiPaint};
use crate::signal::{revision, Signal};
use crate::theme::Theme;
use crate::view::ViewSource;
use crate::widget::{DataTableState, Widget};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Key {
    Tab,
    Enter,
    Escape,
    Backspace,
    Delete,
    ArrowLeft,
    ArrowRight,
    ArrowUp,
    ArrowDown,
    Home,
    End,
    Space,
    Char(char),
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Modifiers {
    pub shift: bool,
    pub control: bool,
    pub alt: bool,
    pub meta: bool,
}

impl Modifiers {
    pub fn command(self) -> bool {
        self.control || self.meta
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum UiEvent {
    PointerMove(Point),
    PointerDown(Point),
    PointerUp(Point),
    PointerLeave,
    Wheel {
        delta: f32,
    },
    Key {
        key: Key,
        modifiers: Modifiers,
        pressed: bool,
    },
    Text(String),
    Ime(String),
    FocusLost,
    Resize(Size),
}

#[derive(Clone, Debug, Default)]
pub struct UiState {
    pub focus: Option<NodeId>,
    pub hover: Option<NodeId>,
    pub pressed: Option<NodeId>,
    pub pointer: Point,
    pub cursor: CursorShape,
    pub scroll: f32,
    pub editing: HashMap<NodeId, usize>,
    pub selection: HashMap<NodeId, usize>,
    pub table_hover: Option<(NodeId, usize)>,
    pub table_hover_row: Option<(NodeId, usize)>,
    pub table_drag: Option<TableDrag>,
    pub last_table_click: Option<(NodeId, std::time::Instant)>,
}

#[derive(Clone, Debug)]
pub struct TableDrag {
    pub node: NodeId,
    pub mode: DataTableDragMode,
    pub source: usize,
    pub target: usize,
    pub start_x: f32,
    pub start_widths: Vec<f32>,
    pub ghost_x: f32,
    pub width_badge: Option<f32>,
    pub applied: bool,
}

impl UiState {
    pub fn is_focused(&self, id: NodeId) -> bool {
        self.focus == Some(id)
    }
}

#[derive(Clone)]
struct TableGeometry {
    id: NodeId,
    rect: Rect,
    header_height: f32,
    row_height: f32,
    widths: Vec<f32>,
    order: Vec<usize>,
    scroll: f32,
    rows: Vec<(usize, Vec<String>)>,
    total_rows: usize,
    state: DataTableState,
}

impl TableDrag {
    fn view(&self) -> DataTableDragView {
        DataTableDragView {
            mode: self.mode.clone(),
            source: self.source,
            target: self.target,
            ghost_x: self.ghost_x,
            width_badge: self.width_badge,
            applied: self.applied,
        }
    }
}

#[derive(Clone, Copy)]
struct ScrollAnimation {
    signal: Signal<f32>,
    from: f32,
    value: f32,
    to: f32,
    elapsed: f32,
    duration: f32,
    viewport: Rect,
}

pub struct Ui {
    theme: Theme,
    state: UiState,
    source: Option<Box<dyn ViewSource>>,
    tree: Option<LayoutTree>,
    viewport: Size,
    last_viewport: Size,
    last_revision: u64,
    dirty: bool,
    damage: Damage,
    force_full: bool,
    paint_dirty: bool,
    layout_rebuilds: u64,
    clipboard: Box<dyn Clipboard>,
    scroll_animation: Option<ScrollAnimation>,
}

impl Ui {
    pub fn new(theme: Theme) -> Self {
        Self {
            theme,
            state: UiState::default(),
            source: None,
            tree: None,
            viewport: Size::new(800.0, 600.0),
            last_viewport: Size::ZERO,
            last_revision: u64::MAX,
            dirty: true,
            damage: Damage::full(),
            force_full: true,
            paint_dirty: false,
            layout_rebuilds: 0,
            clipboard: Box::new(MemoryClipboard::new()),
            scroll_animation: None,
        }
    }

    pub fn set_source(&mut self, source: Box<dyn ViewSource>) {
        if let Some(previous) = self.source.take() {
            previous.dispose();
        }
        self.source = Some(source);
        self.dirty = true;
        self.force_full = true;
    }

    pub fn set_view<VM: crate::view_model::ViewModel>(&mut self, view: crate::view::View<VM>) {
        self.set_source(Box::new(view));
    }

    pub fn theme(&self) -> &Theme {
        &self.theme
    }

    pub fn set_theme(&mut self, theme: Theme) {
        self.theme = theme;
        self.dirty = true;
        self.force_full = true;
    }

    pub fn toggle_theme(&mut self) {
        let theme = self.theme.toggle();
        self.set_theme(theme);
    }

    pub fn state(&self) -> &UiState {
        &self.state
    }

    pub fn set_clipboard(&mut self, clipboard: Box<dyn Clipboard>) {
        self.clipboard = clipboard;
    }

    pub fn resize(&mut self, size: Size) {
        if size.width <= 0.0 || size.height <= 0.0 {
            return;
        }
        if self.viewport != size {
            self.viewport = size;
            self.dirty = true;
            self.force_full = true;
        }
    }

    pub fn viewport(&self) -> Size {
        self.viewport
    }

    pub fn invalidate(&mut self) {
        self.force_full = true;
        self.damage = Damage::full();
    }

    pub fn frame(&mut self) {
        if let Some(source) = &self.source {
            source.on_frame();
        }
        self.advance_scroll(16.0);
    }

    fn advance_scroll(&mut self, dt_ms: f32) {
        let Some(mut animation) = self.scroll_animation else {
            return;
        };
        animation.elapsed += dt_ms;
        let t = (animation.elapsed / animation.duration).clamp(0.0, 1.0);
        let eased = 1.0 - (1.0 - t).powi(3);
        let value = animation.from + (animation.to - animation.from) * eased;
        if (value - animation.value).abs() > 0.01 {
            animation.signal.set(value);
            animation.value = value;
            self.damage = self.damage.union(Damage::rect(animation.viewport));
        }
        if t >= 1.0 {
            animation.signal.set(animation.to);
            self.scroll_animation = None;
        } else {
            self.scroll_animation = Some(animation);
        }
    }

    pub fn layout(&mut self) -> &LayoutTree {
        let current_revision = revision();
        let needs_layout = self.tree.is_none()
            || self.dirty
            || self.viewport != self.last_viewport
            || current_revision != self.last_revision;
        if !needs_layout && self.paint_dirty {
            let carets = self.collect_carets();
            let selections = self.collect_selections();
            let options = LayoutOptions {
                focus: self.state.focus,
                hover: self.state.hover,
                pressed: self.state.pressed,
                table_hover: self.state.table_hover,
                table_hover_row: self.state.table_hover_row,
                table_drag: self
                    .state
                    .table_drag
                    .as_ref()
                    .map(|drag| (drag.node, drag.view())),
                carets: &carets,
                selections: &selections,
            };
            if let Some(tree) = self.tree.as_mut() {
                let damage = crate::layout::patch_interaction(tree, &options);
                self.damage = self.damage.union(damage);
            }
            self.paint_dirty = false;
        }
        if needs_layout {
            let widget = self
                .source
                .as_ref()
                .map(|source| source.widget())
                .unwrap_or_else(|| Widget::text(""));
            let carets = self.collect_carets();
            let selections = self.collect_selections();
            let options = LayoutOptions {
                focus: self.state.focus,
                hover: self.state.hover,
                pressed: self.state.pressed,
                table_hover: self.state.table_hover,
                table_hover_row: self.state.table_hover_row,
                table_drag: self
                    .state
                    .table_drag
                    .as_ref()
                    .map(|drag| (drag.node, drag.view())),
                carets: &carets,
                selections: &selections,
            };
            let tree = layout(&widget, self.viewport, &self.theme, &options);
            if let Some(focus) = self.state.focus {
                if !tree.focusables().contains(&focus) {
                    self.state.focus = None;
                }
            }
            let frame_damage = match &self.tree {
                Some(previous) if !self.force_full => {
                    crate::layout::compute_damage(previous, &tree).expand(2.0)
                }
                _ => Damage::full(),
            };
            self.damage = self.damage.union(frame_damage);
            self.tree = Some(tree);
            self.last_viewport = self.viewport;
            self.last_revision = current_revision;
            self.dirty = false;
            self.force_full = false;
            self.paint_dirty = false;
            self.layout_rebuilds += 1;
        }
        self.tree.as_ref().expect("layout is initialized")
    }

    pub fn tree(&self) -> Option<&LayoutTree> {
        self.tree.as_ref()
    }

    pub fn focus_key(&mut self, key: &str) -> bool {
        let _ = self.layout();
        let id = self
            .tree
            .as_ref()
            .and_then(|tree| tree.find_key(key))
            .map(|node| node.id);
        match id {
            Some(id) => {
                self.focus(id);
                true
            }
            None => false,
        }
    }

    pub fn damage(&self) -> Damage {
        self.damage.clamp(self.viewport)
    }

    pub fn clear_damage(&mut self) {
        self.damage = Damage::NONE;
    }

    pub fn take_damage(&mut self) -> Damage {
        let damage = self.damage();
        self.damage = Damage::NONE;
        damage
    }

    pub fn source_needs_frame(&self) -> bool {
        self.source
            .as_ref()
            .map(|source| source.needs_frame())
            .unwrap_or(false)
    }

    pub fn needs_frame(&self) -> bool {
        self.dirty
            || self.paint_dirty
            || self.viewport != self.last_viewport
            || revision() != self.last_revision
            || !self.damage.is_empty()
            || self.scroll_animation.is_some()
            || self
                .source
                .as_ref()
                .map(|source| source.needs_frame())
                .unwrap_or(false)
    }

    pub fn layout_rebuilds(&self) -> u64 {
        self.layout_rebuilds
    }

    fn collect_carets(&self) -> HashMap<NodeId, usize> {
        self.state
            .editing
            .iter()
            .filter(|(id, _)| self.state.focus == Some(**id))
            .map(|(id, caret)| (*id, *caret))
            .collect()
    }

    fn collect_selections(&self) -> HashMap<NodeId, (usize, usize)> {
        let Some(focus) = self.state.focus else {
            return HashMap::new();
        };
        let Some(cursor) = self.state.editing.get(&focus).copied() else {
            return HashMap::new();
        };
        let anchor = self.state.selection.get(&focus).copied().unwrap_or(cursor);
        if anchor == cursor {
            return HashMap::new();
        }
        let mut result = HashMap::new();
        result.insert(focus, (anchor.min(cursor), anchor.max(cursor)));
        result
    }

    fn selection_range(&self) -> Option<(NodeId, usize, usize)> {
        let focus = self.state.focus?;
        let cursor = self.state.editing.get(&focus).copied()?;
        let anchor = self.state.selection.get(&focus).copied().unwrap_or(cursor);
        if anchor == cursor {
            None
        } else {
            Some((focus, anchor.min(cursor), anchor.max(cursor)))
        }
    }

    fn select_all(&mut self) -> bool {
        let Some((id, binding, _)) = self.focused_edit() else {
            return false;
        };
        let length = binding.value.peek().chars().count();
        self.state.selection.insert(id, 0);
        self.state.editing.insert(id, length);
        self.dirty = true;
        true
    }

    pub fn handle_event(&mut self, event: UiEvent) -> bool {
        let _ = self.layout();
        match event {
            UiEvent::Resize(size) => {
                self.resize(size);
                true
            }
            UiEvent::PointerMove(point) => self.pointer_move(point),
            UiEvent::PointerDown(point) => self.pointer_down(point),
            UiEvent::PointerUp(point) => self.pointer_up(point),
            UiEvent::PointerLeave => {
                let changed = self.state.hover.is_some()
                    || self.state.table_hover.is_some()
                    || self.state.table_hover_row.is_some();
                self.state.hover = None;
                self.state.table_hover = None;
                self.state.table_hover_row = None;
                self.state.cursor = CursorShape::Default;
                self.state.pointer = Point::new(-1.0, -1.0);
                if changed {
                    self.paint_dirty = true;
                }
                changed
            }
            UiEvent::Wheel { delta } => {
                if self.table_wheel(delta) {
                    return true;
                }
                if self.scroll_wheel(delta) {
                    return true;
                }
                self.state.scroll += delta;
                self.force_full = true;
                self.damage = Damage::full();
                true
            }
            UiEvent::Key {
                key,
                modifiers,
                pressed,
            } => pressed && self.key_down(key, modifiers),
            UiEvent::Text(text) | UiEvent::Ime(text) => self.insert_text(&text),
            UiEvent::FocusLost => {
                self.blur();
                true
            }
        }
    }

    fn table_geometry(&self, node: &LayoutNode) -> Option<TableGeometry> {
        let UiPaint::DataTable {
            widths,
            compact,
            scroll,
            rows,
            total_rows,
            ..
        } = &node.paint
        else {
            return None;
        };
        let state = node.interaction.data_table.clone()?;
        let order = state.order.peek();
        Some(TableGeometry {
            id: node.id,
            rect: node.rect,
            header_height: self.theme.sizes.table_header_height,
            row_height: if *compact {
                self.theme.sizes.table_row_compact
            } else {
                self.theme.scaled(self.theme.sizes.table_row_height)
            },
            widths: widths.clone(),
            order,
            scroll: *scroll,
            rows: rows.clone(),
            total_rows: *total_rows,
            state,
        })
    }

    fn table_hit(&self, point: Point) -> Option<TableGeometry> {
        let tree = self.tree.as_ref()?;
        let node = tree.hit_test(point)?;
        self.table_geometry(node)
    }

    fn table_column_at(&self, geometry: &TableGeometry, x: f32) -> Option<usize> {
        let total: f32 = geometry.widths.iter().sum::<f32>().max(1.0);
        let scale = geometry.rect.width / total;
        let mut cursor = geometry.rect.x;
        for (index, width) in geometry.widths.iter().enumerate() {
            let right = cursor + width * scale;
            if x >= cursor && x <= right {
                return Some(index);
            }
            cursor = right;
        }
        None
    }

    fn table_column_rect(&self, geometry: &TableGeometry, index: usize) -> Rect {
        let total: f32 = geometry.widths.iter().sum::<f32>().max(1.0);
        let scale = geometry.rect.width / total;
        let x: f32 = geometry.widths.iter().take(index).sum::<f32>() * scale;
        let width = geometry.widths.get(index).copied().unwrap_or(0.0) * scale;
        Rect::new(
            geometry.rect.x + x,
            geometry.rect.y,
            width,
            geometry.header_height,
        )
    }

    fn table_row_at(&self, geometry: &TableGeometry, y: f32) -> Option<usize> {
        let first = geometry.rows.first()?.0;
        let body_top = geometry.rect.y + geometry.header_height;
        let bulk = if geometry.state.selected.peek().is_empty() {
            0.0
        } else {
            40.0
        };
        let body_bottom = geometry.rect.bottom() - 48.0 - bulk;
        if y < body_top || y >= body_bottom {
            return None;
        }
        let remainder = geometry.scroll % geometry.row_height;
        let offset = (y - body_top + remainder) / geometry.row_height;
        let row = first + offset.floor() as usize;
        (row < geometry.total_rows).then_some(row)
    }

    fn reset_table_widths(&mut self, id: NodeId) -> bool {
        let Some(tree) = self.tree.as_ref() else {
            return false;
        };
        let Some(node) = tree.find(id) else {
            return false;
        };
        let Some(state) = node.interaction.data_table.clone() else {
            return false;
        };
        let Some(defaults) = node.interaction.data_table_defaults.clone() else {
            return false;
        };
        state.widths.set(defaults);
        self.dirty = true;
        true
    }

    fn table_drag_update(&mut self, point: Point) -> bool {
        let Some(drag) = self.state.table_drag.clone() else {
            return false;
        };
        let Some(tree) = self.tree.as_ref() else {
            return false;
        };
        let Some(node) = tree.find(drag.node) else {
            return false;
        };
        let Some(geometry) = self.table_geometry(node) else {
            return false;
        };
        let mut drag = drag;
        match drag.mode {
            DataTableDragMode::Resize => {
                if !drag.applied && (point.x - drag.start_x).abs() > 0.5 {
                    drag.applied = true;
                }
                if drag.applied {
                    let width = (drag.start_widths[drag.source] + (point.x - drag.start_x))
                        .max(72.0)
                        .min(geometry.rect.width - 72.0);
                    let mut widths = drag.start_widths.clone();
                    if let Some(original) = geometry.order.get(drag.source) {
                        if let Some(slot) = widths.get_mut(*original) {
                            *slot = width;
                        }
                        geometry.state.widths.set(widths);
                    }
                    drag.width_badge = Some(width);
                }
                drag.ghost_x = point.x;
            }
            DataTableDragMode::Reorder => {
                if let Some(target) = self.table_column_at(&geometry, point.x) {
                    drag.target = target;
                }
                drag.ghost_x = point
                    .x
                    .clamp(geometry.rect.x + 20.0, geometry.rect.right() - 20.0);
            }
        }
        self.state.table_drag = Some(drag);
        self.state.table_hover = self
            .table_column_at(&geometry, point.x)
            .map(|column| (geometry.id, column));
        self.state.cursor = match self.state.table_drag.as_ref().map(|d| &d.mode) {
            Some(DataTableDragMode::Resize) => CursorShape::ResizeHorizontal,
            _ => CursorShape::Grabbing,
        };
        self.paint_dirty = true;
        true
    }

    fn pointer_move(&mut self, point: Point) -> bool {
        self.state.pointer = point;
        if self.table_drag_update(point) {
            return true;
        }
        if let Some(pressed) = self.state.pressed {
            if self.apply_slider(pressed, point.x) {
                self.dirty = true;
            }
        }
        if self.state.pressed == self.state.focus {
            let drag = self.focused_edit().and_then(|(id, binding, _)| {
                let node = self.tree.as_ref()?.find(id)?;
                let value = binding.value.peek();
                let caret = caret_from_x(point.x, node.rect.x, &value, self.theme.sizes.font_size);
                Some((id, caret))
            });
            if let Some((id, caret)) = drag {
                let changed = self.state.editing.get(&id).copied() != Some(caret);
                self.state.editing.insert(id, caret);
                if changed {
                    self.dirty = true;
                }
            }
        }
        let (hover, cursor) = {
            let tree = self.layout();
            match tree.hit_test(point) {
                Some(node) => (Some(node.id), node.interaction.cursor()),
                None => (None, CursorShape::Default),
            }
        };
        let changed = self.state.hover != hover || self.state.cursor != cursor;
        self.state.hover = hover;
        self.state.cursor = cursor;
        self.state.table_hover_row = None;
        if let Some(geometry) = self.table_hit(point) {
            if point.y < geometry.rect.y + geometry.header_height {
                if let Some(column) = self.table_column_at(&geometry, point.x) {
                    let column_rect = self.table_column_rect(&geometry, column);
                    let near_edge = point.x >= column_rect.right() - 7.0;
                    self.state.table_hover = Some((geometry.id, column));
                    self.state.cursor = if near_edge {
                        CursorShape::ResizeHorizontal
                    } else {
                        CursorShape::Grab
                    };
                }
            } else {
                self.state.table_hover = None;
                if let Some(row) = self.table_row_at(&geometry, point.y) {
                    self.state.table_hover_row = Some((geometry.id, row));
                    self.state.cursor = CursorShape::Pointer;
                } else {
                    self.state.cursor = CursorShape::Default;
                }
            }
        } else {
            self.state.table_hover = None;
        }
        if changed || self.state.table_hover.is_some() || self.state.table_hover_row.is_some() {
            self.paint_dirty = true;
        }
        changed
    }

    fn pointer_down(&mut self, point: Point) -> bool {
        self.state.pointer = point;
        let hit = {
            let tree = self.layout();
            tree.hit_test(point).map(|node| {
                (
                    node.id,
                    node.rect,
                    node.interaction.focusable,
                    node.interaction.edit.clone(),
                    match &node.paint {
                        PaintData::TextField { value, .. } => Some(value.clone()),
                        _ => None,
                    },
                )
            })
        };
        let Some((id, rect, focusable, edit, value)) = hit else {
            self.blur();
            self.state.pressed = None;
            return true;
        };
        self.state.pressed = Some(id);
        self.paint_dirty = true;
        if focusable {
            self.focus(id);
        } else {
            self.blur();
        }
        if self.apply_slider(id, point.x) {
            self.dirty = true;
        }
        if self.table_pointer_down(id, point) {
            return true;
        }
        if let Some(binding) = edit {
            let value = value.unwrap_or_else(|| binding.value.peek());
            let caret = caret_from_x(point.x, rect.x, &value, self.theme.sizes.font_size);
            self.state.editing.insert(id, caret);
            self.state.selection.insert(id, caret);
            self.dirty = true;
        }
        true
    }

    fn pointer_up(&mut self, point: Point) -> bool {
        self.state.pointer = point;
        if self.table_pointer_up() {
            return true;
        }
        let pressed = self.state.pressed.take();
        let Some(pressed) = pressed else {
            return false;
        };
        let hit = {
            let tree = self.layout();
            tree.hit_test(point).map(|node| node.id)
        };
        if hit != Some(pressed) {
            return true;
        }
        let action = {
            let tree = self.layout();
            tree.find(pressed).and_then(|node| {
                node.interaction
                    .click
                    .clone()
                    .or_else(|| node.interaction.edit.as_ref().and_then(|_| None))
            })
        };
        if let Some(action) = action {
            action();
            self.dirty = true;
            return true;
        }
        false
    }

    fn key_down(&mut self, key: Key, modifiers: Modifiers) -> bool {
        match key {
            Key::Tab => {
                let current = self.state.focus;
                let next = {
                    let tree = self.layout();
                    tree.next_focus(current, !modifiers.shift)
                };
                match next {
                    Some(id) => {
                        self.focus(id);
                        true
                    }
                    None => false,
                }
            }
            Key::Escape => {
                if self.state.table_drag.take().is_some() {
                    self.dirty = true;
                    true
                } else if modifiers.command() {
                    false
                } else {
                    self.blur();
                    true
                }
            }
            Key::Enter => {
                if let Some((_, binding, _)) = self.focused_edit() {
                    if binding.multiline {
                        self.insert_text("\n")
                    } else {
                        self.activate_focused()
                    }
                } else {
                    self.activate_focused()
                }
            }
            Key::Space => {
                if self.focused_edit().is_some() {
                    self.insert_text(" ")
                } else {
                    self.activate_focused()
                }
            }
            Key::Backspace => self.edit_backspace(),
            Key::Delete => self.edit_delete(),
            Key::ArrowLeft => self.edit_move(-1, modifiers.shift),
            Key::ArrowRight => self.edit_move(1, modifiers.shift),
            Key::Home => {
                if self.reset_focused_table() {
                    true
                } else {
                    self.edit_home(modifiers.shift)
                }
            }
            Key::End => self.edit_end(modifiers.shift),
            Key::Char(character) => {
                if modifiers.command() {
                    match character.to_ascii_lowercase() {
                        'a' => self.select_all(),
                        'c' => self.clipboard_copy(),
                        'v' => self.clipboard_paste(),
                        'x' => self.clipboard_cut(),
                        _ => false,
                    }
                } else {
                    false
                }
            }
            Key::ArrowUp | Key::ArrowDown => false,
        }
    }

    fn table_page_at(&self, geometry: &TableGeometry, point: Point) -> Option<usize> {
        let bulk = if geometry.state.selected.peek().is_empty() {
            0.0
        } else {
            40.0
        };
        let footer_top = geometry.rect.bottom() - 48.0 - bulk;
        if point.y < footer_top || point.y > geometry.rect.bottom() {
            return None;
        }
        let pages = geometry.state.pages.max(1);
        let slots = crate::layout::pagination_slots(geometry.state.page.peek(), pages);
        let button = 28.0;
        let gap = 4.0;
        let total_width = slots.len() as f32 * button + slots.len().saturating_sub(1) as f32 * gap;
        let start = (geometry.rect.right() - 16.0 - total_width).max(geometry.rect.x + 16.0);
        if point.x < start || point.x > start + total_width {
            return None;
        }
        let index = ((point.x - start) / (button + gap)).floor() as usize;
        let slot = slots.get(index).copied()?;
        (slot != usize::MAX).then_some(slot)
    }

    fn table_pointer_down(&mut self, id: NodeId, point: Point) -> bool {
        let Some(tree) = self.tree.as_ref() else {
            return false;
        };
        let Some(node) = tree.find(id) else {
            return false;
        };
        let Some(geometry) = self.table_geometry(node) else {
            return false;
        };
        if point.y < geometry.rect.y + geometry.header_height {
            let Some(column) = self.table_column_at(&geometry, point.x) else {
                return true;
            };
            let column_rect = self.table_column_rect(&geometry, column);
            let resize = point.x >= column_rect.right() - 7.0;
            let now = std::time::Instant::now();
            let double = !resize
                && self
                    .state
                    .last_table_click
                    .map(|(node, at)| node == id && now.duration_since(at).as_millis() < 350)
                    .unwrap_or(false);
            self.state.last_table_click = Some((id, now));
            if double {
                self.reset_table_widths(id);
                self.state.table_drag = None;
                return true;
            }
            let start_widths = geometry.state.widths.peek();
            self.state.table_drag = Some(TableDrag {
                node: id,
                mode: if resize {
                    DataTableDragMode::Resize
                } else {
                    DataTableDragMode::Reorder
                },
                source: column,
                target: column,
                start_x: point.x,
                start_widths,
                ghost_x: point.x,
                width_badge: None,
                applied: false,
            });
            self.state.table_hover = Some((id, column));
            self.state.cursor = if resize {
                CursorShape::ResizeHorizontal
            } else {
                CursorShape::Grabbing
            };
            self.paint_dirty = true;
            return true;
        }
        if let Some(page) = self.table_page_at(&geometry, point) {
            if page != geometry.state.page.peek() {
                geometry.state.page.set(page);
                geometry.state.scroll.set(0.0);
                self.dirty = true;
            }
            return true;
        }
        if let Some(row) = self.table_row_at(&geometry, point.y) {
            let mut selected = geometry.state.selected.peek();
            if let Some(position) = selected.iter().position(|value| *value == row) {
                selected.remove(position);
            } else {
                selected.push(row);
            }
            geometry.state.selected.set(selected);
            self.dirty = true;
            return true;
        }
        false
    }

    fn table_pointer_up(&mut self) -> bool {
        let Some(drag) = self.state.table_drag.take() else {
            return false;
        };
        if matches!(drag.mode, DataTableDragMode::Reorder)
            && (drag.ghost_x - drag.start_x).abs() < 4.0
        {
            if let Some(tree) = self.tree.as_ref() {
                if let Some(node) = tree.find(drag.node) {
                    if let Some(geometry) = self.table_geometry(node) {
                        let current = geometry.state.sort.peek();
                        let ascending = if current == Some(drag.source) {
                            !geometry.state.sort_ascending.peek()
                        } else {
                            true
                        };
                        geometry.state.sort.set(Some(drag.source));
                        geometry.state.sort_ascending.set(ascending);
                        geometry.state.page.set(0);
                        geometry.state.scroll.set(0.0);
                        self.paint_dirty = true;
                    }
                }
            }
            return true;
        }
        if matches!(drag.mode, DataTableDragMode::Reorder) && drag.target != drag.source {
            let Some(tree) = self.tree.as_ref() else {
                return true;
            };
            let Some(node) = tree.find(drag.node) else {
                return true;
            };
            if let Some(geometry) = self.table_geometry(node) {
                let mut order = geometry.order;
                if drag.source < order.len() && drag.target <= order.len() {
                    let column = order.remove(drag.source);
                    order.insert(drag.target.min(order.len()), column);
                    geometry.state.order.set(order);
                }
            }
        }
        self.dirty = true;
        true
    }

    fn scroll_wheel(&mut self, delta: f32) -> bool {
        let pointer = self.state.pointer;
        let info = self.tree.as_ref().and_then(|tree| {
            tree.root.scrollable_at(pointer).and_then(|node| {
                node.scroll_signal.map(|signal| {
                    (
                        signal,
                        node.scroll_offset,
                        node.content_height,
                        node.rect.height,
                        node.rect,
                    )
                })
            })
        });
        let Some((signal, offset, content, viewport, rect)) = info else {
            return false;
        };
        let max = (content - viewport).max(0.0);
        self.animate_scroll(signal, offset, max, rect, delta);
        true
    }

    fn animate_scroll(
        &mut self,
        signal: Signal<f32>,
        offset: f32,
        max: f32,
        rect: Rect,
        delta: f32,
    ) {
        let same = self
            .scroll_animation
            .map(|animation| animation.signal.id() == signal.id())
            .unwrap_or(false);
        let (from, current_target) = if same {
            let animation = self.scroll_animation.expect("checked");
            (animation.value, animation.to)
        } else {
            (offset, offset)
        };
        let target = (current_target + delta).clamp(0.0, max);
        self.scroll_animation = Some(ScrollAnimation {
            signal,
            from,
            value: from,
            to: target,
            elapsed: 0.0,
            duration: 150.0,
            viewport: rect,
        });
        self.damage = self.damage.union(Damage::rect(rect));
    }

    fn table_wheel(&mut self, delta: f32) -> bool {
        let Some(pointer) = Some(self.state.pointer) else {
            return false;
        };
        let Some(geometry) = self.table_hit(pointer) else {
            return false;
        };
        let body = (geometry.rect.height
            - geometry.header_height
            - 48.0
            - if geometry.state.selected.peek().is_empty() {
                0.0
            } else {
                40.0
            })
        .max(1.0);
        let max = (geometry.total_rows as f32 * geometry.row_height - body).max(0.0);
        if max <= 0.0 {
            return false;
        }
        if (delta > 0.0 && geometry.scroll >= max - 0.5) || (delta < 0.0 && geometry.scroll <= 0.5)
        {
            return false;
        }
        self.animate_scroll(
            geometry.state.scroll,
            geometry.scroll,
            max,
            geometry.rect,
            delta,
        );
        true
    }

    fn reset_focused_table(&mut self) -> bool {
        let Some(focus) = self.state.focus else {
            return false;
        };
        self.reset_table_widths(focus)
    }

    fn apply_slider(&mut self, id: NodeId, x: f32) -> bool {
        let Some(tree) = self.tree.as_ref() else {
            return false;
        };
        let Some(node) = tree.find(id) else {
            return false;
        };
        let Some(signal) = node.interaction.slider else {
            return false;
        };
        let padding = 9.0;
        let width = (node.rect.width - padding * 2.0).max(1.0);
        let value = ((x - node.rect.x - padding) / width).clamp(0.0, 1.0);
        if (signal.peek() - value).abs() < f32::EPSILON {
            return false;
        }
        signal.set(value);
        true
    }

    fn activate_focused(&mut self) -> bool {
        let focus = self.state.focus;
        let action = focus.and_then(|id| {
            let tree = self.layout();
            tree.find(id).map(|node| {
                (
                    node.interaction.click.clone(),
                    node.interaction
                        .edit
                        .as_ref()
                        .and_then(|e| e.on_submit.clone()),
                )
            })
        });
        if let Some((click, submit)) = action {
            if let Some(submit) = submit {
                submit();
                self.dirty = true;
                return true;
            }
            if let Some(click) = click {
                click();
                self.dirty = true;
                return true;
            }
        }
        false
    }

    fn focus(&mut self, id: NodeId) {
        if self.state.focus == Some(id) {
            return;
        }
        self.blur();
        self.state.focus = Some(id);
        let caret = {
            let tree = self.layout();
            tree.find(id)
                .and_then(|node| node.interaction.edit.as_ref())
                .map(|binding| binding.value.peek().chars().count())
        };
        if let Some(caret) = caret {
            self.state.editing.insert(id, caret);
            self.state.selection.insert(id, caret);
        }
        self.paint_dirty = true;
    }

    fn blur(&mut self) {
        if let Some(focus) = self.state.focus {
            let touched = self
                .tree
                .as_ref()
                .and_then(|tree| tree.find(focus))
                .and_then(|node| node.interaction.edit.as_ref())
                .and_then(|edit| edit.touched);
            if let Some(touched) = touched {
                touched.set(true);
            }
            self.state.selection.remove(&focus);
            self.state.editing.remove(&focus);
        }
        self.state.focus = None;
        self.paint_dirty = true;
    }

    fn focused_edit(&self) -> Option<(NodeId, EditBinding, usize)> {
        let id = self.state.focus?;
        let tree = self.tree.as_ref()?;
        let node = tree.find(id)?;
        let binding = node.interaction.edit.clone()?;
        let caret = self
            .state
            .editing
            .get(&id)
            .copied()
            .unwrap_or_else(|| binding.value.peek().chars().count());
        Some((id, binding, caret))
    }

    fn insert_text(&mut self, text: &str) -> bool {
        let Some((id, binding, caret)) = self.focused_edit() else {
            return false;
        };
        if text.is_empty() {
            return false;
        }
        let mut value = binding.value.peek();
        let mut insert_at = caret;
        if let Some((_, start, end)) = self.selection_range() {
            let start_byte = byte_index(&value, start);
            let end_byte = byte_index(&value, end);
            value.replace_range(start_byte..end_byte, "");
            insert_at = start;
        }
        let byte = byte_index(&value, insert_at);
        value.insert_str(byte, text);
        binding.value.set(value);
        let next = insert_at + text.chars().count();
        self.state.editing.insert(id, next);
        self.state.selection.insert(id, next);
        self.dirty = true;
        true
    }

    fn edit_backspace(&mut self) -> bool {
        let Some((id, binding, caret)) = self.focused_edit() else {
            return false;
        };
        let mut value = binding.value.peek();
        let (start, end) = if let Some((_, start, end)) = self.selection_range() {
            (start, end)
        } else if caret > 0 {
            (caret - 1, caret)
        } else {
            return false;
        };
        let start_byte = byte_index(&value, start);
        let end_byte = byte_index(&value, end);
        value.replace_range(start_byte..end_byte, "");
        binding.value.set(value);
        self.state.editing.insert(id, start);
        self.state.selection.insert(id, start);
        self.dirty = true;
        true
    }

    fn edit_delete(&mut self) -> bool {
        let Some((id, binding, caret)) = self.focused_edit() else {
            return false;
        };
        let mut value = binding.value.peek();
        let count = value.chars().count();
        let (start, end) = if let Some((_, start, end)) = self.selection_range() {
            (start, end)
        } else if caret < count {
            (caret, caret + 1)
        } else {
            return false;
        };
        let start_byte = byte_index(&value, start);
        let end_byte = byte_index(&value, end);
        value.replace_range(start_byte..end_byte, "");
        binding.value.set(value);
        self.state.editing.insert(id, start);
        self.state.selection.insert(id, start);
        self.dirty = true;
        true
    }

    fn edit_move(&mut self, delta: isize, extend: bool) -> bool {
        let Some((id, binding, caret)) = self.focused_edit() else {
            return false;
        };
        let count = binding.value.peek().chars().count();
        let next = (caret as isize + delta).clamp(0, count as isize) as usize;
        if next == caret {
            return false;
        }
        if extend {
            self.state.selection.entry(id).or_insert(caret);
        } else {
            self.state.selection.insert(id, next);
        }
        self.state.editing.insert(id, next);
        self.paint_dirty = true;
        true
    }

    fn edit_home(&mut self, extend: bool) -> bool {
        let Some((id, _, caret)) = self.focused_edit() else {
            return false;
        };
        if extend {
            self.state.selection.entry(id).or_insert(caret);
        } else {
            self.state.selection.insert(id, 0);
        }
        self.state.editing.insert(id, 0);
        self.paint_dirty = true;
        true
    }

    fn edit_end(&mut self, extend: bool) -> bool {
        let Some((id, binding, caret)) = self.focused_edit() else {
            return false;
        };
        let end = binding.value.peek().chars().count();
        if extend {
            self.state.selection.entry(id).or_insert(caret);
        } else {
            self.state.selection.insert(id, end);
        }
        self.state.editing.insert(id, end);
        self.paint_dirty = true;
        true
    }

    pub fn clipboard_copy(&mut self) -> bool {
        let Some((id, binding, _)) = self.focused_edit() else {
            return false;
        };
        let value = binding.value.peek();
        let text = match self.selection_range() {
            Some((focus, start, end)) if focus == id => char_slice(&value, start, end),
            _ => value,
        };
        self.clipboard.set_text(text);
        true
    }

    pub fn clipboard_paste(&mut self) -> bool {
        let Some(text) = self.clipboard.get_text() else {
            return false;
        };
        self.insert_text(&text)
    }

    pub fn clipboard_cut(&mut self) -> bool {
        let Some((id, binding, caret)) = self.focused_edit() else {
            return false;
        };
        if !self.clipboard_copy() {
            return false;
        }
        let mut value = binding.value.peek();
        let (start, end) = match self.selection_range() {
            Some((focus, start, end)) if focus == id => (start, end),
            _ => (0, value.chars().count()),
        };
        if start == end {
            return false;
        }
        let start_byte = byte_index(&value, start);
        let end_byte = byte_index(&value, end);
        value.replace_range(start_byte..end_byte, "");
        binding.value.set(value);
        self.state.editing.insert(id, start);
        self.state.selection.insert(id, start);
        let _ = caret;
        self.dirty = true;
        true
    }
}

impl Drop for Ui {
    fn drop(&mut self) {
        if let Some(source) = self.source.take() {
            source.dispose();
        }
    }
}

fn char_slice(text: &str, start: usize, end: usize) -> String {
    text.chars()
        .skip(start)
        .take(end.saturating_sub(start))
        .collect()
}

fn byte_index(text: &str, char_index: usize) -> usize {
    text.char_indices()
        .nth(char_index)
        .map(|(index, _)| index)
        .unwrap_or(text.len())
}

fn caret_from_x(x: f32, text_x: f32, value: &str, font_size: f32) -> usize {
    let char_width = (font_size * 0.56).max(1.0);
    let relative = (x - text_x - 12.0).max(0.0);
    let index = (relative / char_width).round() as usize;
    index.min(value.chars().count())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::form::Field;
    use crate::signal::Signal;
    use crate::view_model::ViewModel;

    fn theme() -> Theme {
        Theme::light()
    }

    fn ui_with(widget: Widget) -> Ui {
        struct StaticVm {
            widget: Widget,
        }
        impl ViewModel for StaticVm {
            fn view(&self) -> Widget {
                self.widget.clone()
            }
        }
        let mut ui = Ui::new(theme());
        ui.resize(Size::new(400.0, 600.0));
        ui.set_view(crate::view::View::new(StaticVm { widget }));
        let _ = ui.layout();
        ui
    }

    fn click(ui: &mut Ui, point: Point) {
        ui.handle_event(UiEvent::PointerMove(point));
        ui.handle_event(UiEvent::PointerDown(point));
        ui.handle_event(UiEvent::PointerUp(point));
    }

    #[test]
    fn button_click_invokes_callback() {
        let clicks = std::rc::Rc::new(std::cell::Cell::new(0));
        let captured = clicks.clone();
        let widget = Widget::button("Go")
            .on_click(move || captured.set(captured.get() + 1))
            .height_px(40.0);
        let mut ui = ui_with(widget);
        let center = ui.tree().expect("tree").root.rect.center();
        click(&mut ui, center);
        assert_eq!(clicks.get(), 1);
    }

    #[test]
    fn tab_cycles_focus() {
        let field_a = Field::<String>::new("a", "A");
        let field_b = Field::<String>::new("b", "B");
        let widget = Widget::column(vec![
            Widget::text_field(&field_a, "A"),
            Widget::text_field(&field_b, "B"),
        ])
        .gap(10.0)
        .padding_all(20.0);
        let mut ui = ui_with(widget);
        ui.handle_event(UiEvent::Key {
            key: Key::Tab,
            modifiers: Modifiers::default(),
            pressed: true,
        });
        assert!(ui.state().focus.is_some());
        let first = ui.state().focus.expect("focus");
        ui.handle_event(UiEvent::Key {
            key: Key::Tab,
            modifiers: Modifiers::default(),
            pressed: true,
        });
        let second = ui.state().focus.expect("focus");
        assert_ne!(first, second);
        ui.handle_event(UiEvent::Key {
            key: Key::Tab,
            modifiers: Modifiers {
                shift: true,
                ..Modifiers::default()
            },
            pressed: true,
        });
        assert_eq!(ui.state().focus, Some(first));
    }

    #[test]
    fn typing_updates_field_signal() {
        let field = Field::<String>::new("email", "Email");
        let signal = field.value;
        let widget = Widget::text_field(&field, "Email").height_px(80.0);
        let mut ui = ui_with(widget);
        let center = ui.tree().expect("tree").root.rect.center();
        click(&mut ui, center);
        ui.handle_event(UiEvent::Text("abc".to_string()));
        assert_eq!(signal.get(), "abc");
        ui.handle_event(UiEvent::Key {
            key: Key::Backspace,
            modifiers: Modifiers::default(),
            pressed: true,
        });
        assert_eq!(signal.get(), "ab");
        ui.handle_event(UiEvent::Key {
            key: Key::Home,
            modifiers: Modifiers::default(),
            pressed: true,
        });
        ui.handle_event(UiEvent::Text("X".to_string()));
        assert_eq!(signal.get(), "Xab");
    }

    #[test]
    fn checkbox_click_toggles_signal() {
        let field = Field::<bool>::with_value("remember", "Remember", false);
        let checked = field.value;
        let widget = Widget::checkbox(&field, "Remember").height_px(30.0);
        let mut ui = ui_with(widget);
        let center = ui.tree().expect("tree").root.rect.center();
        click(&mut ui, center);
        assert!(checked.get());
    }

    #[test]
    fn clipboard_copy_and_paste() {
        let field = Field::<String>::with_value("name", "Name", "hello".to_string());
        let value = field.value;
        let widget = Widget::text_field(&field, "Name").height_px(80.0);
        let mut ui = ui_with(widget);
        let center = ui.tree().expect("tree").root.rect.center();
        click(&mut ui, center);
        assert!(ui.clipboard_copy());
        value.set(String::new());
        assert!(ui.clipboard_paste());
        assert_eq!(value.get(), "hello");
    }

    #[test]
    fn shift_arrows_select_and_typing_replaces_selection() {
        let field = Field::<String>::with_value("name", "Name", "hello".to_string());
        let value = field.value;
        let widget = Widget::text_field(&field, "Name").height_px(80.0);
        let mut ui = ui_with(widget);
        let center = ui.tree().expect("tree").root.rect.center();
        click(&mut ui, center);
        ui.handle_event(UiEvent::Key {
            key: Key::Home,
            modifiers: Modifiers::default(),
            pressed: true,
        });
        for _ in 0..2 {
            ui.handle_event(UiEvent::Key {
                key: Key::ArrowRight,
                modifiers: Modifiers {
                    shift: true,
                    ..Modifiers::default()
                },
                pressed: true,
            });
        }
        assert!(ui.clipboard_copy());
        ui.handle_event(UiEvent::Text("X".to_string()));
        assert_eq!(value.get(), "Xllo");
        ui.handle_event(UiEvent::Key {
            key: Key::Char('a'),
            modifiers: Modifiers {
                control: true,
                ..Modifiers::default()
            },
            pressed: true,
        });
        ui.handle_event(UiEvent::Text("ok".to_string()));
        assert_eq!(value.get(), "ok");
    }

    #[test]
    fn backspace_deletes_selection() {
        let field = Field::<String>::with_value("name", "Name", "abcdef".to_string());
        let value = field.value;
        let widget = Widget::text_field(&field, "Name").height_px(80.0);
        let mut ui = ui_with(widget);
        let center = ui.tree().expect("tree").root.rect.center();
        click(&mut ui, center);
        ui.handle_event(UiEvent::Key {
            key: Key::Home,
            modifiers: Modifiers::default(),
            pressed: true,
        });
        for _ in 0..3 {
            ui.handle_event(UiEvent::Key {
                key: Key::ArrowRight,
                modifiers: Modifiers {
                    shift: true,
                    ..Modifiers::default()
                },
                pressed: true,
            });
        }
        ui.handle_event(UiEvent::Key {
            key: Key::Backspace,
            modifiers: Modifiers::default(),
            pressed: true,
        });
        assert_eq!(value.get(), "def");
    }

    #[test]
    fn hover_and_focus_do_not_rebuild_layout() {
        let widget = Widget::row(vec![
            Widget::text("header").height_px(24.0).grow(1.0),
            Widget::button("Action").on_click(|| {}).height_px(40.0),
        ])
        .padding_all(20.0)
        .gap(12.0);
        let mut ui = ui_with(widget);
        ui.clear_damage();
        let rebuilds = ui.layout_rebuilds();
        let center = ui.tree().expect("tree").root.children[1].rect.center();
        ui.handle_event(UiEvent::PointerMove(center));
        let _ = ui.layout();
        assert_eq!(ui.layout_rebuilds(), rebuilds);
        assert!(!ui.damage().is_empty());
        match &ui.tree().expect("tree").root.children[1].paint {
            PaintData::Button { hovered, .. } => assert!(hovered),
            other => panic!("unexpected paint: {other:?}"),
        }
        ui.clear_damage();
        ui.handle_event(UiEvent::PointerDown(center));
        let _ = ui.layout();
        assert_eq!(ui.layout_rebuilds(), rebuilds);
        match &ui.tree().expect("tree").root.children[1].paint {
            PaintData::Button { pressed, .. } => assert!(pressed),
            other => panic!("unexpected paint: {other:?}"),
        }
        ui.handle_event(UiEvent::PointerUp(center));
        let _ = ui.layout();
    }

    #[test]
    fn hover_transition_damages_old_and_new_regions() {
        let widget = Widget::row(vec![
            Widget::button("One").on_click(|| {}).height_px(40.0),
            Widget::button("Two").on_click(|| {}).height_px(40.0),
        ])
        .gap(20.0)
        .padding_all(20.0);
        let mut ui = ui_with(widget);
        let rebuilds = ui.layout_rebuilds();
        let first = ui.tree().expect("tree").root.children[0].rect;
        let second = ui.tree().expect("tree").root.children[1].rect;
        ui.clear_damage();
        ui.handle_event(UiEvent::PointerMove(first.center()));
        let _ = ui.layout();
        assert_eq!(ui.layout_rebuilds(), rebuilds);
        assert!(!ui.damage().full);
        assert!(ui.damage().rect.expect("first").intersect(&first).width > 0.0);
        ui.handle_event(UiEvent::PointerMove(second.center()));
        let _ = ui.layout();
        let damage = ui.damage().rect.expect("transition damage");
        assert!(damage.intersect(&first).width > 0.0);
        assert!(damage.intersect(&second).width > 0.0);
        ui.clear_damage();
        ui.handle_event(UiEvent::PointerLeave);
        let _ = ui.layout();
        assert!(!ui.damage().is_empty());
        assert_eq!(ui.state().cursor, CursorShape::Default);
    }

    #[test]
    fn disabled_controls_do_not_react_to_hover() {
        let widget = Widget::button("Disabled").enabled(false).height_px(40.0);
        let mut ui = ui_with(widget);
        ui.clear_damage();
        let center = ui.tree().expect("tree").root.rect.center();
        ui.handle_event(UiEvent::PointerMove(center));
        let _ = ui.layout();
        assert!(ui.damage().is_empty());
        assert_eq!(ui.state().cursor, CursorShape::Default);
        assert!(ui.state().hover.is_none());
    }

    #[test]
    fn text_field_sets_text_cursor() {
        let field = Field::<String>::new("name", "Name");
        let widget = Widget::text_field(&field, "Name").height_px(80.0);
        let mut ui = ui_with(widget);
        let center = ui.tree().expect("tree").root.rect.center();
        ui.handle_event(UiEvent::PointerMove(center));
        assert_eq!(ui.state().cursor, CursorShape::Text);
    }

    #[test]
    fn idle_does_not_produce_damage_or_rebuild_layout() {
        struct Vm {
            value: Signal<String>,
        }
        impl ViewModel for Vm {
            fn view(&self) -> Widget {
                Widget::column(vec![Widget::text(format!("v={}", self.value.get()))])
            }
        }
        let vm = Vm {
            value: Signal::new("a".to_string()),
        };
        let signal = vm.value;
        let mut ui = Ui::new(theme());
        ui.resize(Size::new(400.0, 300.0));
        ui.set_view(crate::view::View::new(vm));
        let _ = ui.layout();
        assert!(ui.damage().full);
        ui.clear_damage();
        let rebuilds = ui.layout_rebuilds();
        let _ = ui.layout();
        assert!(ui.damage().is_empty());
        assert_eq!(ui.layout_rebuilds(), rebuilds);
        assert!(!ui.needs_frame());
        signal.set("b".to_string());
        let _ = ui.layout();
        assert!(!ui.damage().is_empty());
        assert!(ui.needs_frame());
        ui.clear_damage();
        let _ = ui.layout();
        assert!(ui.damage().is_empty());
        assert!(!ui.needs_frame());
    }

    #[test]
    fn text_change_damages_only_field_region() {
        let field = Field::<String>::with_value("name", "Name", "a".to_string());
        let value = field.value;
        let widget = Widget::column(vec![
            Widget::text("header").height_px(30.0),
            Widget::text_field(&field, "Name").height_px(80.0),
            Widget::text("footer").height_px(30.0),
        ])
        .padding_all(20.0)
        .gap(20.0);
        let mut ui = ui_with(widget);
        ui.clear_damage();
        value.set("abcdef".to_string());
        let _ = ui.layout();
        let damage = ui.damage();
        assert!(!damage.full);
        let rect = damage.rect.expect("partial damage");
        assert!(rect.width < 400.0);
        assert!(rect.height < 600.0);
        let tree = ui.tree().expect("tree");
        let field_node = tree.root.children[1].rect;
        assert!(rect.intersect(&field_node).width > 0.0);
    }

    #[test]
    fn damage_from_two_fields_is_united() {
        let first = Field::<String>::with_value("a", "A", "1".to_string());
        let second = Field::<String>::with_value("b", "B", "2".to_string());
        let widget = Widget::column(vec![
            Widget::text_field(&first, "A").height_px(80.0),
            Widget::text("spacer").height_px(20.0),
            Widget::text_field(&second, "B").height_px(80.0),
        ])
        .gap(20.0)
        .padding_all(20.0);
        let mut ui = ui_with(widget);
        let first_rect = ui.tree().expect("tree").root.children[0].rect;
        let second_rect = ui.tree().expect("tree").root.children[2].rect;
        ui.clear_damage();
        crate::signal::batch(|| {
            first.value.set("changed".to_string());
            second.value.set("changed".to_string());
        });
        let _ = ui.layout();
        let damage = ui.damage();
        assert!(!damage.full);
        let rect = damage.rect.expect("damage");
        assert!(rect.y <= first_rect.y + 2.0);
        assert!(rect.bottom() >= second_rect.bottom() - 2.0);
    }

    #[test]
    fn pressed_state_damages_button_and_renders_state() {
        let widget = Widget::button("Go").on_click(|| {}).height_px(40.0);
        let mut ui = ui_with(widget);
        let center = ui.tree().expect("tree").root.rect.center();
        ui.clear_damage();
        ui.handle_event(UiEvent::PointerDown(center));
        let _ = ui.layout();
        assert!(!ui.damage().is_empty());
        match &ui.tree().expect("tree").root.paint {
            PaintData::Button { pressed, .. } => assert!(pressed),
            other => panic!("unexpected paint: {other:?}"),
        }
        ui.handle_event(UiEvent::PointerUp(center));
        let _ = ui.layout();
    }

    #[test]
    fn wheel_invalidates_full_viewport() {
        let widget = Widget::column(vec![Widget::text("x")]);
        let mut ui = ui_with(widget);
        ui.clear_damage();
        ui.handle_event(UiEvent::Wheel { delta: 40.0 });
        assert!(ui.damage().full);
    }

    #[test]
    fn hover_sets_pointer_cursor() {
        let widget = Widget::button("Go").on_click(|| {}).height_px(40.0);
        let mut ui = ui_with(widget);
        let center = ui.tree().expect("tree").root.rect.center();
        assert!(ui.handle_event(UiEvent::PointerMove(center)));
        assert_eq!(ui.state().cursor, CursorShape::Pointer);
        assert!(ui.handle_event(UiEvent::PointerLeave));
        assert_eq!(ui.state().cursor, CursorShape::Default);
    }

    #[test]
    fn escape_blurs_field() {
        let field = Field::<String>::new("a", "A");
        let widget = Widget::text_field(&field, "A").height_px(80.0);
        let mut ui = ui_with(widget);
        let center = ui.tree().expect("tree").root.rect.center();
        click(&mut ui, center);
        assert!(ui.state().focus.is_some());
        ui.handle_event(UiEvent::Key {
            key: Key::Escape,
            modifiers: Modifiers::default(),
            pressed: true,
        });
        assert!(ui.state().focus.is_none());
    }

    #[test]
    fn view_signal_change_relayouts() {
        struct Vm {
            value: Signal<String>,
        }
        impl ViewModel for Vm {
            fn view(&self) -> Widget {
                Widget::row(vec![Widget::heading(
                    format!("Value {}", self.value.get()),
                    2,
                )])
                .align(crate::geometry::Align::Center)
            }
        }
        let vm = Vm {
            value: Signal::new("one".to_string()),
        };
        let value = vm.value;
        let mut ui = Ui::new(theme());
        ui.resize(Size::new(300.0, 200.0));
        ui.set_view(crate::view::View::new(vm));
        let _ = ui.layout();
        let first_width = ui.tree().expect("tree").root.children[0].rect.width;
        value.set("a much longer value".to_string());
        let _ = ui.layout();
        let second_width = ui.tree().expect("tree").root.children[0].rect.width;
        assert!(second_width > first_width);
    }
}
