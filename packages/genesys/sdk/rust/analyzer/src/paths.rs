use std::path::{Component, Path, PathBuf};

pub(crate) fn normalized(path: impl AsRef<Path>) -> String {
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
pub(crate) fn join(a: &str, b: &str) -> String {
    normalized(Path::new(a).join(b))
}
pub(crate) fn parent(path: &str) -> String {
    normalized(Path::new(path).parent().unwrap_or(Path::new("")))
}
