use std::rc::Rc;

use ui_core::geometry::Size;
use ui_core::layout::{DataTableDragMode, PaintData};
use ui_core::signal::Signal;
use ui_core::view_model::ViewModel;
use ui_core::widget::{DataColumn, DataTableState};
use ui_core::{Align, Ui, UiEvent, View, Widget};

struct TableVm {
    rows: Rc<Vec<Vec<String>>>,
    order: Signal<Vec<usize>>,
    widths: Signal<Vec<f32>>,
    compact: Signal<bool>,
    selected: Signal<Vec<usize>>,
    sort: Signal<Option<usize>>,
    sort_ascending: Signal<bool>,
    page: Signal<usize>,
    scroll: Signal<f32>,
}

impl TableVm {
    fn new() -> Self {
        let rows = (0..10_000)
            .map(|index| {
                vec![
                    format!("Проект {}", index + 1),
                    "Ада".to_string(),
                    "Активен".to_string(),
                    "₽1.0M".to_string(),
                ]
            })
            .collect();
        Self {
            rows: Rc::new(rows),
            order: Signal::new(vec![0, 1, 2, 3]),
            widths: Signal::new(vec![300.0, 200.0, 160.0, 140.0]),
            compact: Signal::new(false),
            selected: Signal::new(Vec::new()),
            sort: Signal::new(Some(0)),
            sort_ascending: Signal::new(true),
            page: Signal::new(0),
            scroll: Signal::new(0.0),
        }
    }

    fn state(&self) -> DataTableState {
        DataTableState {
            order: self.order,
            widths: self.widths,
            compact: self.compact,
            selected: self.selected,
            sort: self.sort,
            sort_ascending: self.sort_ascending,
            page: self.page,
            pages: 4,
            scroll: self.scroll,
        }
    }
}

impl ViewModel for TableVm {
    fn view(&self) -> Widget {
        Widget::column(vec![Widget::data_table(
            vec![
                DataColumn {
                    title: "Проект".into(),
                    width: 300.0,
                    align: Align::Start,
                    tag: None,
                },
                DataColumn {
                    title: "Владелец".into(),
                    width: 200.0,
                    align: Align::Start,
                    tag: None,
                },
                DataColumn {
                    title: "Статус".into(),
                    width: 160.0,
                    align: Align::Start,
                    tag: None,
                },
                DataColumn {
                    title: "Бюджет".into(),
                    width: 140.0,
                    align: Align::End,
                    tag: None,
                },
            ],
            self.rows.clone(),
            self.state(),
            Some(320.0),
        )])
        .padding_all(20.0)
    }
}

fn table_node(ui: &Ui) -> ui_core::layout::LayoutNode {
    fn find(node: &ui_core::layout::LayoutNode) -> Option<ui_core::layout::LayoutNode> {
        if matches!(node.paint, PaintData::DataTable { .. }) {
            return Some(node.clone());
        }
        for child in &node.children {
            if let Some(found) = find(child) {
                return Some(found);
            }
        }
        None
    }
    find(&ui.tree().expect("tree").root).expect("data table")
}

fn table_paint(ui: &Ui) -> (usize, Option<usize>, bool) {
    match &table_node(ui).paint {
        PaintData::DataTable {
            rows,
            total_rows,
            compact,
            ..
        } => (rows.len(), Some(*total_rows), *compact),
        _ => (0, None, false),
    }
}

#[test]
fn ten_thousand_rows_are_virtualized() {
    let vm = TableVm::new();
    let mut ui = Ui::new(ui_core::Theme::light());
    ui.resize(Size::new(900.0, 500.0));
    ui.set_view(View::new(vm));
    let _ = ui.layout();
    let (visible, total, _) = table_paint(&ui);
    assert!(visible <= 10, "visible rows: {visible}");
    assert_eq!(total, Some(10_000));
}

#[test]
fn wheel_scrolls_virtualized_table_and_damages_viewport() {
    let vm = TableVm::new();
    let scroll = vm.scroll;
    let mut ui = Ui::new(ui_core::Theme::light());
    ui.resize(Size::new(900.0, 500.0));
    ui.set_view(View::new(vm));
    let _ = ui.layout();
    let rect = table_node(&ui).rect;
    ui.handle_event(UiEvent::PointerMove(ui_core::Point::new(
        rect.center().x,
        rect.y + 120.0,
    )));
    ui.clear_damage();
    ui.handle_event(UiEvent::Wheel { delta: 500.0 });
    assert!(!ui.damage().is_empty(), "scroll must damage the viewport");
    assert!(
        !ui.damage().full,
        "table scroll is a partial viewport damage"
    );
    for _ in 0..12 {
        ui.frame();
        let _ = ui.layout();
    }
    assert!(scroll.peek() > 0.0);
    ui.clear_damage();
    assert!(!ui.needs_frame(), "scroll animation stops");
    let first_visible = match &table_node(&ui).paint {
        PaintData::DataTable { rows, .. } => rows.first().map(|(index, _)| *index),
        _ => None,
    };
    assert!(first_visible.unwrap_or(0) > 0);
}

