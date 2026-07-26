use std::path::{Component, Path, PathBuf};

use super::{WorkspaceError, WorkspaceResult};

pub fn canonical_root(root: &Path) -> WorkspaceResult<PathBuf> {
    let canonical = root.canonicalize().map_err(|_| {
        WorkspaceError::new(
            "workspace_root_missing",
            "The selected workspace root is no longer available.",
        )
    })?;
    if !canonical.is_dir() {
        return Err(WorkspaceError::new(
            "workspace_root_invalid",
            "The selected workspace root is not a directory.",
        ));
    }
    Ok(canonical)
}

pub fn validate_relative(relative: &str) -> WorkspaceResult<PathBuf> {
    if relative.is_empty() || relative.contains('\0') || relative.contains('\\') {
        return Err(invalid_relative_path());
    }

    let path = Path::new(relative);
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(invalid_relative_path());
    }

    Ok(path.to_path_buf())
}

#[cfg(test)]
pub fn resolve_existing(root: &Path, relative: &str) -> WorkspaceResult<PathBuf> {
    let fresh_root = canonical_root(root)?;
    let candidate = fresh_root.join(validate_relative(relative)?);
    let resolved = candidate.canonicalize().map_err(|_| {
        WorkspaceError::new(
            "path_not_found",
            "The requested workspace path does not exist.",
        )
    })?;
    if !resolved.starts_with(&fresh_root) {
        return Err(WorkspaceError::new(
            "path_outside_workspace",
            "The requested path resolves outside the selected workspace.",
        ));
    }
    Ok(resolved)
}

pub fn normalize_relative(root: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(root).ok()?;
    if relative.as_os_str().is_empty() {
        return None;
    }
    let components: Option<Vec<String>> = relative
        .components()
        .map(|component| match component {
            Component::Normal(value) => value.to_str().map(ToOwned::to_owned),
            _ => None,
        })
        .collect();
    components.map(|parts| parts.join("/"))
}

fn invalid_relative_path() -> WorkspaceError {
    WorkspaceError::new(
        "invalid_relative_path",
        "A normalized, non-empty relative workspace path is required.",
    )
}
