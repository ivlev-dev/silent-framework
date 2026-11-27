use std::path::PathBuf;

use ui_core::layout::{LayoutNode, PaintData};
use ui_core::theme::{Theme, ThemeMode};
use ui_core::ui::{Ui, UiEvent};
use ui_core::view::View;
use ui_core::Size;
use ui_demo::{DashboardVm, GalleryVm, User};
use ui_render::headless::write_png;
use ui_render::HeadlessRenderer;

fn dashboard(width: u32, height: u32, mode: ThemeMode) -> (Ui, HeadlessRenderer) {
    let theme = Theme::from_mode(mode);
    let vm = DashboardVm::new(User::demo(), mode == ThemeMode::Dark);
    let mut ui = Ui::new(theme);
    ui.resize(Size::new(width as f32, height as f32));
    ui.set_view(View::new(vm));
    let _ = ui.layout();
    let mut renderer = HeadlessRenderer::new(width, height).expect("renderer");
    let _ = renderer.render_damage(ui.tree().expect("tree"), ui.theme(), 1.0, ui.damage());
    ui.clear_damage();
    (ui, renderer)
}

fn gallery_data(width: u32, height: u32) -> (Ui, HeadlessRenderer) {
    let theme = Theme::dark();
    let vm = GalleryVm::new(true);
    vm.section.set(3);
    let mut ui = Ui::new(theme.clone());
    ui.resize(Size::new(width as f32, height as f32));
    ui.set_view(View::new(vm));
    let _ = ui.layout();
    let mut renderer = HeadlessRenderer::new(width, height).expect("renderer");
    let _ = renderer.render_damage(ui.tree().expect("tree"), &theme, 1.0, ui.damage());
    ui.clear_damage();
    (ui, renderer)
}

fn find(node: &LayoutNode, predicate: &dyn Fn(&LayoutNode) -> bool) -> Option<LayoutNode> {
    if predicate(node) {
        return Some(node.clone());
    }
    for child in &node.children {
        if let Some(found) = find(child, predicate) {
            return Some(found);
        }
    }
    None
}

fn capture(mut ui: Ui, mut renderer: HeadlessRenderer, name: &str, point: ui_core::Point) {
    ui.handle_event(UiEvent::PointerMove(point));
    let _ = ui.layout();
    let damage = ui.damage();
    assert!(!damage.is_empty(), "hover should damage {name}");
    let (width, height) = renderer.size();
    let pixels = renderer
        .render_damage(ui.tree().expect("tree"), ui.theme(), 1.0, damage)
        .expect("hover frame");
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../screenshots");
    std::fs::create_dir_all(&dir).expect("screenshots dir");
    write_png(&dir.join(format!("{name}.png")), width, height, &pixels).expect("write hover png");
}

#[test]
fn hover_screenshots_for_button_row_and_nav() {
    let (ui, _renderer) = dashboard(1440, 900, ThemeMode::Dark);
    let tree = ui.tree().expect("tree");
    let button = find(
        &tree.root,
        &|node| matches!(&node.paint, PaintData::Button { label, .. } if label == "Выйти"),
    )
    .expect("logout button");
    let nav_item =
        find(&tree.root, &|node| node.label.as_deref() == Some("Проекты")).expect("nav item");
    let button_point = button.rect.center();
    let nav_point = nav_item.rect.center();
    let (ui, renderer) = dashboard(1440, 900, ThemeMode::Dark);
    capture(ui, renderer, "hover-button-1440-dark", button_point);
    let (ui, renderer) = dashboard(1440, 900, ThemeMode::Dark);
    capture(ui, renderer, "hover-nav-1440-dark", nav_point);

    let (ui, renderer) = gallery_data(1440, 900);
    let tree = ui.tree().expect("tree");
    let table = find(&tree.root, &|node| {
        matches!(node.paint, PaintData::DataTable { .. })
    })
    .expect("data table");
    let row_point = ui_core::Point::new(
        table.rect.center().x,
        table.rect.y + ui.theme().sizes.table_header_height + 24.0,
    );
    capture(ui, renderer, "hover-row-1440-dark", row_point);
}
