use quote::ToTokens;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::io::{self, Read};
use std::path::{Component, Path, PathBuf};
use syn::{Attribute, ImplItem, Item, Meta, Type, UseTree};

#[derive(Deserialize)]
struct Input {
    root: String,
    sources: BTreeMap<String, String>,
    entries: BTreeMap<String, String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Definition {
    path: String,
    line: usize,
    kind: String,
    symbol: String,
    name: Option<String>,
    target: String,
    module: String,
    implementer: String,
    factory: bool,
    eligible: bool,
}
#[derive(Serialize)]
struct Diagnostic {
    code: String,
    severity: &'static str,
    path: String,
    message: String,
}
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Target {
    name: String,
    path: String,
    kind: &'static str,
    required_features: Vec<String>,
}
#[derive(Serialize, Default)]
struct Output {
    definitions: Vec<Definition>,
    diagnostics: Vec<Diagnostic>,
    targets: Vec<Target>,
    sdk: Option<String>,
}
struct Analyzer {
    input: Input,
    output: Output,
    macro_crates: BTreeSet<String>,
    seen: BTreeSet<(String, String, String)>,
    active: BTreeSet<(String, String)>,
}
fn normalized(path: impl AsRef<Path>) -> String {
    let mut result = PathBuf::new();
    for part in path.as_ref().components() {
        match part {
            Component::CurDir => {}
            Component::ParentDir => {
                if result.file_name().is_some_and(|p| p != "..") {
                    result.pop();
                } else if !result.has_root() {
                    result.push("..");
                }
            }
            _ => result.push(part.as_os_str()),
        }
    }
    result.to_string_lossy().replace('\\', "/")
}
fn join(a: &str, b: &str) -> String {
    normalized(Path::new(a).join(b))
}
fn parent(path: &str) -> String {
    normalized(Path::new(path).parent().unwrap_or(Path::new("")))
}
fn last(path: &syn::Path) -> String {
    path.segments
        .last()
        .map(|s| s.ident.to_string())
        .unwrap_or_default()
}
fn cfg(attrs: &[Attribute]) -> bool {
    attrs
        .iter()
        .any(|a| a.path().is_ident("cfg") || a.path().is_ident("cfg_attr"))
}
fn custom_attrs(attrs: &[Attribute], native: &[&str]) -> bool {
    attrs.iter().any(|a| {
        let name = last(a.path());
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
fn use_paths(tree: &UseTree, prefix: &str, aliases: &mut BTreeMap<String, String>) {
    match tree {
        UseTree::Path(p) => use_paths(&p.tree, &format!("{prefix}{}::", p.ident), aliases),
        UseTree::Name(n) => {
            aliases.insert(n.ident.to_string(), format!("{prefix}{}", n.ident));
        }
        UseTree::Rename(n) => {
            aliases.insert(n.rename.to_string(), format!("{prefix}{}", n.ident));
        }
        UseTree::Group(g) => {
            for item in &g.items {
                use_paths(item, prefix, aliases);
            }
        }
        UseTree::Glob(_) => {
            aliases.insert(format!("{prefix}*"), format!("{prefix}*"));
        }
    }
}
fn native_attr<'a>(
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
fn marker<'a>(attrs: &'a [Attribute], name: &str) -> Option<&'a Attribute> {
    attrs.iter().find(|a| a.path().is_ident(name))
}
fn native_name(attr: &Attribute, default: &str) -> Result<String, String> {
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
impl Analyzer {
    fn diag(&mut self, code: &str, severity: &'static str, path: &str, message: impl Into<String>) {
        self.output.diagnostics.push(Diagnostic {
            code: format!("rust.{code}"),
            severity,
            path: path.into(),
            message: message.into(),
        });
    }
    fn file(
        &mut self,
        path: &str,
        target: &str,
        module: &str,
        module_dir: &str,
        conditional: bool,
    ) {
        if !self
            .seen
            .insert((target.into(), module.into(), path.into()))
        {
            return;
        }
        if !self.active.insert((target.into(), path.into())) {
            self.diag(
                "module-cycle",
                "error",
                path,
                "Rust module path forms a recursive source inclusion.",
            );
            return;
        }
        let Some(source) = self.input.sources.get(path) else {
            self.diag(
                "module-missing",
                "warning",
                path,
                "Native module source is unavailable. Preserve authored assembly.",
            );
            self.active.remove(&(target.into(), path.into()));
            return;
        };
        match syn::parse_file(source) {
            Ok(file) => self.items(
                &file.items,
                path,
                target,
                module,
                module_dir,
                conditional || cfg(&file.attrs),
                false,
            ),
            Err(e) => self.diag(
                "parse",
                "error",
                path,
                format!(
                    "Cannot parse Rust source at line {}: {e}",
                    e.span().start().line
                ),
            ),
        }
        self.active.remove(&(target.into(), path.into()));
    }
    fn items(
        &mut self,
        items: &[Item],
        path: &str,
        target: &str,
        module: &str,
        module_dir: &str,
        conditional: bool,
        inline: bool,
    ) {
        let mut aliases = BTreeMap::new();
        for item in items {
            if let Item::Use(u) = item {
                if !cfg(&u.attrs) {
                    use_paths(&u.tree, "", &mut aliases);
                }
            }
        }
        for item in items {
            match item {
                Item::Mod(m) => {
                    let child = if module.is_empty() {
                        m.ident.to_string()
                    } else {
                        format!("{module}::{}", m.ident)
                    };
                    let child_conditional =
                        conditional || cfg(&m.attrs) || custom_attrs(&m.attrs, &[]);
                    if custom_attrs(&m.attrs, &[]) {
                        self.diag("module-attribute", "warning", path, "A custom module attribute can change source inclusion. Definitions remain candidates for authored native assembly.");
                    }
                    let explicit = m.attrs.iter().find_map(|a| {
                        if a.path().is_ident("path") {
                            if let Meta::NameValue(v) = &a.meta {
                                if let syn::Expr::Lit(l) = &v.value {
                                    if let syn::Lit::Str(s) = &l.lit {
                                        return Some(s.value());
                                    }
                                }
                            }
                        }
                        None
                    });
                    let path_base = if inline {
                        module_dir.to_owned()
                    } else {
                        parent(path)
                    };
                    if let Some((_, content)) = &m.content {
                        let child_dir = explicit
                            .as_ref()
                            .map(|p| join(&path_base, p))
                            .unwrap_or_else(|| join(module_dir, &m.ident.to_string()));
                        self.items(
                            content,
                            path,
                            target,
                            &child,
                            &child_dir,
                            child_conditional,
                            true,
                        );
                    } else {
                        let candidates = if let Some(p) = &explicit {
                            vec![join(&path_base, p)]
                        } else {
                            vec![
                                join(module_dir, &format!("{}.rs", m.ident)),
                                join(module_dir, &format!("{}/mod.rs", m.ident)),
                            ]
                        };
                        let found: Vec<_> = candidates
                            .iter()
                            .filter(|p| self.input.sources.contains_key(*p))
                            .collect();
                        if found.len() != 1 {
                            self.diag("module-unresolved", "warning", path, format!("Module {child} has {} available source candidates; no path was guessed.", found.len()));
                            continue;
                        }
                        let source_path = found[0];
                        let next_dir = if explicit.is_some() || source_path.ends_with("/mod.rs") {
                            parent(source_path)
                        } else {
                            normalized(Path::new(source_path).with_extension(""))
                        };
                        self.file(source_path, target, &child, &next_dir, child_conditional);
                    }
                }
                Item::Impl(i) => {
                    let activity =
                        native_attr(&i.attrs, "activities", &aliases, &self.macro_crates);
                    let workflow =
                        native_attr(&i.attrs, "workflow_methods", &aliases, &self.macro_crates);
                    if activity.is_none() && workflow.is_none() {
                        if i.attrs.iter().any(|a| {
                            ["activities", "workflow_methods"].contains(&last(a.path()).as_str())
                        }) {
                            self.diag("macro-unresolved", "warning", path, "Temporal-like macro import is unresolved. Reexports and macro-generated definitions retain authored native assembly.");
                        }
                        if native_attr(
                            &i.attrs,
                            "activity_definitions",
                            &aliases,
                            &self.macro_crates,
                        )
                        .is_some()
                        {
                            self.diag("activity-caller", "info", path, "activity_definitions declares callable types only; it is not an Activity implementation.");
                        }
                        continue;
                    }
                    let Type::Path(tp) = i.self_ty.as_ref() else {
                        self.diag(
                            "implementer-unresolved",
                            "warning",
                            path,
                            "Non-path implementer requires authored assembly.",
                        );
                        continue;
                    };
                    let implementer = tp.to_token_stream().to_string();
                    let generic = !i.generics.params.is_empty()
                        || tp
                            .path
                            .segments
                            .iter()
                            .any(|s| !matches!(s.arguments, syn::PathArguments::None));
                    let native_attrs: Vec<_> = activity
                        .into_iter()
                        .chain(workflow)
                        .map(|a| last(a.path()))
                        .collect();
                    let native_names: Vec<_> = native_attrs.iter().map(String::as_str).collect();
                    let mut eligible = !conditional
                        && !cfg(&i.attrs)
                        && !generic
                        && i.trait_.is_none()
                        && !custom_attrs(&i.attrs, &native_names);
                    if !eligible {
                        self.diag("assembly-required", "warning", path, "Conditional, generic, trait, or custom-attribute implementations require authored native assembly; no feature values, macro expansions, or type arguments are invented.");
                    }
                    let factory = workflow.is_some_and(|a| matches!(&a.meta, Meta::List(l) if l.tokens.to_string().split_whitespace().any(|s| s == "factory_only")));
                    let methods: Vec<_> = i
                        .items
                        .iter()
                        .filter_map(|it| {
                            if let ImplItem::Fn(f) = it {
                                Some(f)
                            } else {
                                None
                            }
                        })
                        .collect();
                    if workflow.is_some()
                        && methods
                            .iter()
                            .filter(|f| marker(&f.attrs, "run").is_some())
                            .count()
                            != 1
                    {
                        self.diag(
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
                        let Some(attr) = marker(
                            &method.attrs,
                            if kind == "activity" {
                                "activity"
                            } else {
                                "run"
                            },
                        ) else {
                            continue;
                        };
                        if !self.input.entries.contains_key(path) {
                            continue;
                        }
                        let default = if kind == "workflow" {
                            last(&tp.path)
                        } else {
                            format!("{}::{}", last(&tp.path), method.sig.ident)
                        };
                        let name = match native_name(attr, &default) {
                            Ok(n) => Some(n),
                            Err(e) => {
                                self.diag("name-unresolved", "warning", path, e);
                                None
                            }
                        };
                        let symbol = if module.is_empty() {
                            implementer.clone()
                        } else {
                            format!("{module}::{implementer}")
                        };
                        self.output.definitions.push(Definition {
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
                            eligible: eligible && !cfg(&method.attrs),
                        });
                        if cfg(&method.attrs) {
                            self.diag(
                                "conditional-method",
                                "warning",
                                path,
                                "Conditional native method requires authored assembly.",
                            );
                        }
                    }
                }
                Item::Macro(m) => {
                    if self.input.entries.contains_key(path)
                        && !m.mac.tokens.to_string().contains("/.gsys/compile/rust/")
                    {
                        self.diag("macro-expansion", "warning", path, "Item macro expansion is not executed. Definitions produced by macros require authored assembly.");
                    }
                }
                _ => {}
            }
        }
    }
    fn analyze(mut self) -> Result<Output, String> {
        let manifest_path = join(&self.input.root, "Cargo.toml");
        let manifest: toml::Value = self
            .input
            .sources
            .get(&manifest_path)
            .ok_or("Cargo.toml is unavailable")?
            .parse()
            .map_err(|e| format!("Invalid Cargo.toml: {e}"))?;
        let Some(package) = manifest.get("package") else {
            self.diag(
                "workspace-only",
                "info",
                &manifest_path,
                "Workspace manifest has no package. Analyze member package contexts separately.",
            );
            return Ok(self.output);
        };
        let name = package
            .get("name")
            .and_then(|v| v.as_str())
            .ok_or("Cargo package name is unavailable")?
            .to_owned();
        if let Some(table) = manifest.get("dependencies") {
            if let Some(deps) = table.as_table() {
                for (alias, spec) in deps {
                    let native = spec
                        .get("package")
                        .and_then(|v| v.as_str())
                        .unwrap_or(alias);
                    if native == "temporalio-macros" || native == "temporalio-sdk" {
                        self.macro_crates.insert(alias.replace('-', "_"));
                    }
                    if native == "temporalio-sdk" {
                        self.output.sdk = spec.as_str().map(String::from).or_else(|| {
                            spec.get("version")
                                .and_then(|v| v.as_str())
                                .map(String::from)
                        });
                    }
                }
            }
        }
        if self.macro_crates.is_empty() {
            self.diag("sdk-unresolved", "warning", &manifest_path, "Native Temporal dependency provenance is unresolved (including inherited or target-specific dependencies). Preserve explicit native assembly.");
        }
        let lib_path = manifest
            .get("lib")
            .and_then(|v| v.get("path"))
            .and_then(|v| v.as_str())
            .unwrap_or("src/lib.rs");
        if (manifest.get("lib").is_some()
            || package.get("autolib").and_then(|v| v.as_bool()) != Some(false))
            && self
                .input
                .sources
                .contains_key(&join(&self.input.root, lib_path))
        {
            self.output.targets.push(Target {
                name: manifest
                    .get("lib")
                    .and_then(|v| v.get("name"))
                    .and_then(|v| v.as_str())
                    .unwrap_or(&name)
                    .replace('-', "_"),
                path: join(&self.input.root, lib_path),
                kind: "lib",
                required_features: vec![],
            });
        }
        if let Some(bins) = manifest.get("bin").and_then(|v| v.as_array()) {
            for bin in bins {
                let bin_name = bin
                    .get("name")
                    .and_then(|v| v.as_str())
                    .ok_or("[[bin]] requires its native name")?;
                let p = bin
                    .get("path")
                    .and_then(|v| v.as_str())
                    .map(String::from)
                    .unwrap_or_else(|| {
                        if bin_name == name
                            && self
                                .input
                                .sources
                                .contains_key(&join(&self.input.root, "src/main.rs"))
                        {
                            "src/main.rs".into()
                        } else if self.input.sources.contains_key(&join(
                            &self.input.root,
                            &format!("src/bin/{bin_name}.rs"),
                        )) {
                            format!("src/bin/{bin_name}.rs")
                        } else {
                            format!("src/bin/{bin_name}/main.rs")
                        }
                    });
                self.output.targets.push(Target {
                    name: bin_name.into(),
                    path: join(&self.input.root, &p),
                    kind: "bin",
                    required_features: bin
                        .get("required-features")
                        .and_then(|v| v.as_array())
                        .map(|a| {
                            a.iter()
                                .filter_map(|v| v.as_str().map(String::from))
                                .collect()
                        })
                        .unwrap_or_default(),
                });
            }
        }
        let edition = package
            .get("edition")
            .and_then(|v| v.as_str())
            .unwrap_or("2015");
        let auto_bins = package
            .get("autobins")
            .and_then(|v| v.as_bool())
            .unwrap_or(edition != "2015" || manifest.get("bin").is_none());
        if auto_bins {
            let main = join(&self.input.root, "src/main.rs");
            if self.input.sources.contains_key(&main)
                && !self
                    .output
                    .targets
                    .iter()
                    .any(|t| t.kind == "bin" && t.name == name)
            {
                self.output.targets.push(Target {
                    name: name.clone(),
                    path: main,
                    kind: "bin",
                    required_features: vec![],
                });
            }
            let prefix = format!("{}/", join(&self.input.root, "src/bin"));
            for path in self.input.sources.keys() {
                if let Some(tail) = path.strip_prefix(&prefix) {
                    let bin = if !tail.contains('/') && tail.ends_with(".rs") {
                        Some(tail.trim_end_matches(".rs"))
                    } else {
                        tail.strip_suffix("/main.rs").filter(|p| !p.contains('/'))
                    };
                    if let Some(n) = bin {
                        if !self
                            .output
                            .targets
                            .iter()
                            .any(|t| t.kind == "bin" && t.name == n)
                        {
                            self.output.targets.push(Target {
                                name: n.into(),
                                path: path.clone(),
                                kind: "bin",
                                required_features: vec![],
                            });
                        }
                    }
                }
            }
        }
        for target in self.output.targets.clone() {
            self.file(
                &target.path,
                &format!("{}:{}", target.kind, target.name),
                "",
                &parent(&target.path),
                !target.required_features.is_empty(),
            );
        }
        for (path, role) in self.input.entries.clone() {
            if role == "nexus" {
                self.diag("nexus-handler-unsupported", "warning", &path, "temporalio-sdk 1.2.0 supports Nexus operation callers, but has no public Nexus service handler registration API. Caller operations are not service definitions.");
            }
            if !self.seen.iter().any(|(_, _, p)| p == &path) {
                self.diag("source-not-in-target", "warning", &path, "Source is not resolved in a Cargo target module graph. Definitions are recorded without generated registration; preserve authored native assembly.");
                self.file(&path, "unresolved", "", &parent(&path), true);
            }
        }
        for (path, role) in self.input.entries.clone() {
            if role != "worker"
                && role != "nexus"
                && !self.output.definitions.iter().any(|d| d.path == path)
            {
                self.diag("no-static-implementation", "warning", &path, "No native Workflow or Activity implementation was statically resolved in this entry. Reexports, custom attributes, generated code, and explicit registration remain authored native assembly; an empty result does not prove their absence.");
            }
        }
        Ok(self.output)
    }
}
fn main() {
    let result = (|| -> Result<Output, String> {
        let mut text = String::new();
        io::stdin()
            .read_to_string(&mut text)
            .map_err(|e| e.to_string())?;
        let input = serde_json::from_str(&text).map_err(|e| e.to_string())?;
        Analyzer {
            input,
            output: Output::default(),
            macro_crates: BTreeSet::new(),
            seen: BTreeSet::new(),
            active: BTreeSet::new(),
        }
        .analyze()
    })();
    match result {
        Ok(output) => println!("{}", serde_json::to_string(&output).unwrap()),
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}
