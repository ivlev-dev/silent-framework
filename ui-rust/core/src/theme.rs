use crate::color::Color;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ThemeMode {
    Light,
    Dark,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FontWeight {
    Regular,
    Medium,
    SemiBold,
    Bold,
}

impl FontWeight {
    pub fn weight(self) -> u16 {
        match self {
            FontWeight::Regular => 400,
            FontWeight::Medium => 500,
            FontWeight::SemiBold => 600,
            FontWeight::Bold => 700,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TextStyle {
    pub size: f32,
    pub line_height: f32,
    pub weight: FontWeight,
    pub tracking: f32,
}

impl TextStyle {
    pub const fn new(size: f32, line_height: f32, weight: FontWeight) -> Self {
        Self {
            size,
            line_height,
            weight,
            tracking: 0.0,
        }
    }

    pub const fn tracked(mut self, tracking: f32) -> Self {
        self.tracking = tracking;
        self
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Typography {
    pub display_large: TextStyle,
    pub display_medium: TextStyle,
    pub display_small: TextStyle,
    pub headline_large: TextStyle,
    pub headline_medium: TextStyle,
    pub headline_small: TextStyle,
    pub title_large: TextStyle,
    pub title_medium: TextStyle,
    pub title_small: TextStyle,
    pub body_large: TextStyle,
    pub body_medium: TextStyle,
    pub body_small: TextStyle,
    pub label_large: TextStyle,
    pub label_medium: TextStyle,
    pub label_small: TextStyle,
    pub brand: TextStyle,
    pub subtitle: TextStyle,
    pub hint: TextStyle,
    pub footer: TextStyle,
}

impl Default for Typography {
    fn default() -> Self {
        Self {
            display_large: TextStyle::new(44.0, 52.8, FontWeight::SemiBold).tracked(-0.66),
            display_medium: TextStyle::new(38.0, 45.6, FontWeight::SemiBold).tracked(-0.46),
            display_small: TextStyle::new(34.0, 40.8, FontWeight::SemiBold).tracked(-0.34),
            headline_large: TextStyle::new(32.0, 38.4, FontWeight::SemiBold).tracked(-0.26),
            headline_medium: TextStyle::new(28.0, 36.4, FontWeight::SemiBold).tracked(-0.14),
            headline_small: TextStyle::new(24.0, 31.2, FontWeight::SemiBold),
            title_large: TextStyle::new(20.0, 27.0, FontWeight::SemiBold),
            title_medium: TextStyle::new(18.0, 25.2, FontWeight::SemiBold),
            title_small: TextStyle::new(16.0, 23.2, FontWeight::SemiBold),
            body_large: TextStyle::new(17.0, 26.4, FontWeight::Regular),
            body_medium: TextStyle::new(16.0, 24.8, FontWeight::Regular),
            body_small: TextStyle::new(14.0, 21.0, FontWeight::Regular),
            label_large: TextStyle::new(13.0, 18.2, FontWeight::SemiBold).tracked(0.065),
            label_medium: TextStyle::new(12.0, 16.2, FontWeight::SemiBold).tracked(0.12),
            label_small: TextStyle::new(12.0, 16.0, FontWeight::SemiBold).tracked(0.48),
            brand: TextStyle::new(14.0, 18.0, FontWeight::SemiBold),
            subtitle: TextStyle::new(15.0, 22.5, FontWeight::Regular),
            hint: TextStyle::new(12.0, 16.0, FontWeight::Regular),
            footer: TextStyle::new(12.0, 16.0, FontWeight::Regular),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Palette {
    pub background: Color,
    pub page: Color,
    pub surface: Color,
    pub surface_dim: Color,
    pub surface_bright: Color,
    pub surface_container_lowest: Color,
    pub surface_container_low: Color,
    pub surface_container: Color,
    pub surface_container_high: Color,
    pub surface_container_highest: Color,
    pub surface_variant: Color,
    pub surface_raised: Color,
    pub overlay: Color,
    pub primary: Color,
    pub on_primary: Color,
    pub primary_hover: Color,
    pub primary_fixed: Color,
    pub primary_fixed_dim: Color,
    pub on_primary_fixed: Color,
    pub on_primary_fixed_variant: Color,
    pub primary_container: Color,
    pub on_primary_container: Color,
    pub secondary: Color,
    pub on_secondary: Color,
    pub secondary_container: Color,
    pub on_secondary_container: Color,
    pub tertiary: Color,
    pub on_tertiary: Color,
    pub tertiary_container: Color,
    pub on_tertiary_container: Color,
    pub accent: Color,
    pub on_accent: Color,
    pub text_primary: Color,
    pub text_secondary: Color,
    pub text_tertiary: Color,
    pub text_disabled: Color,
    pub on_surface: Color,
    pub on_surface_variant: Color,
    pub on_surface_muted: Color,
    pub border: Color,
    pub border_strong: Color,
    pub outline: Color,
    pub outline_variant: Color,
    pub focus_ring: Color,
    pub error: Color,
    pub on_error: Color,
    pub error_container: Color,
    pub on_error_container: Color,
    pub success: Color,
    pub on_success: Color,
    pub success_container: Color,
    pub on_success_container: Color,
    pub warning: Color,
    pub on_warning: Color,
    pub warning_container: Color,
    pub on_warning_container: Color,
    pub disabled: Color,
    pub scrim: Color,
    pub shadow: Color,
    pub inverse_surface: Color,
    pub inverse_on_surface: Color,
}

impl Palette {
    pub fn light() -> Self {
        let surface = Color::from_hex(0xF2F5F7);
        let surface_container_lowest = Color::from_hex(0xFFFFFF);
        let surface_container_low = Color::from_hex(0xF7F9FA);
        let surface_container = Color::from_hex(0xEDF2F5);
        let surface_container_high = Color::from_hex(0xE6EDF2);
        let surface_container_highest = Color::from_hex(0xD2DFE8);
        let on_surface = Color::from_hex(0x081A2E);
        let on_surface_variant = Color::from_hex(0x3A566B);
        let on_surface_muted = Color::from_hex(0x4C6477);
        let outline = Color::from_hex(0x638198);
        let outline_variant = Color::from_hex(0xC9D8E2);
        Self {
            background: Color::from_hex(0xFAFBFC),
            page: Color::from_hex(0xFAFBFC),
            surface,
            surface_dim: Color::from_hex(0xE3EBF1),
            surface_bright: Color::from_hex(0xFFFFFF),
            surface_container_lowest,
            surface_container_low,
            surface_container,
            surface_container_high,
            surface_container_highest,
            surface_variant: surface_container,
            surface_raised: surface_container_lowest,
            overlay: surface_container_lowest,
            primary: Color::from_hex(0x0E2A47),
            on_primary: Color::from_hex(0xF2F5F7),
            primary_hover: Color::from_hex(0x1F4E6B),
            primary_fixed: Color::from_hex(0x9FB8C9),
            primary_fixed_dim: Color::from_hex(0x7E99AC),
            on_primary_fixed: Color::from_hex(0x081A2E),
            on_primary_fixed_variant: Color::from_hex(0x1F4E6B),
            primary_container: Color::from_hex(0xD9E4EC),
            on_primary_container: Color::from_hex(0x081A2E),
            secondary: Color::from_hex(0x1F4E6B),
            on_secondary: Color::from_hex(0xF2F5F7),
            secondary_container: Color::from_hex(0xD9E4EC),
            on_secondary_container: Color::from_hex(0x081A2E),
            tertiary: Color::from_hex(0x9FB8C9),
            on_tertiary: Color::from_hex(0x081A2E),
            tertiary_container: Color::from_hex(0xD9E4EC),
            on_tertiary_container: Color::from_hex(0x081A2E),
            accent: Color::from_hex(0x9FB8C9),
            on_accent: Color::from_hex(0x081A2E),
            text_primary: on_surface,
            text_secondary: on_surface_variant,
            text_tertiary: on_surface_muted,
            text_disabled: on_surface_muted.with_alpha(0.38),
            on_surface,
            on_surface_variant,
            on_surface_muted,
            border: outline_variant,
            border_strong: outline,
            outline,
            outline_variant,
            focus_ring: Color::from_hex(0x0E2A47),
            error: Color::from_hex(0xA8322A),
            on_error: Color::from_hex(0xFFFFFF),
            error_container: Color::from_hex(0xF6DAD6),
            on_error_container: Color::from_hex(0x410E0B),
            success: Color::from_hex(0x1F6B45),
            on_success: Color::from_hex(0xFFFFFF),
            success_container: Color::from_hex(0xCFE9D9),
            on_success_container: Color::from_hex(0x04291A),
            warning: Color::from_hex(0x7A5200),
            on_warning: Color::from_hex(0xFFFFFF),
            warning_container: Color::from_hex(0xF6E0B0),
            on_warning_container: Color::from_hex(0x2E2000),
            disabled: surface_container_high,
            scrim: Color::from_hex(0x081A2E),
            shadow: Color::from_hex(0x0E2A47),
            inverse_surface: Color::from_hex(0x0E2A47),
            inverse_on_surface: Color::from_hex(0xF2F5F7),
        }
    }

    pub fn dark() -> Self {
        let surface = Color::from_hex(0x17181B);
        let surface_container_lowest = Color::from_hex(0x131417);
        let surface_container_low = Color::from_hex(0x1D1E22);
        let surface_container = Color::from_hex(0x232428);
        let surface_container_high = Color::from_hex(0x2A2B30);
        let surface_container_highest = Color::from_hex(0x333439);
        let on_surface = Color::from_hex(0xECECEF);
        let on_surface_variant = Color::from_hex(0xC9C9D0);
        let on_surface_muted = Color::from_hex(0x9C9CA5);
        let outline = Color::from_hex(0x85858F);
        let outline_variant = Color::from_hex(0x3C3D44);
        Self {
            background: surface,
            page: surface,
            surface,
            surface_dim: Color::from_hex(0x101114),
            surface_bright: Color::from_hex(0x3A3B41),
            surface_container_lowest,
            surface_container_low,
            surface_container,
            surface_container_high,
            surface_container_highest,
            surface_variant: surface_container,
            surface_raised: surface_container_low,
            overlay: surface_container_low,
            primary: Color::from_hex(0xD9D5CB),
            on_primary: Color::from_hex(0x141416),
            primary_hover: Color::from_hex(0xE6E2D9),
            primary_fixed: Color::from_hex(0xD9D5CB),
            primary_fixed_dim: Color::from_hex(0xB9B5AB),
            on_primary_fixed: Color::from_hex(0x141416),
            on_primary_fixed_variant: Color::from_hex(0xC9C5BB),
            primary_container: Color::from_hex(0x34343A),
            on_primary_container: Color::from_hex(0xEDEAE2),
            secondary: Color::from_hex(0xC4C1B9),
            on_secondary: Color::from_hex(0x141416),
            secondary_container: Color::from_hex(0x2C2D32),
            on_secondary_container: Color::from_hex(0xE7E4DC),
            tertiary: Color::from_hex(0xA9B3AC),
            on_tertiary: Color::from_hex(0x141416),
            tertiary_container: Color::from_hex(0x2C342F),
            on_tertiary_container: Color::from_hex(0xDCE5DC),
            accent: Color::from_hex(0xC9C5BB),
            on_accent: Color::from_hex(0x141416),
            text_primary: on_surface,
            text_secondary: on_surface_variant,
            text_tertiary: on_surface_muted,
            text_disabled: on_surface_muted.with_alpha(0.38),
            on_surface,
            on_surface_variant,
            on_surface_muted,
            border: outline_variant,
            border_strong: outline,
            outline,
            outline_variant,
            focus_ring: Color::from_hex(0xD9D5CB),
            error: Color::from_hex(0xF0B2AC),
            on_error: Color::from_hex(0x2A0B08),
            error_container: Color::from_hex(0x3A1B18),
            on_error_container: Color::from_hex(0xF6DAD6),
            success: Color::from_hex(0xA6D8B8),
            on_success: Color::from_hex(0x0A2415),
            success_container: Color::from_hex(0x173324),
            on_success_container: Color::from_hex(0xD6EEDF),
            warning: Color::from_hex(0xE5C87A),
            on_warning: Color::from_hex(0x2A2000),
            warning_container: Color::from_hex(0x3A2F10),
            on_warning_container: Color::from_hex(0xF6E0B0),
            disabled: surface_container_high,
            scrim: Color::from_hex(0x000000),
            shadow: Color::from_hex(0x000000),
            inverse_surface: Color::from_hex(0xECECEF),
            inverse_on_surface: Color::from_hex(0x1D1E22),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Spacing {
    pub xs: f32,
    pub sm: f32,
    pub md: f32,
    pub lg: f32,
    pub xl: f32,
    pub xxl: f32,
    pub xxxl: f32,
}

impl Default for Spacing {
    fn default() -> Self {
        Self {
            xs: 4.0,
            sm: 8.0,
            md: 12.0,
            lg: 16.0,
            xl: 24.0,
            xxl: 32.0,
            xxxl: 48.0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Radius {
    pub none: f32,
    pub xs: f32,
    pub sm: f32,
    pub md: f32,
    pub lg: f32,
    pub xl: f32,
    pub full: f32,
    pub card: f32,
    pub dialog: f32,
    pub control: f32,
}

impl Default for Radius {
    fn default() -> Self {
        Self {
            none: 0.0,
            xs: 4.0,
            sm: 6.0,
            md: 10.0,
            lg: 14.0,
            xl: 20.0,
            full: 999.0,
            card: 16.0,
            dialog: 20.0,
            control: 10.0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ElevationLevel {
    pub offset_y: f32,
    pub blur: f32,
    pub alpha: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Elevation {
    pub levels: [ElevationLevel; 6],
}

impl Default for Elevation {
    fn default() -> Self {
        Self {
            levels: [
                ElevationLevel {
                    offset_y: 0.0,
                    blur: 0.0,
                    alpha: 0.0,
                },
                ElevationLevel {
                    offset_y: 1.0,
                    blur: 2.0,
                    alpha: 0.06,
                },
                ElevationLevel {
                    offset_y: 2.0,
                    blur: 8.0,
                    alpha: 0.08,
                },
                ElevationLevel {
                    offset_y: 8.0,
                    blur: 24.0,
                    alpha: 0.1,
                },
                ElevationLevel {
                    offset_y: 12.0,
                    blur: 32.0,
                    alpha: 0.12,
                },
                ElevationLevel {
                    offset_y: 20.0,
                    blur: 48.0,
                    alpha: 0.14,
                },
            ],
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Sizes {
    pub control_height_sm: f32,
    pub control_height: f32,
    pub input_height: f32,
    pub control_height_lg: f32,
    pub icon_sm: f32,
    pub icon: f32,
    pub icon_lg: f32,
    pub font_size: f32,
    pub nav_rail_width: f32,
    pub nav_rail_collapsed: f32,
    pub nav_bar_height: f32,
    pub top_app_bar_height: f32,
    pub table_header_height: f32,
    pub table_row_height: f32,
    pub table_row_compact: f32,
    pub card_padding: f32,
    pub card_padding_lg: f32,
    pub focus_ring_width: f32,
    pub focus_ring_offset: f32,
    pub border_width: f32,
    pub density: f32,
}

impl Default for Sizes {
    fn default() -> Self {
        Self {
            control_height_sm: 32.0,
            control_height: 40.0,
            input_height: 40.0,
            control_height_lg: 48.0,
            icon_sm: 14.0,
            icon: 18.0,
            icon_lg: 22.0,
            font_size: 16.0,
            nav_rail_width: 260.0,
            nav_rail_collapsed: 72.0,
            nav_bar_height: 64.0,
            top_app_bar_height: 56.0,
            table_header_height: 48.0,
            table_row_height: 56.0,
            table_row_compact: 48.0,
            card_padding: 20.0,
            card_padding_lg: 24.0,
            focus_ring_width: 2.0,
            focus_ring_offset: 2.0,
            border_width: 1.0,
            density: 1.0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LayoutTokens {
    pub content_max: f32,
    pub content_wide_max: f32,
    pub page_gutter_min: f32,
    pub page_gutter_max: f32,
    pub section_gap_min: f32,
    pub section_gap_max: f32,
}

impl Default for LayoutTokens {
    fn default() -> Self {
        Self {
            content_max: 1440.0,
            content_wide_max: 1440.0,
            page_gutter_min: 16.0,
            page_gutter_max: 32.0,
            section_gap_min: 24.0,
            section_gap_max: 32.0,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Theme {
    pub mode: ThemeMode,
    pub palette: Palette,
    pub typography: Typography,
    pub spacing: Spacing,
    pub radius: Radius,
    pub elevation: Elevation,
    pub sizes: Sizes,
    pub layout: LayoutTokens,
    pub shadow: Color,
}

impl Theme {
    pub fn light() -> Self {
        Self::from_mode(ThemeMode::Light)
    }

    pub fn dark() -> Self {
        Self::from_mode(ThemeMode::Dark)
    }

    pub fn from_mode(mode: ThemeMode) -> Self {
        let palette = match mode {
            ThemeMode::Light => Palette::light(),
            ThemeMode::Dark => Palette::dark(),
        };
        Self {
            mode,
            shadow: palette.shadow,
            palette,
            typography: Typography::default(),
            spacing: Spacing::default(),
            radius: Radius::default(),
            elevation: Elevation::default(),
            sizes: Sizes::default(),
            layout: LayoutTokens::default(),
        }
    }

    pub fn toggle(&self) -> Self {
        match self.mode {
            ThemeMode::Light => Self::dark(),
            ThemeMode::Dark => Self::light(),
        }
    }

    pub fn is_dark(&self) -> bool {
        self.mode == ThemeMode::Dark
    }

    pub fn gutter(&self, viewport_width: f32) -> f32 {
        (self.layout.page_gutter_min + viewport_width * 0.01)
            .clamp(self.layout.page_gutter_min, self.layout.page_gutter_max)
    }

    pub fn section_gap(&self, viewport_width: f32) -> f32 {
        (self.layout.section_gap_min - 4.8 + viewport_width * 0.01)
            .clamp(self.layout.section_gap_min, self.layout.section_gap_max)
    }

    pub fn card_surface(&self) -> Color {
        if self.is_dark() {
            self.palette.surface_container_low
        } else {
            self.palette.surface_container_lowest
        }
    }

    pub fn rail_surface(&self) -> Color {
        if self.is_dark() {
            self.palette.surface_container
        } else {
            self.palette.surface_container_lowest
        }
    }

    pub fn nav_selected_surface(&self) -> Color {
        if self.is_dark() {
            self.palette.primary_container
        } else {
            self.palette.secondary_container
        }
    }

    pub fn nav_selected_text(&self) -> Color {
        if self.is_dark() {
            self.palette.on_primary_container
        } else {
            self.palette.on_secondary_container
        }
    }

    pub fn table_header_surface(&self) -> Color {
        self.palette.surface_container
    }

    pub fn top_bar_surface(&self) -> Color {
        self.palette.surface
    }

    pub fn scaled(&self, value: f32) -> f32 {
        value * self.sizes.density
    }

    pub fn elevation_level(&self, level: f32) -> ElevationLevel {
        let index = level.round().clamp(0.0, 5.0) as usize;
        self.elevation.levels[index]
    }
}

impl Default for Theme {
    fn default() -> Self {
        Self::light()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::color::contrast_ratio;

    #[test]
    fn light_theme_contrast_is_readable() {
        let theme = Theme::light();
        assert!(contrast_ratio(theme.palette.text_primary, theme.palette.surface) > 7.0);
        assert!(contrast_ratio(theme.palette.on_primary, theme.palette.primary) > 4.5);
        assert!(contrast_ratio(theme.palette.error, theme.palette.surface) > 3.0);
        assert!(contrast_ratio(theme.palette.text_secondary, theme.palette.surface) > 4.5);
    }

    #[test]
    fn dark_theme_contrast_is_readable() {
        let theme = Theme::dark();
        assert!(contrast_ratio(theme.palette.text_primary, theme.palette.surface) > 7.0);
        assert!(contrast_ratio(theme.palette.on_primary, theme.palette.primary) > 4.5);
        assert!(contrast_ratio(theme.palette.text_secondary, theme.palette.surface) > 4.5);
    }

    #[test]
    fn toggle_switches_mode() {
        assert_eq!(Theme::light().toggle().mode, ThemeMode::Dark);
        assert_eq!(Theme::dark().toggle().mode, ThemeMode::Light);
    }

    #[test]
    fn tokens_match_design_system() {
        let theme = Theme::light();
        assert_eq!(theme.radius.card, 16.0);
        assert_eq!(theme.radius.control, 10.0);
        assert_eq!(theme.sizes.control_height_sm, 32.0);
        assert_eq!(theme.sizes.control_height, 40.0);
        assert_eq!(theme.sizes.input_height, 40.0);
        assert_eq!(theme.sizes.control_height_lg, 48.0);
        assert_eq!(theme.sizes.nav_rail_width, 260.0);
        assert_eq!(theme.sizes.top_app_bar_height, 56.0);
        assert_eq!(theme.sizes.table_row_height, 56.0);
        assert_eq!(theme.sizes.table_header_height, 48.0);
        assert_eq!(theme.layout.content_max, 1440.0);
        assert_eq!(theme.gutter(400.0), 20.0);
        assert_eq!(theme.gutter(1400.0), 30.0);
        assert_eq!(theme.gutter(1600.0), 32.0);
        assert_eq!(theme.section_gap(390.0), 24.0);
        assert_eq!(theme.section_gap(1400.0), 32.0);
        assert_eq!(theme.typography.body_medium.size, 16.0);
        assert_eq!(theme.typography.label_large.size, 13.0);
    }

    #[test]
    fn palette_uses_silent_ink_teal_ivory() {
        let light = Theme::light();
        assert_eq!(light.palette.primary, Color::from_hex(0x0E2A47));
        assert_eq!(light.palette.surface, Color::from_hex(0xF2F5F7));
        assert_eq!(
            light.palette.surface_container_lowest,
            Color::from_hex(0xFFFFFF)
        );
        assert_eq!(light.palette.accent, Color::from_hex(0x9FB8C9));
        let dark = Theme::dark();
        assert_eq!(dark.palette.primary, Color::from_hex(0xD9D5CB));
        assert_eq!(dark.palette.surface, Color::from_hex(0x17181B));
        assert_eq!(dark.palette.on_surface, Color::from_hex(0xECECEF));
        assert_eq!(dark.palette.surface_dim, Color::from_hex(0x101114));
        assert_eq!(dark.palette.surface_bright, Color::from_hex(0x3A3B41));
        assert_eq!(
            dark.palette.surface_container_lowest,
            Color::from_hex(0x131417)
        );
        assert_eq!(
            dark.palette.surface_container_low,
            Color::from_hex(0x1D1E22)
        );
        assert_eq!(dark.palette.surface_container, Color::from_hex(0x232428));
        assert_eq!(
            dark.palette.surface_container_high,
            Color::from_hex(0x2A2B30)
        );
        assert_eq!(
            dark.palette.surface_container_highest,
            Color::from_hex(0x333439)
        );
        assert_eq!(dark.palette.on_surface_variant, Color::from_hex(0xC9C9D0));
        assert_eq!(dark.palette.on_surface_muted, Color::from_hex(0x9C9CA5));
        assert_eq!(dark.palette.outline, Color::from_hex(0x85858F));
        assert_eq!(dark.palette.outline_variant, Color::from_hex(0x3C3D44));
        assert_eq!(dark.palette.primary_container, Color::from_hex(0x34343A));
        assert_eq!(dark.palette.on_primary_container, Color::from_hex(0xEDEAE2));
        assert_eq!(dark.palette.on_primary, Color::from_hex(0x141416));
        assert_eq!(dark.palette.accent, Color::from_hex(0xC9C5BB));
        assert_eq!(dark.palette.scrim, Color::from_hex(0x000000));
        assert_eq!(dark.palette.inverse_surface, Color::from_hex(0xECECEF));
    }
}
