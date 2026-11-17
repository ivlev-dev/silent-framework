use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AliasRule {
    pub find: String,
    pub replacement: String,
}

fn apply_rule(rule: &AliasRule, source: &str) -> Option<String> {
    let find = rule.find.as_str();
    if let Some(star) = find.find('*') {
        let prefix = &find[..star];
        let suffix = &find[star + 1..];
        if source.len() < prefix.len() + suffix.len() {
            return None;
        }
        if !source.starts_with(prefix) || !source.ends_with(suffix) {
            return None;
        }
        let middle = &source[prefix.len()..source.len() - suffix.len()];
        return Some(rule.replacement.replace('*', middle));
    }
    (source == find).then(|| rule.replacement.clone())
}

fn match_len(rule: &AliasRule) -> usize {
    rule.find.find('*').unwrap_or(rule.find.len())
}

pub fn resolve_alias(source: &str, aliases: &[AliasRule]) -> Option<String> {
    let mut best: Option<(&AliasRule, String)> = None;
    for rule in aliases {
        let Some(target) = apply_rule(rule, source) else {
            continue;
        };
        let length = match_len(rule);
        match &best {
            Some((current, _)) if match_len(current) >= length => {}
            _ => best = Some((rule, target)),
        }
    }
    best.map(|(_, target)| target)
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct AliasConfig {
    #[serde(default)]
    pub aliases: Vec<AliasRule>,
}
