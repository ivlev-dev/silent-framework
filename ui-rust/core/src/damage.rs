use crate::geometry::{Rect, Size};

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Damage {
    pub full: bool,
    pub rect: Option<Rect>,
}

impl Damage {
    pub const NONE: Self = Self {
        full: false,
        rect: None,
    };

    pub fn full() -> Self {
        Self {
            full: true,
            rect: None,
        }
    }

    pub fn rect(rect: Rect) -> Self {
        if rect.width <= 0.0 || rect.height <= 0.0 {
            return Self::NONE;
        }
        Self {
            full: false,
            rect: Some(rect),
        }
    }

    pub fn is_empty(&self) -> bool {
        !self.full && self.rect.is_none()
    }

    pub fn union(self, other: Self) -> Self {
        if self.full || other.full {
            return Self::full();
        }
        match (self.rect, other.rect) {
            (Some(a), Some(b)) => Self::rect(union_rect(a, b)),
            (Some(a), None) => Self::rect(a),
            (None, Some(b)) => Self::rect(b),
            (None, None) => Self::NONE,
        }
    }

    pub fn expand(self, margin: f32) -> Self {
        if self.full {
            return self;
        }
        match self.rect {
            Some(rect) => Self::rect(Rect::new(
                rect.x - margin,
                rect.y - margin,
                rect.width + margin * 2.0,
                rect.height + margin * 2.0,
            )),
            None => self,
        }
    }

    pub fn clamp(self, viewport: Size) -> Self {
        if self.full {
            return Self::full();
        }
        match self.rect {
            Some(rect) => {
                Self::rect(rect.intersect(&Rect::new(0.0, 0.0, viewport.width, viewport.height)))
            }
            None => self,
        }
    }

    pub fn area(&self, viewport: Size) -> f64 {
        if self.full {
            return (viewport.width.max(0.0) * viewport.height.max(0.0)) as f64;
        }
        self.rect
            .map(|rect| (rect.width.max(0.0) * rect.height.max(0.0)) as f64)
            .unwrap_or(0.0)
    }
}

pub fn union_rect(a: Rect, b: Rect) -> Rect {
    let x = a.x.min(b.x);
    let y = a.y.min(b.y);
    let right = a.right().max(b.right());
    let bottom = a.bottom().max(b.bottom());
    Rect::new(x, y, right - x, bottom - y)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rects_are_united_into_one_region() {
        let damage = Damage::rect(Rect::new(10.0, 10.0, 20.0, 20.0))
            .union(Damage::rect(Rect::new(100.0, 50.0, 10.0, 10.0)));
        let rect = damage.rect.expect("rect");
        assert_eq!(rect.x, 10.0);
        assert_eq!(rect.y, 10.0);
        assert_eq!(rect.right(), 110.0);
        assert_eq!(rect.bottom(), 60.0);
    }

    #[test]
    fn full_damage_wins() {
        let damage = Damage::rect(Rect::new(0.0, 0.0, 10.0, 10.0)).union(Damage::full());
        assert!(damage.full);
        assert!(damage.rect.is_none());
    }

    #[test]
    fn empty_damage_is_not_full() {
        assert!(Damage::NONE.is_empty());
        assert!(!Damage::full().is_empty());
        assert!(Damage::NONE.union(Damage::NONE).is_empty());
    }

    #[test]
    fn expansion_and_clamping() {
        let viewport = Size::new(100.0, 100.0);
        let damage = Damage::rect(Rect::new(5.0, 5.0, 10.0, 10.0))
            .expand(2.0)
            .clamp(viewport);
        let rect = damage.rect.expect("rect");
        assert_eq!(rect.x, 3.0);
        assert_eq!(rect.width, 14.0);
        let clamped = Damage::rect(Rect::new(90.0, 90.0, 30.0, 30.0)).clamp(viewport);
        assert_eq!(clamped.rect.expect("clamped").right(), 100.0);
    }

    #[test]
    fn area_matches_viewport_for_full() {
        let viewport = Size::new(200.0, 100.0);
        assert_eq!(Damage::full().area(viewport), 20_000.0);
        assert_eq!(
            Damage::rect(Rect::new(0.0, 0.0, 10.0, 5.0)).area(viewport),
            50.0
        );
    }
}
