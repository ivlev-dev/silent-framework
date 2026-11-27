use std::path::PathBuf;

use ui_core::form::Field;
use ui_core::geometry::Size;
use ui_core::layout::{layout, LayoutOptions};
use ui_core::theme::Theme;
use ui_core::widget::Widget;
use ui_render::HeadlessRenderer;

fn screen() -> (Widget, Theme) {
    let email =
        Field::<String>::with_value("email", "Email", "demo@silent.dev".to_string()).required();
    let password = Field::<String>::with_value("password", "Пароль", "secret123".to_string())
        .required()
        .min_length(8);
    let remember = Field::<bool>::with_value("remember", "Запомнить", true);
    let widget = Widget::column(vec![
        Widget::heading("Вход", 2),
        Widget::text_field(&email, "Email"),
        Widget::text_field(&password, "Пароль").password(),
        Widget::checkbox(&remember, "Запомнить"),
        Widget::button("Войти").icon(ui_core::widget::IconName::ArrowRight),
        Widget::form_progress(1.0),
    ])
    .gap(14.0)
    .padding_all(32.0)
    .width_px(420.0);
    let theme = Theme::light();
    (widget, theme)
}

#[test]
fn headless_render_produces_expected_pixels() {
    let (widget, theme) = screen();
    let width = 640;
    let height = 520;
    let tree = layout(
        &widget,
        Size::new(width as f32, height as f32),
        &theme,
        &LayoutOptions::empty(),
    );
    let mut renderer = match HeadlessRenderer::new(width, height) {
        Ok(renderer) => renderer,
        Err(error) => {
            eprintln!("skipping headless render test: {error}");
            return;
        }
    };
    let pixels = renderer.render(&tree, &theme, 1.0).expect("render");
    assert_eq!(pixels.len(), (width * height * 4) as usize);
    let corner = &pixels[0..4];
    let background = theme.palette.background.to_rgba8();
    assert!((corner[0] as i32 - background[0] as i32).abs() <= 2);
    assert!((corner[1] as i32 - background[1] as i32).abs() <= 2);
    assert!((corner[2] as i32 - background[2] as i32).abs() <= 2);
    let changed = pixels
        .as_chunks::<4>()
        .0
        .iter()
        .filter(|pixel| {
            (pixel[0] as i32 - background[0] as i32).abs() > 8
                || (pixel[1] as i32 - background[1] as i32).abs() > 8
                || (pixel[2] as i32 - background[2] as i32).abs() > 8
        })
        .count();
    assert!(changed > 2000, "only {changed} non-background pixels");
    let primary = theme.palette.primary.to_rgba8();
    let accent = pixels.as_chunks::<4>().0.iter().any(|pixel| {
        (pixel[0] as i32 - primary[0] as i32).abs() < 12
            && (pixel[1] as i32 - primary[1] as i32).abs() < 12
            && (pixel[2] as i32 - primary[2] as i32).abs() < 12
    });
    assert!(accent, "primary color is missing from the frame");
    let path = PathBuf::from("/tmp/ui-rust-headless-test.png");
    renderer
        .save_png(&tree, &theme, 1.0, &path)
        .expect("save png");
    let metadata = std::fs::metadata(&path).expect("png exists");
    assert!(metadata.len() > 1024, "png is too small");
}

#[test]
fn headless_dark_theme_uses_dark_background() {
    let (widget, _) = screen();
    let theme = Theme::dark();
    let tree = layout(
        &widget,
        Size::new(400.0, 480.0),
        &theme,
        &LayoutOptions::empty(),
    );
    let mut renderer = match HeadlessRenderer::new(400, 480) {
        Ok(renderer) => renderer,
        Err(error) => {
            eprintln!("skipping headless render test: {error}");
            return;
        }
    };
    let pixels = renderer.render(&tree, &theme, 1.0).expect("render");
    let corner = &pixels[0..4];
    let background = theme.palette.background.to_rgba8();
    assert!((corner[0] as i32 - background[0] as i32).abs() <= 2);
    assert!((corner[1] as i32 - background[1] as i32).abs() <= 2);
    assert!((corner[2] as i32 - background[2] as i32).abs() <= 2);
}

#[test]
fn headless_render_is_stable_between_frames() {
    let (widget, theme) = screen();
    let tree = layout(
        &widget,
        Size::new(320.0, 400.0),
        &theme,
        &LayoutOptions::empty(),
    );
    let mut renderer = match HeadlessRenderer::new(320, 400) {
        Ok(renderer) => renderer,
        Err(error) => {
            eprintln!("skipping headless render test: {error}");
            return;
        }
    };
    let first = renderer.render(&tree, &theme, 1.0).expect("first");
    let second = renderer.render(&tree, &theme, 1.0).expect("second");
    assert_eq!(first.len(), second.len());
    let differing = first
        .iter()
        .zip(second.iter())
        .filter(|(a, b)| a != b)
        .count();
    assert!(
        differing * 100 < first.len(),
        "frames differ in {differing} bytes"
    );
}
