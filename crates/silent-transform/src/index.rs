use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Index {
    #[serde(default)]
    pub interfaces: HashMap<String, Vec<String>>,
    #[serde(default)]
    pub values: HashMap<String, Vec<String>>,
}

impl Index {
    pub fn implementations(&self, token: &str) -> Option<&Vec<String>> {
        self.interfaces.get(token)
    }

    pub fn has_value_export(&self, module: &str, name: &str) -> bool {
        self.values
            .get(module)
            .map(|values| values.iter().any(|value| value == name))
            .unwrap_or(false)
    }
}