#[test]
fn headers_support_reorder_and_resize() {
    let vm = TableVm::new();
    let order = vm.order;
    let widths = vm.widths;
    let mut ui = Ui::new(ui_core::Theme::light());
    ui.resize(Size::new(900.0, 500.0));
    ui.set_view(View::new(vm));
    let _ = ui.layout();
    let rect = table_node(&ui).rect;
    let header_y = rect.y + 20.0;
    let original = order.peek();
    ui.handle_event(UiEvent::PointerMove(ui_core::Point::new(
        rect.x + 40.0,
        header_y,
    )));
    ui.handle_event(UiEvent::PointerDown(ui_core::Point::new(
        rect.x + 40.0,
        header_y,
    )));
    let target_x = rect.x + rect.width * 0.8;
    ui.handle_event(UiEvent::PointerMove(ui_core::Point::new(
        target_x, header_y,
    )));
    ui.handle_event(UiEvent::PointerUp(ui_core::Point::new(target_x, header_y)));
    assert_ne!(order.peek(), original, "column order must change");

    order.set(vec![0, 1, 2, 3]);
    let _ = ui.layout();
    let before = widths.peek()[0];
    let first_right = rect.x + rect.width * (300.0 / 800.0);
    let grab_x = first_right - 2.0;
    ui.handle_event(UiEvent::PointerMove(ui_core::Point::new(grab_x, header_y)));
    assert_eq!(ui.state().cursor, ui_core::CursorShape::ResizeHorizontal);
    ui.handle_event(UiEvent::PointerDown(ui_core::Point::new(grab_x, header_y)));
    ui.handle_event(UiEvent::PointerMove(ui_core::Point::new(
        grab_x + 48.0,
        header_y,
    )));
    ui.handle_event(UiEvent::PointerUp(ui_core::Point::new(
        grab_x + 48.0,
        header_y,
    )));
    assert!(widths.peek()[0] > before, "column width must grow");
    assert!(ui.state().table_drag.is_none());
}

#[test]
fn clicking_a_row_updates_selection() {
    let vm = TableVm::new();
    let selected = vm.selected;
    let mut ui = Ui::new(ui_core::Theme::light());
    ui.resize(Size::new(900.0, 500.0));
    ui.set_view(View::new(vm));
    let _ = ui.layout();
    let rect = table_node(&ui).rect;
    let header = ui_core::Theme::light().sizes.table_header_height;
    let point = ui_core::Point::new(rect.x + 30.0, rect.y + header + 12.0);
    ui.handle_event(UiEvent::PointerMove(point));
    ui.handle_event(UiEvent::PointerDown(point));
    ui.handle_event(UiEvent::PointerUp(point));
    assert!(!selected.peek().is_empty());
}

#[test]
fn density_signal_changes_visible_row_height() {
    let vm = TableVm::new();
    let compact = vm.compact;
    let mut ui = Ui::new(ui_core::Theme::light());
    ui.resize(Size::new(900.0, 500.0));
    ui.set_view(View::new(vm));
    let _ = ui.layout();
    let (_, _, first) = table_paint(&ui);
    compact.set(true);
    let _ = ui.layout();
    let (_, _, second) = table_paint(&ui);
    assert!(!first);
    assert!(second);
}

#[test]
fn table_hover_patches_without_layout_rebuild() {
    let vm = TableVm::new();
    let mut ui = Ui::new(ui_core::Theme::light());
    ui.resize(Size::new(900.0, 500.0));
    ui.set_view(View::new(vm));
    let _ = ui.layout();
    ui.clear_damage();
    let rebuilds = ui.layout_rebuilds();
    let rect = table_node(&ui).rect;
    ui.handle_event(UiEvent::PointerMove(ui_core::Point::new(
        rect.x + 30.0,
        rect.y + 20.0,
    )));
    let _ = ui.layout();
    assert_eq!(ui.layout_rebuilds(), rebuilds);
    assert!(ui.state().table_drag.is_none());
    assert_eq!(ui.state().cursor, ui_core::CursorShape::Grab);
    let _ = DataTableDragMode::Reorder;
}
