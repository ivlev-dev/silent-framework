use ui_core::geometry::Size;
use ui_core::layout::{layout, LayoutNode, LayoutOptions, PaintData};
use ui_core::signal::Signal;
use ui_core::theme::{Theme, ThemeMode};
use ui_core::widget::{ButtonVariant, Widget};
use ui_render::HeadlessRenderer;

struct Frame {
    pixels: Vec<u8>,
    width: u32,
    theme: Theme,
}

fn render(widget: &Widget, width: u32, height: u32, mode: ThemeMode) -> Frame {
    let theme = Theme::from_mode(mode);
    let tree = layout(
        widget,
        Size::new(width as f32, height as f32),
        &theme,
        &LayoutOptions::empty(),
    );
    let mut renderer = HeadlessRenderer::new(width, height).expect("renderer");
    let pixels = renderer.render(&tree, &theme, 1.0).expect("render");
    Frame {
        pixels,
        width,
        theme,
    }
}

fn pixel(frame: &Frame, x: f32, y: f32) -> [u8; 4] {
    let index = ((y as u32 * frame.width + x as u32) * 4) as usize;
    [
        frame.pixels[index],
        frame.pixels[index + 1],
        frame.pixels[index + 2],
        frame.pixels[index + 3],
    ]
}

fn close(a: [u8; 4], color: ui_core::Color) -> bool {
    let b = color.to_rgba8();
    (a[0] as i32 - b[0] as i32).abs() <= 4
        && (a[1] as i32 - b[1] as i32).abs() <= 4
        && (a[2] as i32 - b[2] as i32).abs() <= 4
}

fn find<'a>(
    node: &'a LayoutNode,
    predicate: &dyn Fn(&LayoutNode) -> bool,
) -> Option<&'a LayoutNode> {
    if predicate(node) {
        return Some(node);
    }
    for child in &node.children {
        if let Some(found) = find(child, predicate) {
            return Some(found);
        }
    }
    None
}

#[test]
fn card_corners_have_no_square_artifacts() {
    for mode in [ThemeMode::Light, ThemeMode::Dark] {
        let widget = Widget::column(vec![Widget::card(vec![Widget::text("Card body")])
            .width_px(300.0)
            .height_px(180.0)])
        .padding_all(50.0);
        let theme = Theme::from_mode(mode);
        let tree = layout(
            &widget,
            Size::new(460.0, 320.0),
            &theme,
            &LayoutOptions::empty(),
        );
        let mut renderer = HeadlessRenderer::new(460, 320).expect("renderer");
        let pixels = renderer.render(&tree, &theme, 1.0).expect("render");
        let frame = Frame {
            pixels,
            width: 460,
            theme: theme.clone(),
        };
        let card = find(&tree.root, &|node| node.role == ui_core::Role::Card).expect("card");
        let rect = card.rect;
        let fill = theme.card_surface();
        let border = theme.palette.outline_variant;
        for (x, y) in [
            (rect.x + 2.0, rect.y + 2.0),
            (rect.right() - 2.0, rect.y + 2.0),
            (rect.x + 2.0, rect.bottom() - 2.0),
            (rect.right() - 2.0, rect.bottom() - 2.0),
        ] {
            let sampled = pixel(&frame, x, y);
            assert!(
                !close(sampled, fill) && !close(sampled, border),
                "corner artifact at ({x},{y}): {:?}",
                sampled
            );
        }
        assert!(!close(
            pixel(&frame, rect.center().x, rect.y + 0.5),
            theme.palette.page
        ));
        assert!(close(pixel(&frame, rect.center().x, rect.center().y), fill));
    }
}

#[test]
fn button_corners_are_rounded_and_clean() {
    for variant in [
        ButtonVariant::Filled,
        ButtonVariant::Tonal,
        ButtonVariant::Outlined,
        ButtonVariant::Text,
    ] {
        let widget = Widget::column(vec![Widget::button("Action")
            .variant(variant)
            .width_px(140.0)
            .height_px(40.0)])
        .padding_all(40.0);
        let frame = render(&widget, 240, 140, ThemeMode::Light);
        let theme = Theme::light();
        let tree = layout(
            &widget,
            Size::new(240.0, 140.0),
            &theme,
            &LayoutOptions::empty(),
        );
        let button = find(&tree.root, &|node| {
            matches!(node.paint, PaintData::Button { .. })
        })
        .expect("button");
        let rect = button.rect;
        let page = frame.theme.palette.page;
        for (x, y) in [
            (rect.x + 1.0, rect.y + 1.0),
            (rect.right() - 1.0, rect.bottom() - 1.0),
        ] {
            assert!(
                close(pixel(&frame, x, y), page),
                "button {variant:?} corner is not page: {:?}",
                pixel(&frame, x, y)
            );
        }
    }
}

