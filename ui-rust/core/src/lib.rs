extern crate self as ui_core;

pub mod clipboard;
pub mod color;
pub mod damage;
pub mod di;
pub mod form;
pub mod geometry;
pub mod layout;
pub mod responsive;
pub mod signal;
pub mod theme;
pub mod ui;
pub mod view;
pub mod view_model;
pub mod widget;

pub use clipboard::{Clipboard, MemoryClipboard};
pub use color::Color;
pub use damage::Damage;
pub use di::{Container, DiError, Injectable, Lifetime, ServiceDescriptor};
pub use form::{
    email_error, email_rule, Field, FieldAccess, FieldValue, Form, FormModel, FormState,
};

pub type UiForm = Form;
pub use geometry::{
    Align, Constraints, Direction, Edges, Justify, LayoutContext, Length, Point, Rect, Size,
    UiError,
};
pub use layout::{
    compute_damage, layout, CursorShape, LayoutNode, LayoutOptions, LayoutTree, PaintData, Role,
};
pub use responsive::{Breakpoint, Responsive};
pub use signal::{batch, revision, untracked, Computed, Effect, NodeId, Scope, Signal};
pub use theme::{Palette, TextStyle, Theme, ThemeMode, Typography};
pub use ui::{Key, Modifiers, Ui, UiEvent, UiState};
pub use view::{component, View, ViewSource};
pub use view_model::{Reactive, ViewModel};
pub use widget::{
    body_large, body_medium, body_small, brand, caption, display_large, display_medium, footer,
    headline_large, headline_medium, headline_small, hint, label_large, label_medium, label_small,
    subtitle, title_large, title_medium, title_small, Border, ButtonVariant, ControlSize, IconName,
    NavItem, SurfaceTone, TagVariant, TextTone, Widget, WidgetKind,
};

pub use inventory;
pub use ui_derive::{view_model, Injectable, ViewModel};
