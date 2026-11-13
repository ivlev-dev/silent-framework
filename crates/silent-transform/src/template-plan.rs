use crate::transform::string_expr;
use swc_core::common::DUMMY_SP;
use swc_core::ecma::ast::{
    ArrayLit, Expr, ExprOrSpread, IdentName, KeyValueProp, Lit, Number, ObjectLit, Prop, PropName,
    PropOrSpread,
};

const ATTR_MARKER: &str = "data-silent-a-";
const HOLE_MARKER: &str = "silent-hole-";
const METADATA_TAGS: [&str; 3] = ["title", "meta", "link"];
const RISKY_TAGS: [&str; 22] = [
    "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "colgroup", "col", "select",
    "optgroup", "option", "p", "a", "form", "template", "script", "style", "html", "head", "body",
];

#[derive(Default)]
pub(crate) struct TemplatePlan {
    roots: Vec<ModelNode>,
    stack: Vec<ElementNode>,
}

struct ElementNode {
    tag: String,
    children: Vec<ModelNode>,
    marker_attrs: Vec<String>,
}

enum ModelNode {
    Element(ElementNode),
    Text(String),
    Comment { hole_index: usize },
}

struct PartPath {
    path: Vec<usize>,
    counts: Vec<usize>,
}

impl PartPath {
    fn new(path: &[usize], counts: &[usize]) -> Self {
        Self {
            path: path.to_vec(),
            counts: counts.to_vec(),
        }
    }

    fn into_expr(self, marker: &str, index: usize) -> Expr {
        object_expr(vec![
            ("path", number_array(self.path)),
            ("counts", number_array(self.counts)),
            ("key", string_expr(&format!("{marker}{index}"))),
        ])
    }
}

struct StripPlan {
    path: Vec<usize>,
    counts: Vec<usize>,
    names: Vec<String>,
}

impl StripPlan {
    fn into_expr(self) -> Expr {
        object_expr(vec![
            ("path", number_array(self.path)),
            ("counts", number_array(self.counts)),
            ("names", string_array(self.names)),
        ])
    }
}

impl TemplatePlan {
    pub(crate) fn open_element(&mut self, tag: &str) {
        self.stack.push(ElementNode {
            tag: tag.to_string(),
            children: Vec::new(),
            marker_attrs: Vec::new(),
        });
    }

    pub(crate) fn close_element(&mut self) {
        if let Some(element) = self.stack.pop() {
            self.push_node(ModelNode::Element(element));
        }
    }

    pub(crate) fn add_text(&mut self, text: &str) {
        if text.is_empty() {
            return;
        }
        let siblings = match self.stack.last_mut() {
            Some(element) => &mut element.children,
            None => &mut self.roots,
        };
        if let Some(ModelNode::Text(previous)) = siblings.last_mut() {
            previous.push_str(text);
            return;
        }
        siblings.push(ModelNode::Text(text.to_string()));
    }

    pub(crate) fn add_hole(&mut self, hole_index: usize) {
        self.push_node(ModelNode::Comment { hole_index });
    }

    pub(crate) fn mark_attr(&mut self, name: &str) {
        if let Some(element) = self.stack.last_mut() {
            element.marker_attrs.push(name.to_string());
        }
    }

    pub(crate) fn finish(self) -> Option<Expr> {
        if self.roots.iter().any(refuses_plan) {
            return None;
        }

        let roots = self.roots.len();
        let mut holes: Vec<(usize, PartPath)> = Vec::new();
        let mut attrs: Vec<(usize, PartPath)> = Vec::new();
        let mut strips: Vec<StripPlan> = Vec::new();
        for (index, root) in self.roots.iter().enumerate() {
            let mut path = vec![index];
            let mut counts = vec![roots];
            walk(
                root,
                &mut path,
                &mut counts,
                &mut holes,
                &mut attrs,
                &mut strips,
            );
        }
        holes.sort_by_key(|(index, _)| *index);
        attrs.sort_by_key(|(index, _)| *index);

        Some(object_expr(vec![
            ("roots", number_expr(roots)),
            (
                "holes",
                array_expr(
                    holes
                        .into_iter()
                        .map(|(index, entry)| entry.into_expr(HOLE_MARKER, index))
                        .collect(),
                ),
            ),
            (
                "attrs",
                array_expr(
                    attrs
                        .into_iter()
                        .map(|(index, entry)| entry.into_expr(ATTR_MARKER, index))
                        .collect(),
                ),
            ),
            (
                "strips",
                array_expr(strips.into_iter().map(StripPlan::into_expr).collect()),
            ),
        ]))
    }

