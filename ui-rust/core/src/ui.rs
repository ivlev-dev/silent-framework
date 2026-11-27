use std::collections::HashMap;

use crate::clipboard::{Clipboard, MemoryClipboard};
use crate::geometry::{Point, Size};
use crate::layout::{
    layout, CursorShape, EditBinding, LayoutOptions, LayoutTree, NodeId, PaintData,
};
use crate::signal::revision;
use crate::theme::Theme;
use crate::view::ViewSource;
use crate::widget::Widget;

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
}

impl UiState {
    pub fn is_focused(&self, id: NodeId) -> bool {
        self.focus == Some(id)
    }
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
    clipboard: Box<dyn Clipboard>,
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
            clipboard: Box::new(MemoryClipboard::new()),
        }
    }

    pub fn set_source(&mut self, source: Box<dyn ViewSource>) {
        if let Some(previous) = self.source.take() {
            previous.dispose();
        }
        self.source = Some(source);
        self.dirty = true;
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
        }
    }

    pub fn viewport(&self) -> Size {
        self.viewport
    }

    pub fn frame(&mut self) {
        if let Some(source) = &self.source {
            source.on_frame();
        }
    }

    pub fn layout(&mut self) -> &LayoutTree {
        let current_revision = revision();
        let needs_layout = self.tree.is_none()
            || self.dirty
            || self.viewport != self.last_viewport
            || current_revision != self.last_revision;
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
                carets: &carets,
                selections: &selections,
            };
            let tree = layout(&widget, self.viewport, &self.theme, &options);
            if let Some(focus) = self.state.focus {
                if !tree.focusables().contains(&focus) {
                    self.state.focus = None;
                }
            }
            self.tree = Some(tree);
            self.last_viewport = self.viewport;
            self.last_revision = current_revision;
            self.dirty = false;
        }
        self.tree.as_ref().expect("layout is initialized")
    }

    pub fn tree(&self) -> Option<&LayoutTree> {
        self.tree.as_ref()
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
                let changed = self.state.hover.is_some();
                self.state.hover = None;
                self.state.cursor = CursorShape::Default;
                self.state.pointer = Point::new(-1.0, -1.0);
                if changed {
                    self.dirty = true;
                }
                changed
            }
            UiEvent::Wheel { delta } => {
                self.state.scroll += delta;
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

    fn pointer_move(&mut self, point: Point) -> bool {
        self.state.pointer = point;
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
        if changed {
            self.dirty = true;
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
        if focusable {
            self.focus(id);
        } else {
            self.blur();
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
                if modifiers.command() {
                    false
                } else {
                    self.blur();
                    true
                }
            }
            Key::Enter => self.activate_focused(),
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
            Key::Home => self.edit_home(modifiers.shift),
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
        self.dirty = true;
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
        self.dirty = true;
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
        self.dirty = true;
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
        self.dirty = true;
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
        self.dirty = true;
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