#[test]
fn switch_knob_stays_inside_track() {
    for checked in [false, true] {
        for mode in [ThemeMode::Light, ThemeMode::Dark] {
            let signal = Signal::new(checked);
            let widget = Widget::row(vec![Widget::switch_signal("Toggle", signal).width_px(140.0)])
                .padding_all(30.0);
            let theme = Theme::from_mode(mode);
            let tree = layout(
                &widget,
                Size::new(220.0, 100.0),
                &theme,
                &LayoutOptions::empty(),
            );
            let mut renderer = HeadlessRenderer::new(220, 100).expect("renderer");
            let pixels = renderer.render(&tree, &theme, 1.0).expect("render");
            let frame = Frame {
                pixels,
                width: 220,
                theme: theme.clone(),
            };
            let switch = find(&tree.root, &|node| {
                matches!(node.paint, PaintData::Switch { .. })
            })
            .expect("switch");
            let track =
                ui_core::Rect::new(switch.rect.x, switch.rect.center().y - 12.0, 44.0, 24.0);
            let center_y = track.center().y;
            let page = theme.palette.page;
            assert!(close(pixel(&frame, track.x - 2.0, center_y), page));
            assert!(close(pixel(&frame, track.right() + 2.0, center_y), page));
            assert!(close(
                pixel(&frame, track.x + 0.5, track.y + 12.0),
                if checked {
                    theme.palette.primary
                } else {
                    theme.palette.outline
                }
            ));
            if checked {
                assert!(close(
                    pixel(&frame, track.right() - 12.0, center_y),
                    theme.palette.on_primary
                ));
                assert!(close(
                    pixel(&frame, track.x + 12.0, center_y),
                    theme.palette.primary
                ));
            } else {
                assert!(close(
                    pixel(&frame, track.x + 12.0, center_y),
                    theme.palette.outline
                ));
                assert!(close(
                    pixel(&frame, track.right() - 12.0, center_y),
                    theme.palette.surface_container_highest
                ));
            }
        }
    }
}

#[test]
fn hairline_borders_are_one_logical_pixel() {
    for scale in [1.0f32, 2.0] {
        let widget = Widget::column(vec![Widget::card(vec![
            Widget::text("Card body").height_px(20.0)
        ])
        .width_px(300.0)
        .height_px(180.0)])
        .padding_all(50.0);
        let theme = Theme::light();
        let tree = layout(
            &widget,
            Size::new(460.0, 320.0),
            &theme,
            &LayoutOptions::empty(),
        );
        let width = (460.0 * scale) as u32;
        let height = (320.0 * scale) as u32;
        let mut renderer = HeadlessRenderer::new(width, height).expect("renderer");
        let pixels = renderer.render(&tree, &theme, scale).expect("render");
        let frame = Frame {
            pixels,
            width,
            theme: theme.clone(),
        };
        let card = find(&tree.root, &|node| node.role == ui_core::Role::Card).expect("card");
        let rect = card.rect;
        let y = rect.center().y * scale;
        let border = theme.palette.outline_variant;
        let fill = theme.card_surface();
        assert!(
            close(pixel(&frame, (rect.x + 0.5) * scale, y), border),
            "scale {scale}: border pixel {:?} != {:?}",
            pixel(&frame, (rect.x + 0.5) * scale, y),
            border.to_rgba8()
        );
        assert!(
            close(pixel(&frame, (rect.x + 1.5) * scale, y), fill),
            "scale {scale}: inner edge {:?} is still border",
            pixel(&frame, (rect.x + 1.5) * scale, y)
        );
        let thick = (0..(6.0 * scale) as u32)
            .map(|offset| pixel(&frame, rect.x * scale + offset as f32 + 0.5, y))
            .take_while(|sample| !close(*sample, fill))
            .count();
        assert!(
            thick >= (1.0 * scale) as usize && thick <= (1.0 * scale) as usize + 1,
            "scale {scale}: border thickness {thick} physical px"
        );
    }
}
