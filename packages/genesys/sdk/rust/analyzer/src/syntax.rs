use std::collections::{BTreeMap, BTreeSet};
use syn::{Attribute, Meta, UseTree};

pub(crate) fn last_segment(path: &syn::Path) -> String {
    path.segments
        .last()
        .map(|s| s.ident.to_string())
        .unwrap_or_default()
}
pub(crate) fn is_conditional(attrs: &[Attribute]) -> bool {
    attrs
        .iter()
        .any(|a| a.path().is_ident("cfg") || a.path().is_ident("cfg_attr"))
}
pub(crate) fn has_custom_attributes(attrs: &[Attribute], native: &[&str]) -> bool {
    attrs.iter().any(|a| {
        let name = last_segment(a.path());
        !native.contains(&name.as_str())
            && ![
                "cfg",
                "cfg_attr",
                "path",
                "doc",
                "allow",
                "expect",
                "warn",
                "deny",
                "forbid",
                "deprecated",
                "inline",
                "cold",
                "must_use",
                "track_caller",
                "automatically_derived",
            ]
            .contains(&name.as_str())
    })
}
pub(crate) fn collect_import_aliases(
    tree: &UseTree,
    prefix: &str,
    aliases: &mut BTreeMap<String, String>,
) {
    match tree {
        UseTree::Path(p) => {
            collect_import_aliases(&p.tree, &format!("{prefix}{}::", p.ident), aliases)
        }
        UseTree::Name(n) => {
            aliases.insert(n.ident.to_string(), format!("{prefix}{}", n.ident));
        }
        UseTree::Rename(n) => {
            aliases.insert(n.rename.to_string(), format!("{prefix}{}", n.ident));
        }
        UseTree::Group(g) => {
            for item in &g.items {
                collect_import_aliases(item, prefix, aliases);
            }
        }
        UseTree::Glob(_) => {
            aliases.insert(format!("{prefix}*"), format!("{prefix}*"));
        }
    }
}
pub(crate) fn native_attribute<'a>(
    attrs: &'a [Attribute],
    name: &str,
    aliases: &BTreeMap<String, String>,
    crates: &BTreeSet<String>,
) -> Option<&'a Attribute> {
    attrs.iter().find(|a| {
        let mut parts: Vec<String> = a
            .path()
            .segments
            .iter()
            .map(|s| s.ident.to_string())
            .collect();
        if parts.len() == 1 {
            if let Some(resolved) = aliases.get(&parts[0]) {
                parts = resolved.split("::").map(String::from).collect();
            } else if parts[0] == name
                && crates
                    .iter()
                    .any(|c| aliases.contains_key(&format!("{c}::*")))
            {
                return true;
            }
        } else if let Some(resolved) = aliases.get(&parts[0]) {
            let mut p: Vec<String> = resolved.split("::").map(String::from).collect();
            p.extend(parts.into_iter().skip(1));
            parts = p;
        }
        parts.last().is_some_and(|p| p == name) && parts.first().is_some_and(|p| crates.contains(p))
    })
}
pub(crate) fn method_attribute<'a>(attrs: &'a [Attribute], name: &str) -> Option<&'a Attribute> {
    attrs.iter().find(|a| a.path().is_ident(name))
}
pub(crate) fn registration_name(attr: &Attribute, default: &str) -> Result<String, String> {
    if matches!(attr.meta, Meta::Path(_)) {
        return Ok(default.to_owned());
    }
    let mut name = default.to_owned();
    attr.parse_nested_meta(|meta| {
        if meta.path.is_ident("name") {
            name = meta.value()?.parse::<syn::LitStr>()?.value();
        } else if meta.path.is_ident("definition") {
            return Err(meta.error("identity comes from a separate ActivityDefinition"));
        } else if meta.input.peek(syn::Token![=]) {
            let _: syn::Expr = meta.value()?.parse()?;
        }
        Ok(())
    })
    .map_err(|e| format!("Native name is unresolved: {e}"))?;
    Ok(name)
}
