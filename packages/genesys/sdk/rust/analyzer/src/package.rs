use crate::model::{Diagnostic, Input, Target};
use crate::paths::join;
use std::collections::BTreeSet;

#[derive(Default)]
pub(crate) struct Package {
    pub(crate) name: String,
    pub(crate) targets: Vec<Target>,
    pub(crate) macro_crates: BTreeSet<String>,
    pub(crate) sdk: Option<String>,
    pub(crate) diagnostics: Vec<Diagnostic>,
}

impl Package {
    pub(crate) fn inspect(input: &Input) -> Result<Option<Self>, String> {
        let manifest_path = join(&input.root, "Cargo.toml");
        let manifest: toml::Value = input
            .sources
            .get(&manifest_path)
            .ok_or("Cargo.toml is unavailable")?
            .parse()
            .map_err(|e| format!("Invalid Cargo.toml: {e}"))?;
        let Some(package) = manifest.get("package") else {
            return Ok(None);
        };
        let name = package
            .get("name")
            .and_then(|v| v.as_str())
            .ok_or("Cargo package name is unavailable")?
            .to_owned();
        let mut inspection = Self {
            name: name.clone(),
            ..Self::default()
        };
        if let Some(table) = manifest.get("dependencies") {
            if let Some(deps) = table.as_table() {
                for (alias, spec) in deps {
                    let native = spec
                        .get("package")
                        .and_then(|v| v.as_str())
                        .unwrap_or(alias);
                    if native == "temporalio-macros" || native == "temporalio-sdk" {
                        inspection.macro_crates.insert(alias.replace('-', "_"));
                    }
                    if native == "temporalio-sdk" {
                        inspection.sdk = spec.as_str().map(String::from).or_else(|| {
                            spec.get("version")
                                .and_then(|v| v.as_str())
                                .map(String::from)
                        });
                    }
                }
            }
        }
        if inspection.macro_crates.is_empty() {
            inspection.diagnostics.push(Diagnostic::new("sdk-unresolved", "warning", &manifest_path, "Native Temporal dependency provenance is unresolved (including inherited or target-specific dependencies). Preserve explicit native assembly."));
        }
        let lib_path = manifest
            .get("lib")
            .and_then(|v| v.get("path"))
            .and_then(|v| v.as_str())
            .unwrap_or("src/lib.rs");
        if (manifest.get("lib").is_some()
            || package.get("autolib").and_then(|v| v.as_bool()) != Some(false))
            && input.sources.contains_key(&join(&input.root, lib_path))
        {
            inspection.targets.push(Target {
                name: manifest
                    .get("lib")
                    .and_then(|v| v.get("name"))
                    .and_then(|v| v.as_str())
                    .unwrap_or(&name)
                    .replace('-', "_"),
                path: join(&input.root, lib_path),
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
                            && input
                                .sources
                                .contains_key(&join(&input.root, "src/main.rs"))
                        {
                            "src/main.rs".into()
                        } else if input
                            .sources
                            .contains_key(&join(&input.root, &format!("src/bin/{bin_name}.rs")))
                        {
                            format!("src/bin/{bin_name}.rs")
                        } else {
                            format!("src/bin/{bin_name}/main.rs")
                        }
                    });
                inspection.targets.push(Target {
                    name: bin_name.into(),
                    path: join(&input.root, &p),
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
            let main = join(&input.root, "src/main.rs");
            if input.sources.contains_key(&main)
                && !inspection
                    .targets
                    .iter()
                    .any(|t| t.kind == "bin" && t.name == name)
            {
                inspection.targets.push(Target {
                    name: name.clone(),
                    path: main,
                    kind: "bin",
                    required_features: vec![],
                });
            }
            let prefix = format!("{}/", join(&input.root, "src/bin"));
            for path in input.sources.keys() {
                if let Some(tail) = path.strip_prefix(&prefix) {
                    let bin = if !tail.contains('/') && tail.ends_with(".rs") {
                        Some(tail.trim_end_matches(".rs"))
                    } else {
                        tail.strip_suffix("/main.rs").filter(|p| !p.contains('/'))
                    };
                    if let Some(n) = bin {
                        if !inspection
                            .targets
                            .iter()
                            .any(|t| t.kind == "bin" && t.name == n)
                        {
                            inspection.targets.push(Target {
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
        Ok(Some(inspection))
    }
}