    fn push_node(&mut self, node: ModelNode) {
        let siblings = match self.stack.last_mut() {
            Some(element) => &mut element.children,
            None => &mut self.roots,
        };
        if let ModelNode::Text(text) = &node {
            if let Some(ModelNode::Text(previous)) = siblings.last_mut() {
                previous.push_str(text);
                return;
            }
        }
        siblings.push(node);
    }
}

fn walk(
    node: &ModelNode,
    path: &mut Vec<usize>,
    counts: &mut Vec<usize>,
    holes: &mut Vec<(usize, PartPath)>,
    attrs: &mut Vec<(usize, PartPath)>,
    strips: &mut Vec<StripPlan>,
) {
    match node {
        ModelNode::Element(element) => {
            if !element.marker_attrs.is_empty() {
                strips.push(StripPlan {
                    path: path.clone(),
                    counts: counts.clone(),
                    names: element.marker_attrs.clone(),
                });
            }
            for name in &element.marker_attrs {
                if let Some(index) = attr_marker_index(name) {
                    attrs.push((index, PartPath::new(path, counts)));
                }
            }
            let child_count = element.children.len();
            for (index, child) in element.children.iter().enumerate() {
                path.push(index);
                counts.push(child_count);
                walk(child, path, counts, holes, attrs, strips);
                counts.pop();
                path.pop();
            }
        }
        ModelNode::Text(_) => {}
        ModelNode::Comment { hole_index } => {
            holes.push((*hole_index, PartPath::new(path, counts)));
        }
    }
}

fn attr_marker_index(name: &str) -> Option<usize> {
    let digits = name.strip_prefix(ATTR_MARKER)?;
    if digits.is_empty() {
        return None;
    }
    digits.parse().ok()
}

fn is_refused_tag(tag: &str) -> bool {
    let tag = tag.to_ascii_lowercase();
    METADATA_TAGS.contains(&tag.as_str()) || RISKY_TAGS.contains(&tag.as_str())
}

fn refuses_plan(node: &ModelNode) -> bool {
    match node {
        ModelNode::Element(element) => {
            is_refused_tag(&element.tag) || element.children.iter().any(refuses_plan)
        }
        ModelNode::Text(_) | ModelNode::Comment { .. } => false,
    }
}

fn object_expr(props: Vec<(&str, Expr)>) -> Expr {
    Expr::Object(ObjectLit {
        span: DUMMY_SP,
        props: props
            .into_iter()
            .map(|(name, value)| {
                PropOrSpread::Prop(Box::new(Prop::KeyValue(KeyValueProp {
                    key: PropName::Ident(IdentName::new(name.into(), DUMMY_SP)),
                    value: Box::new(value),
                })))
            })
            .collect(),
    })
}

fn array_expr(elements: Vec<Expr>) -> Expr {
    Expr::Array(ArrayLit {
        span: DUMMY_SP,
        elems: elements
            .into_iter()
            .map(|expr| {
                Some(ExprOrSpread {
                    spread: None,
                    expr: Box::new(expr),
                })
            })
            .collect(),
    })
}

fn number_array(values: Vec<usize>) -> Expr {
    array_expr(values.into_iter().map(number_expr).collect())
}

fn string_array(values: Vec<String>) -> Expr {
    array_expr(
        values
            .into_iter()
            .map(|value| string_expr(&value))
            .collect(),
    )
}

fn number_expr(value: usize) -> Expr {
    Expr::Lit(Lit::Num(Number {
        span: DUMMY_SP,
        value: value as f64,
        raw: None,
    }))
}
