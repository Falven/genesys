use crate::model::{Definition, Diagnostic};
use crate::syntax::{
    has_custom_attributes, is_conditional, last_segment, method_attribute, native_attribute,
    registration_name,
};
use quote::ToTokens;
use std::collections::{BTreeMap, BTreeSet};
use syn::{ImplItem, ItemImpl, Meta, Type};

pub(crate) struct SourceScope<'a> {
    pub(crate) path: &'a str,
    pub(crate) target: &'a str,
    pub(crate) module: &'a str,
    pub(crate) conditional: bool,
    pub(crate) is_entry: bool,
}

#[derive(Default)]
pub(crate) struct DefinitionAnalysis {
    pub(crate) definitions: Vec<Definition>,
    pub(crate) diagnostics: Vec<Diagnostic>,
}

impl DefinitionAnalysis {
    fn report(
        &mut self,
        code: &str,
        severity: &'static str,
        path: &str,
        message: impl Into<String>,
    ) {
        self.diagnostics
            .push(Diagnostic::new(code, severity, path, message));
    }

    pub(crate) fn inspect(
        implementation: &ItemImpl,
        scope: SourceScope<'_>,
        aliases: &BTreeMap<String, String>,
        macro_crates: &BTreeSet<String>,
    ) -> Self {
        let mut result = Self::default();
        let SourceScope {
            path,
            target,
            module,
            ..
        } = scope;
        let activity = native_attribute(&implementation.attrs, "activities", aliases, macro_crates);
        let workflow = native_attribute(
            &implementation.attrs,
            "workflow_methods",
            aliases,
            macro_crates,
        );
        if activity.is_none() && workflow.is_none() {
            if implementation.attrs.iter().any(|a| {
                ["activities", "workflow_methods"].contains(&last_segment(a.path()).as_str())
            }) {
                result.report("macro-unresolved", "warning", path, "Temporal-like macro import is unresolved. Reexports and macro-generated definitions retain authored native assembly.");
            }
            if native_attribute(
                &implementation.attrs,
                "activity_definitions",
                aliases,
                macro_crates,
            )
            .is_some()
            {
                result.report("activity-caller", "info", path, "activity_definitions declares callable types only; item is not an Activity implementation.");
            }
            return result;
        }
        let Type::Path(implementer_type) = implementation.self_ty.as_ref() else {
            result.report(
                "implementer-unresolved",
                "warning",
                path,
                "Non-path implementer requires authored assembly.",
            );
            return result;
        };
        let implementer = implementer_type.to_token_stream().to_string();
        let generic = !implementation.generics.params.is_empty()
            || implementer_type
                .path
                .segments
                .iter()
                .any(|s| !matches!(s.arguments, syn::PathArguments::None));
        let native_attrs: Vec<_> = activity
            .into_iter()
            .chain(workflow)
            .map(|a| last_segment(a.path()))
            .collect();
        let native_names: Vec<_> = native_attrs.iter().map(String::as_str).collect();
        let mut eligible = !scope.conditional
            && !is_conditional(&implementation.attrs)
            && !generic
            && implementation.trait_.is_none()
            && !has_custom_attributes(&implementation.attrs, &native_names);
        if !eligible {
            result.report("assembly-required", "warning", path, "Conditional, generic, trait, or custom-attribute implementations require authored native assembly; no feature values, macro expansions, or type arguments are invented.");
        }
        let factory = workflow.is_some_and(|a| matches!(&a.meta, Meta::List(l) if l.tokens.to_string().split_whitespace().any(|s| s == "factory_only")));
        let methods: Vec<_> = implementation
            .items
            .iter()
            .filter_map(|item| {
                if let ImplItem::Fn(f) = item {
                    Some(f)
                } else {
                    None
                }
            })
            .collect();
        if workflow.is_some()
            && methods
                .iter()
                .filter(|f| method_attribute(&f.attrs, "run").is_some())
                .count()
                != 1
        {
            result.report(
                "workflow-run",
                "error",
                path,
                "workflow_methods must expose exactly one native #[run] method.",
            );
            eligible = false;
        }
        for method in methods {
            let kind = if activity.is_some() {
                "activity"
            } else {
                "workflow"
            };
            let Some(attr) = method_attribute(
                &method.attrs,
                if kind == "activity" {
                    "activity"
                } else {
                    "run"
                },
            ) else {
                continue;
            };
            if !scope.is_entry {
                continue;
            }
            let default = if kind == "workflow" {
                last_segment(&implementer_type.path)
            } else {
                format!(
                    "{}::{}",
                    last_segment(&implementer_type.path),
                    method.sig.ident
                )
            };
            let name = match registration_name(attr, &default) {
                Ok(n) => Some(n),
                Err(e) => {
                    result.report("name-unresolved", "warning", path, e);
                    None
                }
            };
            let symbol = if module.is_empty() {
                implementer.clone()
            } else {
                format!("{module}::{implementer}")
            };
            result.definitions.push(Definition {
                path: path.into(),
                line: method.sig.ident.span().start().line,
                kind: kind.into(),
                symbol: if kind == "activity" {
                    format!("{symbol}::{}", method.sig.ident)
                } else {
                    symbol
                },
                name,
                target: target.into(),
                module: module.into(),
                implementer: implementer.clone(),
                factory,
                eligible: eligible && !is_conditional(&method.attrs),
            });
            if is_conditional(&method.attrs) {
                result.report(
                    "conditional-method",
                    "warning",
                    path,
                    "Conditional native method requires authored assembly.",
                );
            }
        }
        result
    }
}
