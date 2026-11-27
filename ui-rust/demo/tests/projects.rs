use ui_core::geometry::Size;
use ui_core::layout::{LayoutNode, PaintData};
use ui_core::ui::{Ui, UiEvent};
use ui_core::view::View;
use ui_demo::{DashboardVm, User};

fn projects_ui(width: f32, height: f32) -> Ui {
    let vm = DashboardVm::new(User::demo(), false);
    vm.tab.set(1);
    vm.page_scroll.set(0.0);
    vm.load_projects_blocking();
    let mut ui = Ui::new(ui_core::Theme::light());
    ui.resize(Size::new(width, height));
    ui.set_view(View::new(vm));
    let _ = ui.layout();
    ui
}

fn find_table(node: &LayoutNode) -> Option<&LayoutNode> {
    if matches!(node.paint, PaintData::DataTable { .. }) {
        return Some(node);
    }
    node.children.iter().find_map(find_table)
}

#[test]
fn projects_page_uses_live_silent_protocol_data() {
    let ui = projects_ui(1440.0, 900.0);
    let table = find_table(&ui.tree().expect("tree").root).expect("table");
    match &table.paint {
        PaintData::DataTable {
            rows,
            pages,
            total_rows,
            display_total,
            display_range,
            ..
        } => {
            assert_eq!(*total_rows, 10);
            assert_eq!(*pages, 24);
            assert!(rows.len() <= 10);
            let total = display_total.expect("server total");
            assert_eq!(total, 240);
            assert_eq!(*display_range, Some((1, 10, total)));
        }
        _ => unreachable!(),
    }
}

#[test]
fn projects_page_switches_to_cards_below_xxl() {
    let ui = projects_ui(840.0, 900.0);
    assert!(find_table(&ui.tree().expect("tree").root).is_none());
    let mut cards = 0;
    fn walk(node: &LayoutNode, cards: &mut usize) {
        if node.role == ui_core::Role::Card {
            *cards += 1;
        }
        for child in &node.children {
            walk(child, cards);
        }
    }
    walk(&ui.tree().expect("tree").root, &mut cards);
    assert!(cards >= 4, "project cards: {cards}");
}

#[test]
fn projects_pagination_and_sort_are_clickable() {
    let theme = ui_core::Theme::light();
    let vm = DashboardVm::new(User::demo(), false);
    vm.tab.set(1);
    vm.load_projects_blocking();
    let mut ui = Ui::new(theme);
    ui.resize(Size::new(1440.0, 900.0));
    ui.set_view(View::new(vm));
    let _ = ui.layout();
    let rect = find_table(&ui.tree().expect("tree").root)
        .expect("table")
        .rect;

    let slots = ui_core::layout::pagination_slots(0, 24);
    let button = 28.0;
    let gap = 4.0;
    let total_width = slots.len() as f32 * button + slots.len().saturating_sub(1) as f32 * gap;
    let start = rect.right() - 16.0 - total_width;
    let page_x = start + button + gap + button / 2.0;
    let page_y = rect.bottom() - 24.0;
    ui.handle_event(UiEvent::PointerDown(ui_core::Point::new(page_x, page_y)));
    let _ = ui.layout();
    match &find_table(&ui.tree().expect("tree").root)
        .expect("table")
        .paint
    {
        PaintData::DataTable { page, .. } => assert_eq!(*page, 1),
        _ => unreachable!(),
    }

    let header_y = rect.y + 24.0;
    let widths = [240.0, 180.0, 130.0, 220.0, 110.0, 130.0];
    let total: f32 = widths.iter().sum();
    let budget_x =
        rect.x + rect.width * (widths[..4].iter().sum::<f32>() + widths[4] / 2.0) / total;
    ui.handle_event(UiEvent::PointerDown(ui_core::Point::new(
        budget_x, header_y,
    )));
    ui.handle_event(UiEvent::PointerUp(ui_core::Point::new(budget_x, header_y)));
    let _ = ui.layout();
    match &find_table(&ui.tree().expect("tree").root)
        .expect("table")
        .paint
    {
        PaintData::DataTable {
            sort,
            sort_ascending,
            page,
            ..
        } => {
            assert_eq!(*sort, Some(4));
            assert!(*sort_ascending);
            assert_eq!(*page, 0);
        }
        _ => unreachable!(),
    }
}

#[test]
fn projects_cards_fit_mobile_width() {
    for width in [390.0, 840.0, 1440.0, 1920.0] {
        let ui = projects_ui(width, 900.0);
        fn check(node: &LayoutNode, width: f32) {
            if node.rect.width > 0.5 {
                assert!(node.rect.x >= -1.0);
                assert!(
                    node.rect.right() <= width + 1.0,
                    "overflow at {width}: {:?}",
                    node.rect
                );
            }
            for child in &node.children {
                check(child, width);
            }
        }
        check(&ui.tree().expect("tree").root, width);
    }
}
