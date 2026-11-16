use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Deserialize)]
pub(crate) struct Input {
    pub(crate) root: String,
    pub(crate) sources: BTreeMap<String, String>,
    pub(crate) entries: BTreeMap<String, String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Definition {
    pub(crate) path: String,
    pub(crate) line: usize,
    pub(crate) kind: String,
    pub(crate) symbol: String,
    pub(crate) name: Option<String>,
    pub(crate) target: String,
    pub(crate) module: String,
    pub(crate) implementer: String,
    pub(crate) factory: bool,
    pub(crate) eligible: bool,
}
#[derive(Serialize)]
pub(crate) struct Diagnostic {
    pub(crate) code: String,
    pub(crate) severity: &'static str,
    pub(crate) path: String,
    pub(crate) message: String,
}
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Target {
    pub(crate) name: String,
    pub(crate) path: String,
    pub(crate) kind: &'static str,
    pub(crate) required_features: Vec<String>,
}
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Output {
    pub(crate) package_name: Option<String>,
    pub(crate) definitions: Vec<Definition>,
    pub(crate) diagnostics: Vec<Diagnostic>,
    pub(crate) targets: Vec<Target>,
    pub(crate) sdk: Option<String>,
}
impl Diagnostic {
    pub(crate) fn new(
        code: &str,
        severity: &'static str,
        path: &str,
        message: impl Into<String>,
    ) -> Self {
        Self {
            code: format!("rust.{code}"),
            severity,
            path: path.into(),
            message: message.into(),
        }
    }
}
