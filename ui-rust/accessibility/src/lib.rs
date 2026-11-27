use accesskit::{Node, NodeId, Role, TreeId, TreeInfo, TreeUpdate};
use ui_core::layout::{LayoutNode, LayoutTree, Role as UiRole};

pub fn build_tree(tree: &LayoutTree, focus: Option<u64>) -> TreeUpdate {
    let mut nodes = Vec::with_capacity(tree.node_count());
    collect(&tree.root, &mut nodes);
    let root_id = NodeId(tree.root.id);
    let focus_id = focus.map(NodeId).unwrap_or(root_id);
    TreeUpdate {
        nodes,
        tree: Some(TreeInfo::new(root_id)),
        tree_id: TreeId::ROOT,
        focus: focus_id,
    }
}

fn collect(node: &LayoutNode, out: &mut Vec<(NodeId, Node)>) {
    let mut access = Node::new(map_role(node.role));
    if let Some(label) = &node.label {
        access.set_label(label.clone());
    }
    if let Some(value) = &node.value {
        access.set_value(value.clone());
    }
    let rect = node.rect;
    access.set_bounds(accesskit::Rect {
        x0: rect.x as f64,
        y0: rect.y as f64,
        x1: rect.right() as f64,
        y1: rect.bottom() as f64,
    });
    if !node.interaction.enabled {
        access.set_disabled();
    }
    match node.role {
        UiRole::Checkbox | UiRole::Switch => {
            access.set_toggled(if node.selected {
                accesskit::Toggled::True
            } else {
                accesskit::Toggled::False
            });
        }
        _ => {
            if node.selected {
                access.set_selected(true);
            }
        }
    }
    let children: Vec<NodeId> = node.children.iter().map(|child| NodeId(child.id)).collect();
    if !children.is_empty() {
        access.set_children(children);
    }
    out.push((NodeId(node.id), access));
    for child in &node.children {
        collect(child, out);
    }
}

fn map_role(role: UiRole) -> Role {
    match role {
        UiRole::Generic => Role::GenericContainer,
        UiRole::Group => Role::Group,
        UiRole::Text => Role::Label,
        UiRole::Heading => Role::Heading,
        UiRole::Button => Role::Button,
        UiRole::TextField => Role::TextInput,
        UiRole::Checkbox => Role::CheckBox,
        UiRole::Switch => Role::Switch,
        UiRole::Select => Role::ComboBox,
        UiRole::Progress => Role::ProgressIndicator,
        UiRole::Navigation => Role::Navigation,
        UiRole::Table => Role::Table,
        UiRole::Card => Role::GenericContainer,
        UiRole::Divider => Role::Splitter,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ui_core::form::Field;
    use ui_core::geometry::Size;
    use ui_core::layout::{layout, LayoutOptions};
    use ui_core::theme::Theme;
    use ui_core::widget::Widget;

    fn tree() -> LayoutTree {
        let field = Field::<String>::new("email", "Email");
        let widget = Widget::column(vec![
            Widget::heading("Title", 2),
            Widget::text_field(&field, "Email"),
            Widget::button("Submit").on_click(|| {}),
        ])
        .padding_all(16.0)
        .gap(8.0);
        layout(
            &widget,
            Size::new(400.0, 500.0),
            &Theme::light(),
            &LayoutOptions::empty(),
        )
    }

    #[test]
    fn tree_contains_roles_and_labels() {
        let layout = tree();
        let update = build_tree(&layout, None);
        assert!(update.tree.is_some());
        assert_eq!(update.nodes.len(), layout.node_count());
        let has_button = update
            .nodes
            .iter()
            .any(|(_, node)| node.role() == Role::Button);
        let has_input = update
            .nodes
            .iter()
            .any(|(_, node)| node.role() == Role::TextInput);
        let has_heading = update
            .nodes
            .iter()
            .any(|(_, node)| node.role() == Role::Heading);
        assert!(has_button);
        assert!(has_input);
        assert!(has_heading);
        let labelled = update
            .nodes
            .iter()
            .any(|(_, node)| node.label() == Some("Submit"));
        assert!(labelled);
    }

    #[test]
    fn focus_is_forwarded() {
        let layout = tree();
        let focus = layout.focusables().first().copied().expect("focusable");
        let update = build_tree(&layout, Some(focus));
        assert_eq!(update.focus, NodeId(focus));
    }

    #[test]
    fn bounds_match_layout() {
        let layout = tree();
        let update = build_tree(&layout, None);
        for (id, node) in &update.nodes {
            let source = layout.find(id.0).expect("node");
            let bounds = node.bounds().expect("bounds");
            assert!((bounds.x0 - source.rect.x as f64).abs() < 0.01);
            assert!((bounds.y1 - source.rect.bottom() as f64).abs() < 0.01);
        }
    }
}
