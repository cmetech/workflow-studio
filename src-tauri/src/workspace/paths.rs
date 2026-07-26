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

pub fn resolve_existing(root: &Path, relative: &str) -> WorkspaceResult<PathBuf> {
    let lexical = resolve_existing_lexical(root, relative)?;
    let resolved = lexical.canonicalize().map_err(|_| {
        WorkspaceError::new(
            "path_not_found",
            "The requested workspace path does not exist.",
        )
    })?;
    ensure_contained(&canonical_root(root)?, &resolved)?;
    Ok(resolved)
}

pub fn resolve_existing_lexical(root: &Path, relative: &str) -> WorkspaceResult<PathBuf> {
    let fresh_root = canonical_root(root)?;
    let relative = validate_relative(relative)?;
    let candidate = fresh_root.join(relative);
    let resolved = candidate.canonicalize().map_err(|_| {
        WorkspaceError::new(
            "path_not_found",
            "The requested workspace path does not exist.",
        )
    })?;
    ensure_contained(&fresh_root, &resolved)?;
    Ok(candidate)
}

pub fn resolve_destination(root: &Path, relative: &str) -> WorkspaceResult<PathBuf> {
    let fresh_root = canonical_root(root)?;
    let relative = validate_relative(relative)?;
    let candidate = fresh_root.join(&relative);

    if candidate.symlink_metadata().is_ok() {
        let resolved = candidate.canonicalize().map_err(|_| {
            WorkspaceError::new(
                "path_not_found",
                "The requested workspace path cannot be resolved.",
            )
        })?;
        ensure_contained(&fresh_root, &resolved)?;
        return Ok(candidate);
    }

    let parent = candidate.parent().ok_or_else(invalid_relative_path)?;
    let resolved_parent = parent.canonicalize().map_err(|_| {
        WorkspaceError::new("parent_not_found", "The destination folder does not exist.")
    })?;
    ensure_contained(&fresh_root, &resolved_parent)?;
    Ok(candidate)
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

pub(super) fn ensure_contained(root: &Path, resolved: &Path) -> WorkspaceResult<()> {
    if !resolved.starts_with(root) {
        return Err(WorkspaceError::new(
            "path_outside_workspace",
            "The requested path resolves outside the selected workspace.",
        ));
    }
    Ok(())
}

fn invalid_relative_path() -> WorkspaceError {
    WorkspaceError::new(
        "invalid_relative_path",
        "A normalized, non-empty relative workspace path is required.",
    )
}
