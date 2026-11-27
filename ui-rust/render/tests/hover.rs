use ui_core::geometry::Size;
use ui_core::theme::Theme;
use ui_core::{Ui, UiEvent, Widget};
use ui_render::HeadlessRenderer;

#[test]
fn hover_changes_only_the_widget_pixels_and_leave_restores() {
    let theme = Theme::light();
    let widget = Widget::row(vec![
        Widget::text("label").grow(1.0),
        Widget::button("Hover me").on_click(|| {}).height_px(40.0),
    ])
    .padding_all(24.0)
    .gap(16.0);
    let mut ui = Ui::new(theme.clone());
    ui.resize(Size::new(360.0, 160.0));
    ui.set_source(Box::new(StaticSource { widget }));
    let _ = ui.layout();
    let mut renderer = HeadlessRenderer::new(360, 160).expect("renderer");
    let normal = renderer
        .render_damage(ui.tree().expect("tree"), &theme, 1.0, ui.damage())
        .expect("normal");
    ui.clear_damage();
    let button = ui.tree().expect("tree").root.children[1].rect;
    ui.handle_event(UiEvent::PointerMove(button.center()));
    let _ = ui.layout();
    assert!(!ui.damage().is_empty());
    let hovered = renderer
        .render_damage(ui.tree().expect("tree"), &theme, 1.0, ui.damage())
        .expect("hover");
    let mut inside_changed = 0usize;
    let mut outside_changed = 0usize;
    for y in 0..160u32 {
        for x in 0..360u32 {
            let index = ((y * 360 + x) * 4) as usize;
            if normal[index..index + 4] != hovered[index..index + 4] {
                let point = ui_core::Point::new(x as f32, y as f32);
                if button.contains(point) {
                    inside_changed += 1;
                } else {
                    outside_changed += 1;
                }
            }
        }
    }
    assert!(inside_changed > 50, "hover must repaint the button");
    assert!(
        outside_changed < 64,
        "hover repainted {outside_changed} outside pixels"
    );
    ui.clear_damage();
    ui.handle_event(UiEvent::PointerLeave);
    let _ = ui.layout();
    let restored = renderer
        .render_damage(ui.tree().expect("tree"), &theme, 1.0, ui.damage())
        .expect("leave");
    assert_eq!(normal, restored);
}

struct StaticSource {
    widget: Widget,
}

impl ui_core::ViewSource for StaticSource {
    fn widget(&self) -> Widget {
        self.widget.clone()
    }

    fn on_frame(&self) {}

    fn dispose(&self) {}
}
