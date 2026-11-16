use crate::definitions::{DefinitionAnalysis, SourceScope};
use crate::model::{Diagnostic, Input, Output};
use crate::package::Package;
use crate::paths::{join, normalized, parent};
use crate::syntax::{collect_import_aliases, has_custom_attributes, is_conditional};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use syn::{Item, Meta};

pub(crate) struct Analyzer {
    input: Input,
    output: Output,
    macro_crates: BTreeSet<String>,
    seen: BTreeSet<(String, String, String)>,
    active: BTreeSet<(String, String)>,
}
impl Analyzer {
    fn report(
        &mut self,
        code: &str,
        severity: &'static str,
        path: &str,
        message: impl Into<String>,
    ) {
        self.output
            .diagnostics
            .push(Diagnostic::new(code, severity, path, message));
    }
    fn inspect_file(
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
            self.report(
                "module-cycle",
                "error",
                path,
                "Rust module path forms a recursive source inclusion.",
            );
            return;
        }
        let Some(source) = self.input.sources.get(path) else {
            self.report(
                "module-missing",
                "warning",
                path,
                "Native module source is unavailable. Preserve authored assembly.",
            );
            self.active.remove(&(target.into(), path.into()));
            return;
        };
        match syn::parse_file(source) {
            Ok(file) => self.inspect_items(
                &file.items,
                path,
                target,
                module,
                module_dir,
                conditional || is_conditional(&file.attrs),
                false,
            ),
            Err(e) => self.report(
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
    fn inspect_items(
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
                if !is_conditional(&u.attrs) {
                    collect_import_aliases(&u.tree, "", &mut aliases);
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
                    let child_conditional = conditional
                        || is_conditional(&m.attrs)
                        || has_custom_attributes(&m.attrs, &[]);
                    if has_custom_attributes(&m.attrs, &[]) {
                        self.report("module-attribute", "warning", path, "A custom module attribute can change source inclusion. Definitions remain candidates for authored native assembly.");
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
                        self.inspect_items(
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
                            self.report("module-unresolved", "warning", path, format!("Module {child} has {} available source candidates; no path was guessed.", found.len()));
                            continue;
                        }
                        let source_path = found[0];
                        let next_dir = if explicit.is_some() || source_path.ends_with("/mod.rs") {
                            parent(source_path)
                        } else {
                            normalized(Path::new(source_path).with_extension(""))
                        };
                        self.inspect_file(
                            source_path,
                            target,
                            &child,
                            &next_dir,
                            child_conditional,
                        );
                    }
                }
                Item::Impl(implementation) => {
                    let definitions = DefinitionAnalysis::inspect(
                        implementation,
                        SourceScope {
                            path,
                            target,
                            module,
                            conditional,
                            is_entry: self.input.entries.contains_key(path),
                        },
                        &aliases,
                        &self.macro_crates,
                    );
                    self.output.definitions.extend(definitions.definitions);
                    self.output.diagnostics.extend(definitions.diagnostics);
                }
                Item::Macro(m) => {
                    if self.input.entries.contains_key(path)
                        && !m.mac.tokens.to_string().contains("/.gsys/compile/rust/")
                    {
                        self.report("macro-expansion", "warning", path, "Item macro expansion is not executed. Definitions produced by macros require authored assembly.");
                    }
                }
                _ => {}
            }
        }
    }
    pub(crate) fn analyze(input: Input) -> Result<Output, String> {
        let Some(package) = Package::inspect(&input)? else {
            return Ok(Output { diagnostics: vec![Diagnostic::new("workspace-only", "info", &join(&input.root, "Cargo.toml"), "Workspace manifest has no package. Analyze member package contexts separately.")], ..Output::default() });
        };
        let analyzer = Self {
            input,
            output: Output {
                package_name: Some(package.name),
                targets: package.targets,
                sdk: package.sdk,
                diagnostics: package.diagnostics,
                ..Output::default()
            },
            macro_crates: package.macro_crates,
            seen: BTreeSet::new(),
            active: BTreeSet::new(),
        };
        Ok(analyzer.collect())
    }

    fn collect(mut self) -> Output {
        for target in self.output.targets.clone() {
            self.inspect_file(
                &target.path,
                &format!("{}:{}", target.kind, target.name),
                "",
                &parent(&target.path),
                !target.required_features.is_empty(),
            );
        }
        for (path, role) in self.input.entries.clone() {
            if role == "nexus" {
                self.report("nexus-handler-unsupported", "warning", &path, "temporalio-sdk 1.2.0 supports Nexus operation callers, but has no public Nexus service handler registration API. Caller operations are not service definitions.");
            }
            if !self.seen.iter().any(|(_, _, p)| p == &path) {
                self.report("source-not-in-target", "warning", &path, "Source is not resolved in a Cargo target module graph. Definitions are recorded without generated registration; preserve authored native assembly.");
                self.inspect_file(&path, "unresolved", "", &parent(&path), true);
            }
        }
        for (path, role) in self.input.entries.clone() {
            if role != "worker"
                && role != "nexus"
                && !self.output.definitions.iter().any(|d| d.path == path)
            {
                self.report("no-static-implementation", "warning", &path, "No native Workflow or Activity implementation was statically resolved in this entry. Reexports, custom attributes, generated code, and explicit registration remain authored native assembly; an empty result does not prove their absence.");
            }
        }
        self.output
    }
}
