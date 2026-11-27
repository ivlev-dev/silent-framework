use crate::geometry::UiError;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Breakpoint {
    Xs,
    Sm,
    Md,
    Lg,
    Xl,
    Xxl,
    Xxxl,
    X4xl,
    X5xl,
    X6xl,
}

pub const BREAKPOINTS: [(Breakpoint, f32); 10] = [
    (Breakpoint::Xs, 0.0),
    (Breakpoint::Sm, 360.0),
    (Breakpoint::Md, 480.0),
    (Breakpoint::Lg, 600.0),
    (Breakpoint::Xl, 840.0),
    (Breakpoint::Xxl, 1200.0),
    (Breakpoint::Xxxl, 1600.0),
    (Breakpoint::X4xl, 1920.0),
    (Breakpoint::X5xl, 2560.0),
    (Breakpoint::X6xl, 3840.0),
];

pub const BASE_FONT_SIZE: f32 = 16.0;

impl Breakpoint {
    pub const ALL: [Breakpoint; 10] = [
        Breakpoint::Xs,
        Breakpoint::Sm,
        Breakpoint::Md,
        Breakpoint::Lg,
        Breakpoint::Xl,
        Breakpoint::Xxl,
        Breakpoint::Xxxl,
        Breakpoint::X4xl,
        Breakpoint::X5xl,
        Breakpoint::X6xl,
    ];

    pub const fn min_width(self) -> f32 {
        match self {
            Breakpoint::Xs => 0.0,
            Breakpoint::Sm => 360.0,
            Breakpoint::Md => 480.0,
            Breakpoint::Lg => 600.0,
            Breakpoint::Xl => 840.0,
            Breakpoint::Xxl => 1200.0,
            Breakpoint::Xxxl => 1600.0,
            Breakpoint::X4xl => 1920.0,
            Breakpoint::X5xl => 2560.0,
            Breakpoint::X6xl => 3840.0,
        }
    }

    pub const fn name(self) -> &'static str {
        match self {
            Breakpoint::Xs => "xs",
            Breakpoint::Sm => "sm",
            Breakpoint::Md => "md",
            Breakpoint::Lg => "lg",
            Breakpoint::Xl => "xl",
            Breakpoint::Xxl => "2xl",
            Breakpoint::Xxxl => "3xl",
            Breakpoint::X4xl => "4xl",
            Breakpoint::X5xl => "5xl",
            Breakpoint::X6xl => "6xl",
        }
    }

    pub fn from_name(name: &str) -> Result<Self, UiError> {
        match name {
            "xs" => Ok(Breakpoint::Xs),
            "sm" => Ok(Breakpoint::Sm),
            "md" => Ok(Breakpoint::Md),
            "lg" => Ok(Breakpoint::Lg),
            "xl" => Ok(Breakpoint::Xl),
            "2xl" => Ok(Breakpoint::Xxl),
            "3xl" => Ok(Breakpoint::Xxxl),
            "4xl" => Ok(Breakpoint::X4xl),
            "5xl" => Ok(Breakpoint::X5xl),
            "6xl" => Ok(Breakpoint::X6xl),
            _ => Err(UiError(format!("unknown breakpoint: {name}"))),
        }
    }

    pub fn at_width(width: f32) -> Self {
        let mut current = Breakpoint::Xs;
        for bp in Breakpoint::ALL {
            if width >= bp.min_width() {
                current = bp;
            }
        }
        current
    }

    pub fn index(self) -> usize {
        Breakpoint::ALL
            .iter()
            .position(|bp| *bp == self)
            .unwrap_or(0)
    }

    pub fn next(self) -> Option<Self> {
        Breakpoint::ALL.get(self.index() + 1).copied()
    }

    pub fn prev(self) -> Option<Self> {
        self.index()
            .checked_sub(1)
            .and_then(|i| Breakpoint::ALL.get(i).copied())
    }

    pub fn is_at_least(self, other: Breakpoint) -> bool {
        self >= other
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Responsive<T> {
    entries: Vec<(Breakpoint, T)>,
}

impl<T: Clone> Responsive<T> {
    pub fn new(entries: &[(Breakpoint, T)]) -> Self {
        let mut entries = entries.to_vec();
        entries.sort_by_key(|(bp, _)| *bp);
        Self { entries }
    }

    pub fn constant(value: T) -> Self {
        Self {
            entries: vec![(Breakpoint::Xs, value)],
        }
    }

    pub fn resolve(&self, width: f32) -> T {
        let target = Breakpoint::at_width(width);
        let mut result: Option<&T> = None;
        for (bp, value) in &self.entries {
            if *bp <= target {
                result = Some(value);
            }
        }
        match result {
            Some(value) => value.clone(),
            None => self
                .entries
                .first()
                .map(|(_, value)| value.clone())
                .expect("responsive value must have at least one entry"),
        }
    }

    pub fn at(&self, breakpoint: Breakpoint) -> T {
        let mut result: Option<&T> = None;
        for (bp, value) in &self.entries {
            if *bp <= breakpoint {
                result = Some(value);
            }
        }
        match result {
            Some(value) => value.clone(),
            None => self
                .entries
                .first()
                .map(|(_, value)| value.clone())
                .expect("responsive value must have at least one entry"),
        }
    }

    pub fn entries(&self) -> &[(Breakpoint, T)] {
        &self.entries
    }
}

impl<T: Clone> From<T> for Responsive<T> {
    fn from(value: T) -> Self {
        Self::constant(value)
    }
}

#[macro_export]
macro_rules! responsive {
    ($($bp:ident => $value:expr),* $(,)?) => {
        $crate::responsive::Responsive::new(&[$(( $crate::responsive::Breakpoint::$bp, $value )),*])
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn breakpoints_match_design_tokens() {
        let expected = [
            ("xs", 0.0),
            ("sm", 360.0),
            ("md", 480.0),
            ("lg", 600.0),
            ("xl", 840.0),
            ("2xl", 1200.0),
            ("3xl", 1600.0),
            ("4xl", 1920.0),
            ("5xl", 2560.0),
            ("6xl", 3840.0),
        ];
        for (name, width) in expected {
            let bp = Breakpoint::from_name(name).expect("breakpoint");
            assert_eq!(bp.min_width(), width);
            assert_eq!(Breakpoint::from_name(name).expect("bp").name(), name);
        }
    }

    #[test]
    fn resolves_mobile_first() {
        let value = crate::responsive!(Xs => 1u32, Md => 2, Xl => 3);
        assert_eq!(value.resolve(0.0), 1);
        assert_eq!(value.resolve(359.0), 1);
        assert_eq!(value.resolve(360.0), 1);
        assert_eq!(value.resolve(479.0), 1);
        assert_eq!(value.resolve(480.0), 2);
        assert_eq!(value.resolve(839.0), 2);
        assert_eq!(value.resolve(840.0), 3);
        assert_eq!(value.resolve(5000.0), 3);
    }

    #[test]
    fn resolves_exact_breakpoint_below_first_entry() {
        let value = crate::responsive!(Xl => 3u32);
        assert_eq!(value.resolve(100.0), 3);
        assert_eq!(value.at(Breakpoint::Md), 3);
    }

    #[test]
    fn width_class_boundaries() {
        assert_eq!(Breakpoint::at_width(0.0), Breakpoint::Xs);
        assert_eq!(Breakpoint::at_width(359.9), Breakpoint::Xs);
        assert_eq!(Breakpoint::at_width(360.0), Breakpoint::Sm);
        assert_eq!(Breakpoint::at_width(1200.0), Breakpoint::Xxl);
        assert_eq!(Breakpoint::at_width(3839.0), Breakpoint::X5xl);
        assert_eq!(Breakpoint::at_width(3840.0), Breakpoint::X6xl);
        assert_eq!(Breakpoint::at_width(10000.0), Breakpoint::X6xl);
    }

    #[test]
    fn rejects_unknown_breakpoint() {
        assert!(Breakpoint::from_name("7xl").is_err());
    }

    #[test]
    fn breakpoints_stay_in_sync_with_design_tokens() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../packages/ui/src/tokens/breakpoints.json");
        let Ok(contents) = std::fs::read_to_string(path) else {
            return;
        };
        for (breakpoint, width) in BREAKPOINTS {
            let needle = format!("\"{}\": {}", breakpoint.name(), width as u64);
            assert!(
                contents.contains(&needle),
                "design token {needle} is missing or out of sync"
            );
        }
        assert!(contents.contains("\"baseFontSize\": 16"));
    }
}
