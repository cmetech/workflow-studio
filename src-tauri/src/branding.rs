use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use cap_std::ambient_authority;
#[cfg(unix)]
use cap_std::fs::Permissions as CapPermissions;
use cap_std::fs::{Dir, File as CapFile, OpenOptions as CapOpenOptions};
use getrandom::fill as random_fill;
use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;
use same_file::Handle;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

const MAX_ASSET_BYTES: usize = 2 * 1024 * 1024;
const MAX_PACK_BYTES: usize = 8 * 1024 * 1024;
const MAX_PERSISTED_PACKS: usize = 16;
const MAX_PERSISTED_BYTES: u64 = 32 * 1024 * 1024;
const BUILTIN_BRAND_ID: &str = "loop24";
const ACTIVE_FILE: &str = "active-brand-v1.json";
const THEME_TOKEN_NAMES: [&str; 21] = [
    "background",
    "surface",
    "surface-elevated",
    "text",
    "text-muted",
    "accent",
    "accent-strong",
    "accent-contrast",
    "border",
    "focus",
    "success",
    "warning",
    "error",
    "canvas",
    "grid",
    "node",
    "node-selected",
    "edge",
    "edge-selected",
    "yaml-gutter",
    "shadow",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrandError {
    code: String,
    message: String,
}

type BrandResult<T> = Result<T, BrandError>;

impl BrandError {
    fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrandSourceSelection {
    grant_token: String,
    manifest_text: String,
    manifest_sha256: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrandSourceAsset {
    path: String,
    bytes: Vec<u8>,
    sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeBrandAssets {
    logo: String,
    mark: String,
    window_icon: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeBrandThemes {
    light: HashMap<String, String>,
    dark: HashMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeBrandManifest {
    schema_version: u8,
    id: String,
    display_name: String,
    assets: NativeBrandAssets,
    themes: NativeBrandThemes,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BrandImportAsset {
    path: String,
    source_sha256: String,
    media_type: String,
    sanitized_bytes: Vec<u8>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BrandImportRequest {
    grant_token: String,
    manifest: NativeBrandManifest,
    manifest_source_sha256: String,
    assets: Vec<BrandImportAsset>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedBrand {
    id: String,
    display_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowIconResult {
    status: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredBrandAsset {
    path: String,
    bytes: Vec<u8>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredBrandPack {
    manifest: NativeBrandManifest,
    assets: Vec<StoredBrandAsset>,
    revision: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrandPackListResult {
    packs: Vec<StoredBrandPack>,
    warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrandActiveLoadResult {
    id: String,
    pack: Option<StoredBrandPack>,
    recovered: bool,
    warning: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrandActivationResult {
    id: String,
    pack: Option<StoredBrandPack>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrandRemovalResult {
    active_id: String,
    removed: bool,
    warning: Option<String>,
}

#[derive(Default)]
pub struct BrandGrantState {
    grants: Mutex<HashMap<String, GrantedBrandSource>>,
}

struct GrantedBrandSource {
    source_parent: Dir,
    source_name: OsString,
    source_identity: Handle,
    parent: Dir,
    manifest_name: OsString,
    manifest_identity: Handle,
    manifest_sha256: String,
    source_manifest: Option<NativeBrandManifest>,
    authorized_paths: HashSet<String>,
    assets: HashMap<String, BoundBrandAsset>,
}

struct BoundBrandAsset {
    parent: Dir,
    name: OsString,
    identity: Handle,
    sha256: String,
}

struct BrandStorageScope {
    app_parent: Dir,
    app_name: OsString,
    app_identity: Handle,
    app: Dir,
    brands_identity: Handle,
    brands: Dir,
}

fn brand_error(code: &'static str, message: impl Into<String>) -> BrandError {
    BrandError::new(code, message)
}

fn io_error(code: &'static str, error: std::io::Error) -> BrandError {
    brand_error(code, format!("Brand operation failed: {error}"))
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn opaque_token() -> BrandResult<String> {
    let mut bytes = [0_u8; 32];
    random_fill(&mut bytes).map_err(|error| {
        brand_error(
            "brand_grant_failed",
            format!("A secure source grant could not be created: {error}"),
        )
    })?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn cap_file_identity(file: &CapFile, code: &'static str) -> BrandResult<Handle> {
    Handle::from_file(
        file.try_clone()
            .map_err(|error| io_error(code, error))?
            .into_std(),
    )
    .map_err(|error| io_error(code, error))
}

fn cap_directory_identity(directory: &Dir, code: &'static str) -> BrandResult<Handle> {
    Handle::from_file(
        directory
            .try_clone()
            .map_err(|error| io_error(code, error))?
            .into_std_file(),
    )
    .map_err(|error| io_error(code, error))
}

fn cap_named_file_identity(parent: &Dir, name: &Path, code: &'static str) -> BrandResult<Handle> {
    let metadata = parent
        .symlink_metadata(name)
        .map_err(|error| io_error(code, error))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(brand_error(
            code,
            "Brand source files must be regular files.",
        ));
    }
    cap_file_identity(
        &parent.open(name).map_err(|error| io_error(code, error))?,
        code,
    )
}

fn read_bounded_cap_file(
    parent: &Dir,
    name: &Path,
    code: &'static str,
) -> BrandResult<(Vec<u8>, Handle)> {
    let metadata = parent
        .symlink_metadata(name)
        .map_err(|error| io_error(code, error))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(brand_error(
            code,
            "Brand source files must be regular files.",
        ));
    }
    if metadata.len() as usize > MAX_ASSET_BYTES {
        return Err(brand_error(
            "brand_file_too_large",
            "Brand files cannot exceed 2 MiB.",
        ));
    }
    let mut file = parent.open(name).map_err(|error| io_error(code, error))?;
    let identity = cap_file_identity(&file, code)?;
    if cap_named_file_identity(parent, name, code)? != identity {
        return Err(brand_error(
            "brand_source_changed",
            "The selected brand source changed while it was opened.",
        ));
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    (&mut file)
        .take((MAX_ASSET_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| io_error(code, error))?;
    if bytes.len() > MAX_ASSET_BYTES {
        return Err(brand_error(
            "brand_file_too_large",
            "Brand files cannot exceed 2 MiB.",
        ));
    }
    if cap_named_file_identity(parent, name, code)? != identity {
        return Err(brand_error(
            "brand_source_changed",
            "The brand file name changed while its bytes were read.",
        ));
    }
    Ok((bytes, identity))
}

fn bind_relative_parent(
    root: &Dir,
    relative: &str,
    code: &'static str,
) -> BrandResult<(Dir, OsString)> {
    if !safe_asset_path(relative) {
        return Err(brand_error(
            "brand_asset_path_invalid",
            "Brand asset paths must be safe relative SVG or PNG paths.",
        ));
    }
    let relative_path = Path::new(relative);
    let name = relative_path
        .file_name()
        .ok_or_else(|| {
            brand_error(
                "brand_asset_path_invalid",
                "Brand asset path has no file name.",
            )
        })?
        .to_os_string();
    let mut current = root.try_clone().map_err(|error| io_error(code, error))?;
    if let Some(parent) = relative_path.parent() {
        for component in parent.components() {
            let Component::Normal(component_name) = component else {
                return Err(brand_error(
                    "brand_asset_path_invalid",
                    "Brand asset paths must remain inside the selected directory.",
                ));
            };
            let metadata = current.symlink_metadata(component_name).map_err(|_| {
                brand_error(
                    "brand_asset_missing",
                    format!("Brand asset {relative} is missing."),
                )
            })?;
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err(brand_error(
                    code,
                    "Brand source assets cannot traverse symbolic links or non-directories.",
                ));
            }
            let next = current
                .open_dir(component_name)
                .map_err(|error| io_error(code, error))?;
            let identity = cap_directory_identity(&next, code)?;
            let rebound = current
                .open_dir(component_name)
                .and_then(|directory| directory.try_clone().map(Dir::into_std_file))
                .ok()
                .and_then(|directory| Handle::from_file(directory).ok());
            if rebound.as_ref() != Some(&identity) {
                return Err(brand_error(
                    code,
                    "A brand source directory changed while it was bound.",
                ));
            }
            current = next;
        }
    }
    Ok((current, name))
}

fn safe_asset_path(path: &str) -> bool {
    if path.is_empty()
        || path.contains('\0')
        || path.contains('\\')
        || path.contains('%')
        || path.contains('?')
        || path.contains('#')
        || path.contains(':')
    {
        return false;
    }
    let value = Path::new(path);
    !value.is_absolute()
        && value
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
        && value
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| {
                matches!(extension.to_ascii_lowercase().as_str(), "svg" | "png")
            })
}

fn validate_brand_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        && !id.starts_with('-')
        && !id.ends_with('-')
}

fn source_color_component(value: &str) -> Option<u8> {
    if let Some(percent) = value.strip_suffix('%') {
        let percent: f64 = percent.parse().ok()?;
        return (percent.is_finite() && (0.0..=100.0).contains(&percent))
            .then(|| (percent * 255.0 / 100.0).round() as u8);
    }
    let number: f64 = value.parse().ok()?;
    (number.is_finite() && (0.0..=255.0).contains(&number)).then(|| number.round() as u8)
}

fn source_alpha_component(value: Option<&str>) -> Option<u8> {
    let Some(value) = value else { return Some(255) };
    if let Some(percent) = value.strip_suffix('%') {
        let percent: f64 = percent.parse().ok()?;
        return (percent.is_finite() && (0.0..=100.0).contains(&percent))
            .then(|| (percent * 255.0 / 100.0).round() as u8);
    }
    let number: f64 = value.parse().ok()?;
    (number.is_finite() && (0.0..=1.0).contains(&number)).then(|| (number * 255.0).round() as u8)
}

fn canonical_source_color(source: &str) -> Option<String> {
    let value = source.trim();
    if let Some(hex) = value.strip_prefix('#') {
        if !matches!(hex.len(), 3 | 4 | 6 | 8) || !hex.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return None;
        }
        let expanded = if hex.len() <= 4 {
            hex.chars()
                .flat_map(|digit| [digit, digit])
                .collect::<String>()
        } else {
            hex.to_owned()
        };
        let color = expanded.to_ascii_uppercase();
        return Some(if color.ends_with("FF") && color.len() == 8 {
            format!("#{}", &color[..6])
        } else {
            format!("#{color}")
        });
    }
    let lower = value.to_ascii_lowercase();
    let inner = lower
        .strip_prefix("rgb(")
        .or_else(|| lower.strip_prefix("rgba("))?
        .strip_suffix(')')?
        .trim();
    let (colors, slash_alpha) = inner
        .split_once('/')
        .map_or((inner, None), |(colors, alpha)| {
            (colors.trim(), Some(alpha.trim()))
        });
    let mut parts: Vec<&str> = if colors.contains(',') {
        colors.split(',').map(str::trim).collect()
    } else {
        colors.split_whitespace().collect()
    };
    let alpha = if parts.len() == 4 && slash_alpha.is_none() {
        parts.pop()
    } else {
        slash_alpha
    };
    if parts.len() != 3 {
        return None;
    }
    let channels = [
        source_color_component(parts[0])?,
        source_color_component(parts[1])?,
        source_color_component(parts[2])?,
    ];
    let alpha = source_alpha_component(alpha)?;
    Some(if alpha == 255 {
        format!("#{:02X}{:02X}{:02X}", channels[0], channels[1], channels[2])
    } else {
        format!(
            "#{:02X}{:02X}{:02X}{alpha:02X}",
            channels[0], channels[1], channels[2]
        )
    })
}

fn normalize_source_theme(theme: &mut HashMap<String, String>) -> BrandResult<()> {
    let expected: HashSet<&str> = THEME_TOKEN_NAMES.iter().copied().collect();
    if theme.len() != expected.len() || theme.keys().any(|name| !expected.contains(name.as_str())) {
        return Err(brand_error(
            "brand_manifest_invalid",
            "The selected source theme does not use the exact semantic token set.",
        ));
    }
    for value in theme.values_mut() {
        *value = canonical_source_color(value).ok_or_else(|| {
            brand_error(
                "brand_manifest_invalid",
                "The selected source contains an unsupported theme color.",
            )
        })?;
    }
    Ok(())
}

fn parse_source_manifest(bytes: &[u8]) -> BrandResult<NativeBrandManifest> {
    let mut manifest: NativeBrandManifest = serde_yaml::from_slice(bytes).map_err(|_| {
        brand_error(
            "brand_manifest_invalid",
            "The selected source manifest cannot authorize asset access.",
        )
    })?;
    manifest.id = manifest.id.trim().to_owned();
    manifest.display_name = manifest.display_name.trim().to_owned();
    manifest.assets.logo = manifest.assets.logo.trim().to_owned();
    manifest.assets.mark = manifest.assets.mark.trim().to_owned();
    manifest.assets.window_icon = manifest.assets.window_icon.trim().to_owned();
    normalize_source_theme(&mut manifest.themes.light)?;
    normalize_source_theme(&mut manifest.themes.dark)?;
    if manifest.schema_version != 1
        || !validate_brand_id(&manifest.id)
        || manifest.id == BUILTIN_BRAND_ID
        || manifest.display_name.is_empty()
    {
        return Err(brand_error(
            "brand_manifest_invalid",
            "The selected source manifest identity is invalid.",
        ));
    }
    let paths = [
        &manifest.assets.logo,
        &manifest.assets.mark,
        &manifest.assets.window_icon,
    ];
    if paths.iter().any(|path| !safe_asset_path(path)) {
        return Err(brand_error(
            "brand_asset_path_invalid",
            "The selected source contains an unsafe asset path.",
        ));
    }
    Ok(manifest)
}

fn grant_brand_source(path: &Path, grants: &BrandGrantState) -> BrandResult<BrandSourceSelection> {
    if path.file_name().and_then(|name| name.to_str()) != Some("brand.yaml") {
        return Err(brand_error(
            "brand_manifest_invalid",
            "Select an exact brand.yaml manifest.",
        ));
    }
    let canonical = path
        .canonicalize()
        .map_err(|error| io_error("brand_source_invalid", error))?;
    let parent_path = canonical
        .parent()
        .ok_or_else(|| {
            brand_error(
                "brand_source_invalid",
                "The manifest has no source directory.",
            )
        })?
        .to_path_buf();
    let source_container_path = parent_path.parent().ok_or_else(|| {
        brand_error(
            "brand_source_invalid",
            "The brand source directory has no capability parent.",
        )
    })?;
    let source_name = parent_path
        .file_name()
        .ok_or_else(|| brand_error("brand_source_invalid", "The brand source has no name."))?
        .to_os_string();
    let source_parent = Dir::open_ambient_dir(source_container_path, ambient_authority())
        .map_err(|error| io_error("brand_grant_failed", error))?;
    let parent_metadata = source_parent
        .symlink_metadata(&source_name)
        .map_err(|error| io_error("brand_source_invalid", error))?;
    if parent_metadata.file_type().is_symlink() || !parent_metadata.is_dir() {
        return Err(brand_error(
            "brand_source_invalid",
            "The brand source directory must be a regular directory.",
        ));
    }
    let parent = source_parent
        .open_dir(&source_name)
        .map_err(|error| io_error("brand_grant_failed", error))?;
    let source_identity = cap_directory_identity(&parent, "brand_grant_failed")?;
    let rebound_identity = source_parent
        .open_dir(&source_name)
        .map_err(|error| io_error("brand_source_invalid", error))
        .and_then(|directory| cap_directory_identity(&directory, "brand_source_invalid"))?;
    if rebound_identity != source_identity {
        return Err(brand_error(
            "brand_source_changed",
            "The brand source directory changed while it was selected.",
        ));
    }
    let manifest_name = canonical
        .file_name()
        .ok_or_else(|| brand_error("brand_source_invalid", "The manifest has no file name."))?
        .to_os_string();
    let (manifest_bytes, manifest_identity) =
        read_bounded_cap_file(&parent, Path::new(&manifest_name), "brand_source_invalid")?;
    let manifest_text = String::from_utf8(manifest_bytes.clone()).map_err(|_| {
        brand_error(
            "brand_manifest_invalid",
            "The selected brand manifest must be UTF-8 text.",
        )
    })?;
    let manifest_sha256 = sha256(&manifest_bytes);
    let source_manifest = parse_source_manifest(&manifest_bytes).ok();
    let authorized_paths = source_manifest
        .as_ref()
        .map(|manifest| {
            [
                manifest.assets.logo.clone(),
                manifest.assets.mark.clone(),
                manifest.assets.window_icon.clone(),
            ]
            .into_iter()
            .collect()
        })
        .unwrap_or_default();
    let grant_token = opaque_token()?;
    grants
        .grants
        .lock()
        .map_err(|_| brand_error("brand_grant_failed", "Brand source grants are unavailable."))?
        .insert(
            grant_token.clone(),
            GrantedBrandSource {
                source_parent,
                source_name,
                source_identity,
                parent,
                manifest_name,
                manifest_identity,
                manifest_sha256: manifest_sha256.clone(),
                source_manifest,
                authorized_paths,
                assets: HashMap::new(),
            },
        );
    Ok(BrandSourceSelection {
        grant_token,
        manifest_text,
        manifest_sha256,
    })
}

fn verify_source_scope(grant: &GrantedBrandSource) -> BrandResult<()> {
    let rebound = grant
        .source_parent
        .open_dir(&grant.source_name)
        .map_err(|_| {
            brand_error(
                "brand_source_changed",
                "The selected brand source directory is no longer present.",
            )
        })?;
    if cap_directory_identity(&rebound, "brand_source_changed")? != grant.source_identity {
        return Err(brand_error(
            "brand_source_changed",
            "The selected brand source directory changed after it was granted.",
        ));
    }
    Ok(())
}

fn verify_manifest(grant: &GrantedBrandSource) -> BrandResult<()> {
    verify_source_scope(grant)?;
    let (bytes, identity) = read_bounded_cap_file(
        &grant.parent,
        Path::new(&grant.manifest_name),
        "brand_source_changed",
    )?;
    if identity != grant.manifest_identity || sha256(&bytes) != grant.manifest_sha256 {
        return Err(brand_error(
            "brand_source_changed",
            "The selected brand manifest changed after it was granted.",
        ));
    }
    verify_source_scope(grant)?;
    Ok(())
}

fn read_brand_source_assets(
    token: &str,
    paths: &[String],
    grants: &BrandGrantState,
) -> BrandResult<Vec<BrandSourceAsset>> {
    read_brand_source_assets_impl(token, paths, grants, |_| {})
}

#[cfg(test)]
#[cfg_attr(windows, allow(dead_code))]
fn read_brand_source_assets_with_bound_hook(
    token: &str,
    paths: &[String],
    grants: &BrandGrantState,
    hook: impl FnMut(&str),
) -> BrandResult<Vec<BrandSourceAsset>> {
    read_brand_source_assets_impl(token, paths, grants, hook)
}

fn read_brand_source_assets_impl(
    token: &str,
    paths: &[String],
    grants: &BrandGrantState,
    mut bound_hook: impl FnMut(&str),
) -> BrandResult<Vec<BrandSourceAsset>> {
    if paths.is_empty()
        || paths.len() > 3
        || paths.iter().collect::<HashSet<_>>().len() != paths.len()
    {
        return Err(brand_error(
            "brand_asset_set_invalid",
            "Read one to three unique manifest-referenced assets.",
        ));
    }
    let mut locked = grants
        .grants
        .lock()
        .map_err(|_| brand_error("brand_grant_failed", "Brand source grants are unavailable."))?;
    let grant = locked.get_mut(token).ok_or_else(|| {
        brand_error(
            "brand_grant_required",
            "Select the exact brand manifest before reading assets.",
        )
    })?;
    verify_manifest(grant)?;
    let requested_paths: HashSet<String> = paths.iter().cloned().collect();
    if grant.source_manifest.is_none() || requested_paths != grant.authorized_paths {
        return Err(brand_error(
            "brand_asset_set_invalid",
            "Read each and only the assets referenced by the exact selected manifest.",
        ));
    }
    let mut result = Vec::with_capacity(paths.len());
    for relative in paths {
        let (parent, name) = bind_relative_parent(&grant.parent, relative, "brand_source_changed")?;
        bound_hook(relative);
        let (bytes, identity) =
            read_bounded_cap_file(&parent, Path::new(&name), "brand_source_changed")?;
        let digest = sha256(&bytes);
        grant.assets.insert(
            relative.clone(),
            BoundBrandAsset {
                parent,
                name,
                identity,
                sha256: digest.clone(),
            },
        );
        result.push(BrandSourceAsset {
            path: relative.clone(),
            bytes,
            sha256: digest,
        });
    }
    Ok(result)
}

fn revoke_brand_source_grant(grant_token: &str, grants: &BrandGrantState) -> BrandResult<()> {
    grants
        .grants
        .lock()
        .map_err(|_| brand_error("brand_grant_failed", "Brand source grants are unavailable."))?
        .remove(grant_token);
    Ok(())
}

fn valid_color(value: &str) -> bool {
    let Some(hex) = value.strip_prefix('#') else {
        return false;
    };
    matches!(hex.len(), 6 | 8) && hex.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn color_channels(value: &str) -> Option<(f64, f64, f64, f64)> {
    let hex = value.strip_prefix('#')?;
    if !matches!(hex.len(), 6 | 8) || !hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    let channel = |start| {
        u8::from_str_radix(&hex[start..start + 2], 16)
            .ok()
            .map(f64::from)
    };
    Some((
        channel(0)?,
        channel(2)?,
        channel(4)?,
        if hex.len() == 8 {
            channel(6)? / 255.0
        } else {
            1.0
        },
    ))
}

fn contrast_ratio(foreground: &str, background: &str) -> Option<f64> {
    let (background_red, background_green, background_blue, background_alpha) =
        color_channels(background)?;
    let white = 255.0;
    let backdrop = (
        background_red * background_alpha + white * (1.0 - background_alpha),
        background_green * background_alpha + white * (1.0 - background_alpha),
        background_blue * background_alpha + white * (1.0 - background_alpha),
    );
    let (red, green, blue, alpha) = color_channels(foreground)?;
    let front = (
        red * alpha + backdrop.0 * (1.0 - alpha),
        green * alpha + backdrop.1 * (1.0 - alpha),
        blue * alpha + backdrop.2 * (1.0 - alpha),
    );
    let linear = |channel: f64| {
        let value = channel / 255.0;
        if value <= 0.04045 {
            value / 12.92
        } else {
            ((value + 0.055) / 1.055).powf(2.4)
        }
    };
    let luminance = |color: (f64, f64, f64)| {
        0.2126 * linear(color.0) + 0.7152 * linear(color.1) + 0.0722 * linear(color.2)
    };
    let first = luminance(front);
    let second = luminance(backdrop);
    Some((first.max(second) + 0.05) / (first.min(second) + 0.05))
}

fn validate_theme(theme: &HashMap<String, String>) -> BrandResult<()> {
    let expected: HashSet<&str> = THEME_TOKEN_NAMES.iter().copied().collect();
    if theme.len() != expected.len()
        || theme
            .iter()
            .any(|(name, value)| !expected.contains(name.as_str()) || !valid_color(value))
    {
        return Err(brand_error(
            "brand_theme_invalid",
            "Themes must contain only the complete fixed semantic token set and canonical colors.",
        ));
    }
    for (foreground, background, minimum) in [
        ("text", "background", 4.5),
        ("text", "surface", 4.5),
        ("accent-contrast", "accent", 4.5),
        ("focus", "background", 3.0),
        ("error", "background", 4.5),
    ] {
        if !matches!(
            contrast_ratio(&theme[foreground], &theme[background]),
            Some(ratio) if ratio >= minimum
        ) {
            return Err(brand_error(
                "brand_contrast_invalid",
                "Operational brand colors do not meet required WCAG contrast.",
            ));
        }
    }
    Ok(())
}

fn validate_manifest(manifest: &NativeBrandManifest) -> BrandResult<HashSet<String>> {
    if manifest.schema_version != 1
        || !validate_brand_id(&manifest.id)
        || manifest.id == BUILTIN_BRAND_ID
        || manifest.display_name.trim().is_empty()
        || manifest.display_name.len() > 200
    {
        return Err(brand_error(
            "brand_manifest_invalid",
            "The brand manifest identity is invalid or reserved.",
        ));
    }
    validate_theme(&manifest.themes.light)?;
    validate_theme(&manifest.themes.dark)?;
    let paths = [
        &manifest.assets.logo,
        &manifest.assets.mark,
        &manifest.assets.window_icon,
    ];
    if paths.iter().any(|path| !safe_asset_path(path)) {
        return Err(brand_error(
            "brand_asset_path_invalid",
            "Manifest asset paths must be safe relative SVG or PNG paths.",
        ));
    }
    Ok(paths.into_iter().cloned().collect())
}

#[cfg(test)]
fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0xffff_ffff_u32;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = (crc >> 1) ^ if crc & 1 == 1 { 0xedb8_8320 } else { 0 };
        }
    }
    crc ^ 0xffff_ffff
}

fn validate_png(bytes: &[u8]) -> bool {
    let decoder = png::Decoder::new_with_limits(
        std::io::Cursor::new(bytes),
        png::Limits {
            bytes: MAX_ASSET_BYTES,
        },
    );
    let Ok(mut reader) = decoder.read_info() else {
        return false;
    };
    if !(1..=4096).contains(&reader.info().width) || !(1..=4096).contains(&reader.info().height) {
        return false;
    }
    loop {
        match reader.next_row() {
            Ok(Some(_)) => {}
            Ok(None) => break,
            Err(_) => return false,
        }
    }
    reader.finish().is_ok()
}

fn validate_svg_start(
    element: &BytesStart<'_>,
    reader: &Reader<&[u8]>,
    root: bool,
) -> BrandResult<()> {
    const ELEMENTS: [&str; 20] = [
        "svg",
        "g",
        "path",
        "rect",
        "circle",
        "ellipse",
        "line",
        "polyline",
        "polygon",
        "text",
        "tspan",
        "title",
        "desc",
        "defs",
        "lineargradient",
        "radialgradient",
        "stop",
        "clippath",
        "mask",
        "use",
    ];
    const ATTRIBUTES: [&str; 43] = [
        "xmlns",
        "viewbox",
        "role",
        "aria-label",
        "aria-hidden",
        "width",
        "height",
        "x",
        "y",
        "x1",
        "y1",
        "x2",
        "y2",
        "cx",
        "cy",
        "r",
        "rx",
        "ry",
        "d",
        "points",
        "fill",
        "fill-opacity",
        "stroke",
        "stroke-width",
        "stroke-linecap",
        "stroke-linejoin",
        "stroke-opacity",
        "opacity",
        "transform",
        "font-family",
        "font-size",
        "font-weight",
        "letter-spacing",
        "text-anchor",
        "offset",
        "stop-color",
        "stop-opacity",
        "gradientunits",
        "gradienttransform",
        "clip-path",
        "mask",
        "id",
        "href",
    ];
    let name = std::str::from_utf8(element.name().as_ref())
        .map_err(|_| brand_error("brand_asset_invalid", "SVG element names must be UTF-8."))?
        .to_ascii_lowercase();
    if name.contains(':') || !ELEMENTS.contains(&name.as_str()) || (root && name != "svg") {
        return Err(brand_error(
            "brand_asset_invalid",
            "The sanitized SVG contains an element outside the native allowlist.",
        ));
    }
    let mut has_svg_namespace = false;
    for attribute in element.attributes() {
        let attribute = attribute.map_err(|_| {
            brand_error(
                "brand_asset_invalid",
                "The sanitized SVG contains malformed or duplicate attributes.",
            )
        })?;
        let attribute_name = std::str::from_utf8(attribute.key.as_ref())
            .map_err(|_| brand_error("brand_asset_invalid", "SVG attribute names must be UTF-8."))?
            .to_ascii_lowercase();
        if attribute_name.contains(':')
            || attribute_name.starts_with("on")
            || !ATTRIBUTES.contains(&attribute_name.as_str())
            || (attribute_name == "xmlns" && !root)
        {
            return Err(brand_error(
                "brand_asset_invalid",
                "The sanitized SVG contains an attribute outside the native allowlist.",
            ));
        }
        let value = attribute
            .decode_and_unescape_value(reader.decoder())
            .map_err(|_| {
                brand_error(
                    "brand_asset_invalid",
                    "The sanitized SVG attribute is malformed.",
                )
            })?;
        let normalized = value.trim().to_ascii_lowercase();
        let compact: String = normalized
            .chars()
            .filter(|character| !character.is_whitespace())
            .collect();
        if attribute_name == "xmlns" {
            if normalized != "http://www.w3.org/2000/svg" {
                return Err(brand_error(
                    "brand_asset_invalid",
                    "The SVG namespace is not allowed.",
                ));
            }
            has_svg_namespace = true;
            continue;
        }
        if compact.contains("javascript:")
            || compact.contains("data:")
            || compact.contains("http:")
            || compact.contains("https:")
            || compact.contains("file:")
            || compact.starts_with("//")
            || compact.contains("url(")
            || compact.contains("@import")
            || (["href", "clip-path", "mask"].contains(&attribute_name.as_str())
                && !normalized.is_empty()
                && !normalized.starts_with('#'))
        {
            return Err(brand_error(
                "brand_asset_invalid",
                "The sanitized SVG contains an active or external reference.",
            ));
        }
    }
    if root && !has_svg_namespace {
        return Err(brand_error(
            "brand_asset_invalid",
            "The sanitized SVG must declare the SVG namespace.",
        ));
    }
    Ok(())
}

fn validate_svg(bytes: &[u8]) -> BrandResult<()> {
    let text = std::str::from_utf8(bytes)
        .map_err(|_| brand_error("brand_asset_invalid", "The sanitized SVG is not UTF-8."))?;
    if text.contains('\0') {
        return Err(brand_error(
            "brand_asset_invalid",
            "The sanitized SVG contains NUL data.",
        ));
    }
    let mut reader = Reader::from_str(text);
    reader.config_mut().trim_text(false);
    let mut depth = 0_usize;
    let mut root_seen = false;
    let mut root_closed = false;
    let mut renderable_child = false;
    loop {
        match reader.read_event() {
            Ok(Event::Start(element)) => {
                if depth == 0 {
                    if root_seen || root_closed {
                        return Err(brand_error(
                            "brand_asset_invalid",
                            "SVG must contain one root element.",
                        ));
                    }
                    validate_svg_start(&element, &reader, true)?;
                    root_seen = true;
                } else {
                    validate_svg_start(&element, &reader, false)?;
                    renderable_child = true;
                }
                depth += 1;
            }
            Ok(Event::Empty(element)) => {
                if depth == 0 {
                    if root_seen || root_closed {
                        return Err(brand_error(
                            "brand_asset_invalid",
                            "SVG must contain one root element.",
                        ));
                    }
                    validate_svg_start(&element, &reader, true)?;
                    root_seen = true;
                    root_closed = true;
                } else {
                    validate_svg_start(&element, &reader, false)?;
                    renderable_child = true;
                }
            }
            Ok(Event::End(_)) => {
                if depth == 0 {
                    return Err(brand_error(
                        "brand_asset_invalid",
                        "The sanitized SVG is malformed.",
                    ));
                }
                depth -= 1;
                if depth == 0 {
                    root_closed = true;
                }
            }
            Ok(Event::Text(value)) => {
                if depth == 0
                    && value
                        .into_inner()
                        .iter()
                        .any(|byte| !byte.is_ascii_whitespace())
                {
                    return Err(brand_error(
                        "brand_asset_invalid",
                        "SVG cannot contain text outside its root element.",
                    ));
                }
            }
            Ok(Event::DocType(_) | Event::PI(_)) => {
                return Err(brand_error(
                    "brand_asset_invalid",
                    "SVG declarations and processing instructions are not allowed.",
                ));
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(_) => {
                return Err(brand_error(
                    "brand_asset_invalid",
                    "The sanitized SVG is malformed.",
                ))
            }
        }
    }
    if !root_seen || !root_closed || depth != 0 || !renderable_child {
        return Err(brand_error(
            "brand_asset_invalid",
            "The sanitized SVG must contain one complete root and renderable content.",
        ));
    }
    Ok(())
}

fn validate_sanitized_asset(asset: &BrandImportAsset) -> BrandResult<()> {
    if asset.sanitized_bytes.is_empty() || asset.sanitized_bytes.len() > MAX_ASSET_BYTES {
        return Err(brand_error(
            "brand_file_too_large",
            "Sanitized brand assets must be non-empty and at most 2 MiB.",
        ));
    }
    if asset.media_type == "image/png" && asset.path.to_ascii_lowercase().ends_with(".png") {
        if !validate_png(&asset.sanitized_bytes) {
            return Err(brand_error(
                "brand_asset_invalid",
                "The sanitized PNG is invalid.",
            ));
        }
        return Ok(());
    }
    if asset.media_type == "image/svg+xml" && asset.path.to_ascii_lowercase().ends_with(".svg") {
        return validate_svg(&asset.sanitized_bytes);
    }
    Err(brand_error(
        "brand_asset_invalid",
        "Brand assets must use matching SVG or PNG media types.",
    ))
}

fn verify_bound_asset(grant: &GrantedBrandSource, asset: &BrandImportAsset) -> BrandResult<()> {
    let bound = grant.assets.get(&asset.path).ok_or_else(|| {
        brand_error(
            "brand_grant_required",
            "Every imported asset must have been read through this exact source grant.",
        )
    })?;
    let (bytes, identity) = read_bounded_cap_file(
        &bound.parent,
        Path::new(&bound.name),
        "brand_source_changed",
    )?;
    let digest = sha256(&bytes);
    if identity != bound.identity
        || digest != bound.sha256
        || digest != asset.source_sha256
        || bytes != asset.sanitized_bytes
    {
        return Err(brand_error(
            "brand_source_changed",
            "A brand asset changed after renderer validation.",
        ));
    }
    Ok(())
}

impl BrandStorageScope {
    fn bind(app_data: &Path) -> BrandResult<Self> {
        match fs::symlink_metadata(app_data) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                return Err(brand_error(
                    "brand_storage_scope_invalid",
                    "Application data must be a regular private directory.",
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir_all(app_data)
                    .map_err(|error| io_error("brand_storage_failed", error))?;
            }
            Err(error) => return Err(io_error("brand_storage_scope_invalid", error)),
        }
        let parent_path = app_data.parent().ok_or_else(|| {
            brand_error(
                "brand_storage_scope_invalid",
                "Application data must have a regular parent directory.",
            )
        })?;
        let app_name = app_data
            .file_name()
            .ok_or_else(|| {
                brand_error(
                    "brand_storage_scope_invalid",
                    "Application data must have a directory name.",
                )
            })?
            .to_os_string();
        let app_parent = Dir::open_ambient_dir(parent_path, ambient_authority())
            .map_err(|error| io_error("brand_storage_scope_invalid", error))?;
        let app_metadata = app_parent
            .symlink_metadata(&app_name)
            .map_err(|error| io_error("brand_storage_scope_invalid", error))?;
        if app_metadata.file_type().is_symlink() || !app_metadata.is_dir() {
            return Err(brand_error(
                "brand_storage_scope_invalid",
                "Application data must be a regular private directory.",
            ));
        }
        let app = app_parent
            .open_dir(&app_name)
            .map_err(|error| io_error("brand_storage_scope_invalid", error))?;
        let app_identity = cap_directory_identity(&app, "brand_storage_scope_invalid")?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            app_parent
                .set_permissions(
                    &app_name,
                    CapPermissions::from_std(fs::Permissions::from_mode(0o700)),
                )
                .map_err(|error| io_error("brand_storage_failed", error))?;
        }
        match app.symlink_metadata("brands") {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                return Err(brand_error(
                    "brand_storage_scope_invalid",
                    "The private brand storage root is not a regular directory.",
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => app
                .create_dir("brands")
                .map_err(|error| io_error("brand_storage_failed", error))?,
            Err(error) => return Err(io_error("brand_storage_failed", error)),
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            app.set_permissions(
                "brands",
                CapPermissions::from_std(fs::Permissions::from_mode(0o700)),
            )
            .map_err(|error| io_error("brand_storage_failed", error))?;
        }
        let brands = app
            .open_dir("brands")
            .map_err(|error| io_error("brand_storage_scope_invalid", error))?;
        let brands_identity = cap_directory_identity(&brands, "brand_storage_scope_invalid")?;
        let scope = Self {
            app_parent,
            app_name,
            app_identity,
            app,
            brands_identity,
            brands,
        };
        scope.verify()?;
        Ok(scope)
    }

    fn verify(&self) -> BrandResult<()> {
        let app = self
            .app_parent
            .open_dir(&self.app_name)
            .map_err(|_| brand_storage_scope_changed())?;
        if cap_directory_identity(&app, "brand_storage_scope_invalid")? != self.app_identity {
            return Err(brand_storage_scope_changed());
        }
        let brands = self
            .app
            .open_dir("brands")
            .map_err(|_| brand_storage_scope_changed())?;
        if cap_directory_identity(&brands, "brand_storage_scope_invalid")? != self.brands_identity {
            return Err(brand_storage_scope_changed());
        }
        Ok(())
    }

    fn bind_pack(&self, id: &str) -> BrandResult<(Dir, Handle)> {
        self.verify()?;
        let metadata = self
            .brands
            .symlink_metadata(id)
            .map_err(|_| brand_error("brand_not_found", "The custom brand does not exist."))?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(brand_error(
                "brand_storage_scope_invalid",
                "The stored brand directory is unsafe.",
            ));
        }
        let directory = self
            .brands
            .open_dir(id)
            .map_err(|error| io_error("brand_storage_scope_invalid", error))?;
        let identity = cap_directory_identity(&directory, "brand_storage_scope_invalid")?;
        if !self.named_pack_identity_matches(id, &identity) {
            return Err(brand_storage_scope_changed());
        }
        Ok((directory, identity))
    }

    fn named_pack_identity_matches(&self, id: &str, expected: &Handle) -> bool {
        self.brands
            .symlink_metadata(id)
            .ok()
            .filter(|metadata| !metadata.file_type().is_symlink() && metadata.is_dir())
            .and_then(|_| self.brands.open_dir(id).ok())
            .and_then(|directory| {
                cap_directory_identity(&directory, "brand_storage_scope_invalid").ok()
            })
            .as_ref()
            == Some(expected)
    }
}

fn brand_storage_scope_changed() -> BrandError {
    brand_error(
        "brand_storage_scope_invalid",
        "The private brand storage capability changed during the operation.",
    )
}

fn write_private_file_at(directory: &Dir, relative: &Path, bytes: &[u8]) -> BrandResult<()> {
    if let Some(parent) = relative
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        directory
            .create_dir_all(parent)
            .map_err(|error| io_error("brand_storage_failed", error))?;
    }
    let mut options = CapOpenOptions::new();
    options.read(true).write(true).create_new(true);
    let mut file = directory
        .open_with(relative, &options)
        .map_err(|error| io_error("brand_storage_failed", error))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(CapPermissions::from_std(fs::Permissions::from_mode(0o600)))
            .map_err(|error| io_error("brand_storage_failed", error))?;
    }
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|error| io_error("brand_storage_failed", error))
}

struct StagedBrandDirectory<'a> {
    parent: &'a Dir,
    name: OsString,
    directory: Dir,
    identity: Handle,
    active: bool,
}

impl<'a> StagedBrandDirectory<'a> {
    fn new(parent: &'a Dir, id: &str) -> BrandResult<Self> {
        for _ in 0..100 {
            let name = OsString::from(format!(".{id}-{}.tmp", opaque_token()?));
            match parent.create_dir(&name) {
                Ok(()) => {
                    let directory = parent
                        .open_dir(&name)
                        .map_err(|error| io_error("brand_storage_failed", error))?;
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        parent
                            .set_permissions(
                                &name,
                                CapPermissions::from_std(fs::Permissions::from_mode(0o700)),
                            )
                            .map_err(|error| io_error("brand_storage_failed", error))?;
                    }
                    let identity = cap_directory_identity(&directory, "brand_storage_failed")?;
                    return Ok(Self {
                        parent,
                        name,
                        directory,
                        identity,
                        active: true,
                    });
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(io_error("brand_storage_failed", error)),
            }
        }
        Err(brand_error(
            "brand_storage_failed",
            "A unique private brand staging directory could not be created.",
        ))
    }

    fn named_identity_matches(&self) -> bool {
        self.parent
            .open_dir(&self.name)
            .ok()
            .and_then(|directory| cap_directory_identity(&directory, "brand_storage_failed").ok())
            .as_ref()
            == Some(&self.identity)
    }

    fn disarm(&mut self) {
        self.active = false;
    }
}

impl Drop for StagedBrandDirectory<'_> {
    fn drop(&mut self) {
        if self.active {
            let _ = self.parent.remove_dir_all(&self.name);
        }
    }
}

fn import_brand_pack_at(
    app_data: &Path,
    request: BrandImportRequest,
    grants: &BrandGrantState,
) -> BrandResult<ImportedBrand> {
    import_brand_pack_at_with_commit_hook(app_data, request, grants, |_| {})
}

fn import_brand_pack_at_with_commit_hook(
    app_data: &Path,
    request: BrandImportRequest,
    grants: &BrandGrantState,
    before_commit: impl FnOnce(&Path),
) -> BrandResult<ImportedBrand> {
    let expected_paths = validate_manifest(&request.manifest)?;
    let actual_paths: HashSet<String> = request
        .assets
        .iter()
        .map(|asset| asset.path.clone())
        .collect();
    if request.assets.len() != actual_paths.len() || actual_paths != expected_paths {
        return Err(brand_error(
            "brand_asset_set_invalid",
            "Import must contain each and only the manifest-referenced sanitized asset.",
        ));
    }
    let manifest_bytes = serde_json::to_vec_pretty(&request.manifest).map_err(|error| {
        brand_error(
            "brand_manifest_invalid",
            format!("The validated manifest could not be serialized: {error}"),
        )
    })?;
    if manifest_bytes.len() > MAX_ASSET_BYTES {
        return Err(brand_error(
            "brand_file_too_large",
            "Brand manifests cannot exceed 2 MiB.",
        ));
    }
    let total_bytes = request
        .assets
        .iter()
        .try_fold(manifest_bytes.len(), |total, asset| {
            total.checked_add(asset.sanitized_bytes.len())
        });
    if !matches!(total_bytes, Some(total) if total <= MAX_PACK_BYTES) {
        return Err(brand_error(
            "brand_pack_too_large",
            "The brand pack exceeds the 8 MiB total limit.",
        ));
    }
    let mut locked = grants
        .grants
        .lock()
        .map_err(|_| brand_error("brand_grant_failed", "Brand source grants are unavailable."))?;
    let grant = locked.get(&request.grant_token).ok_or_else(|| {
        brand_error(
            "brand_grant_required",
            "The brand source grant expired or was already consumed.",
        )
    })?;
    verify_manifest(grant)?;
    if request.manifest_source_sha256 != grant.manifest_sha256 {
        return Err(brand_error(
            "brand_source_changed",
            "The imported manifest revision does not match the selected source.",
        ));
    }
    if grant.source_manifest.as_ref() != Some(&request.manifest) {
        return Err(brand_error(
            "brand_manifest_mismatch",
            "The normalized import manifest does not match the exact selected source.",
        ));
    }
    for asset in &request.assets {
        validate_sanitized_asset(asset)?;
        verify_bound_asset(grant, asset)?;
    }

    let new_pack_bytes = total_bytes.expect("the bounded pack size was validated") as u64;
    let scope = BrandStorageScope::bind(app_data)?;
    match scope.brands.symlink_metadata(&request.manifest.id) {
        Ok(_) => {
            return Err(brand_error(
                "brand_id_exists",
                "A stored brand already uses this ID.",
            ));
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(io_error("brand_storage_failed", error)),
    }
    enforce_storage_quota(&scope, new_pack_bytes, None)?;
    let mut staging = StagedBrandDirectory::new(&scope.brands, &request.manifest.id)?;
    write_private_file_at(&staging.directory, Path::new("brand.yaml"), &manifest_bytes)?;
    for asset in &request.assets {
        write_private_file_at(
            &staging.directory,
            Path::new(&asset.path),
            &asset.sanitized_bytes,
        )?;
    }
    before_commit(&app_data.join("brands"));
    scope.verify()?;
    if !staging.named_identity_matches() {
        return Err(brand_storage_scope_changed());
    }
    match scope.brands.symlink_metadata(&request.manifest.id) {
        Ok(_) => {
            return Err(brand_storage_scope_changed());
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(io_error("brand_storage_failed", error)),
    }
    enforce_storage_quota(&scope, new_pack_bytes, Some(&staging.name))?;
    scope
        .brands
        .rename(&staging.name, &scope.brands, &request.manifest.id)
        .map_err(|error| io_error("brand_storage_failed", error))?;
    staging.disarm();
    scope.verify()?;
    if !scope.named_pack_identity_matches(&request.manifest.id, &staging.identity) {
        return Err(brand_storage_scope_changed());
    }
    let id = request.manifest.id.clone();
    let display_name = request.manifest.display_name.clone();
    locked.remove(&request.grant_token);
    Ok(ImportedBrand { id, display_name })
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ActiveBrandRecord {
    schema_version: u8,
    id: String,
    #[serde(default)]
    revision: Option<String>,
}

struct StagedActiveFile<'a> {
    parent: &'a Dir,
    name: OsString,
    identity: Handle,
    file: Option<CapFile>,
    active: bool,
}

impl<'a> StagedActiveFile<'a> {
    fn new(parent: &'a Dir) -> BrandResult<Self> {
        for _ in 0..100 {
            let name = OsString::from(format!(".{ACTIVE_FILE}-{}.tmp", opaque_token()?));
            let mut options = CapOpenOptions::new();
            options.read(true).write(true).create_new(true);
            #[cfg(windows)]
            {
                use cap_std::fs::OpenOptionsExt;
                use windows_sys::Win32::Foundation::{GENERIC_READ, GENERIC_WRITE};
                use windows_sys::Win32::Storage::FileSystem::DELETE;

                options.access_mode(GENERIC_READ | GENERIC_WRITE | DELETE);
            }
            match parent.open_with(&name, &options) {
                Ok(file) => {
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        file.set_permissions(CapPermissions::from_std(fs::Permissions::from_mode(
                            0o600,
                        )))
                        .map_err(|error| io_error("brand_storage_failed", error))?;
                    }
                    let identity = cap_file_identity(&file, "brand_storage_failed")?;
                    return Ok(Self {
                        parent,
                        name,
                        identity,
                        file: Some(file),
                        active: true,
                    });
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(io_error("brand_storage_failed", error)),
            }
        }
        Err(brand_error(
            "brand_storage_failed",
            "A unique active-brand staging file could not be created.",
        ))
    }

    fn file_mut(&mut self) -> &mut CapFile {
        self.file
            .as_mut()
            .expect("active-brand staging file remains open")
    }

    fn file(&self) -> &CapFile {
        self.file
            .as_ref()
            .expect("active-brand staging file remains open")
    }

    fn named_identity_matches(&self) -> bool {
        cap_named_file_identity(self.parent, Path::new(&self.name), "brand_storage_failed")
            .ok()
            .as_ref()
            == Some(&self.identity)
    }

    fn disarm(&mut self) {
        self.file.take();
        self.active = false;
    }
}

impl Drop for StagedActiveFile<'_> {
    fn drop(&mut self) {
        if self.active {
            self.file.take();
            let _ = self.parent.remove_file(&self.name);
        }
    }
}

fn atomic_active_write(
    scope: &BrandStorageScope,
    id: &str,
    revision: Option<&str>,
) -> BrandResult<()> {
    let bytes = serde_json::to_vec(&ActiveBrandRecord {
        schema_version: 1,
        id: id.to_owned(),
        revision: revision.map(str::to_owned),
    })
    .map_err(|error| brand_error("brand_storage_failed", error.to_string()))?;
    let mut temporary = StagedActiveFile::new(&scope.brands)?;
    temporary
        .file_mut()
        .write_all(&bytes)
        .and_then(|_| temporary.file_mut().sync_all())
        .map_err(|error| io_error("brand_storage_failed", error))?;
    let destination_exists = match scope.brands.symlink_metadata(ACTIVE_FILE) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err(brand_error(
                    "brand_storage_scope_invalid",
                    "The active-brand record is not a regular private file.",
                ));
            }
            true
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(error) => return Err(io_error("brand_storage_failed", error)),
    };
    scope.verify()?;
    if !temporary.named_identity_matches() {
        return Err(brand_storage_scope_changed());
    }
    select_active_record_commit(
        destination_exists,
        || {
            scope
                .brands
                .rename(&temporary.name, &scope.brands, ACTIVE_FILE)
                .map_err(|error| io_error("brand_storage_failed", error))
        },
        || replace_active_file(&scope.brands, &temporary.name, temporary.file()),
    )?;
    temporary.disarm();
    scope.verify()?;
    if cap_named_file_identity(
        &scope.brands,
        Path::new(ACTIVE_FILE),
        "brand_storage_failed",
    )? != temporary.identity
    {
        return Err(brand_storage_scope_changed());
    }
    Ok(())
}

fn select_active_record_commit(
    destination_exists: bool,
    rename_new: impl FnOnce() -> BrandResult<()>,
    replace_existing: impl FnOnce() -> BrandResult<()>,
) -> BrandResult<()> {
    if destination_exists {
        replace_existing()
    } else {
        rename_new()
    }
}

#[cfg(not(windows))]
fn replace_active_file(
    directory: &Dir,
    source_name: &std::ffi::OsStr,
    _source: &CapFile,
) -> BrandResult<()> {
    directory
        .rename(source_name, directory, ACTIVE_FILE)
        .map_err(|error| io_error("brand_storage_failed", error))
}

#[cfg(windows)]
fn replace_active_file(
    directory: &Dir,
    _source_name: &std::ffi::OsStr,
    source: &CapFile,
) -> BrandResult<()> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        FileRenameInfo, SetFileInformationByHandle, FILE_RENAME_INFO_0,
    };

    const TARGET_LENGTH: usize = ACTIVE_FILE.len();
    #[repr(C)]
    struct RelativeRenameInfo {
        anonymous: FILE_RENAME_INFO_0,
        root_directory: windows_sys::Win32::Foundation::HANDLE,
        file_name_length: u32,
        file_name: [u16; TARGET_LENGTH],
    }
    let mut file_name = [0_u16; TARGET_LENGTH];
    for (destination, source) in file_name.iter_mut().zip(ACTIVE_FILE.encode_utf16()) {
        *destination = source;
    }
    let rename = RelativeRenameInfo {
        anonymous: FILE_RENAME_INFO_0 { ReplaceIfExists: 1 },
        root_directory: directory.as_raw_handle(),
        file_name_length: (file_name.len() * std::mem::size_of::<u16>()) as u32,
        file_name,
    };
    let renamed = unsafe {
        SetFileInformationByHandle(
            source.as_raw_handle(),
            FileRenameInfo,
            (&rename as *const RelativeRenameInfo).cast(),
            std::mem::size_of::<RelativeRenameInfo>() as u32,
        )
    };
    if renamed == 0 {
        Err(io_error(
            "brand_storage_failed",
            std::io::Error::last_os_error(),
        ))
    } else {
        Ok(())
    }
}

fn load_active_record_at(app_data: &Path) -> BrandResult<ActiveBrandRecord> {
    let scope = BrandStorageScope::bind(app_data)?;
    load_active_record_from_scope(&scope)
}

fn load_active_record_from_scope(scope: &BrandStorageScope) -> BrandResult<ActiveBrandRecord> {
    scope.verify()?;
    match scope.brands.symlink_metadata(ACTIVE_FILE) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > 4096 {
                return Err(brand_error(
                    "brand_active_invalid",
                    "The saved active brand record is not a bounded regular file.",
                ));
            }
            let (bytes, _) = read_bounded_cap_file(
                &scope.brands,
                Path::new(ACTIVE_FILE),
                "brand_active_invalid",
            )?;
            let record: ActiveBrandRecord = serde_json::from_slice(&bytes).map_err(|_| {
                brand_error(
                    "brand_active_invalid",
                    "The saved active brand is corrupt; LOOP24 must be restored.",
                )
            })?;
            let revision_valid = if record.id == BUILTIN_BRAND_ID {
                record.revision.is_none()
            } else {
                record
                    .revision
                    .as_deref()
                    .is_some_and(|revision| revision.starts_with("sha256:") && revision.len() == 71)
            };
            if record.schema_version != 1 || !validate_brand_id(&record.id) || !revision_valid {
                return Err(brand_error(
                    "brand_active_invalid",
                    "The saved active brand is invalid; LOOP24 must be restored.",
                ));
            }
            scope.verify()?;
            Ok(record)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(ActiveBrandRecord {
            schema_version: 1,
            id: BUILTIN_BRAND_ID.to_owned(),
            revision: None,
        }),
        Err(error) => Err(io_error("brand_storage_failed", error)),
    }
}

fn load_active_brand_at(app_data: &Path) -> BrandResult<String> {
    load_active_record_at(app_data).map(|record| record.id)
}

fn stored_pack_revision(
    manifest: &NativeBrandManifest,
    assets: &[StoredBrandAsset],
) -> BrandResult<String> {
    let mut digest = Sha256::new();
    let mut update = |bytes: &[u8]| {
        digest.update((bytes.len() as u64).to_be_bytes());
        digest.update(bytes);
    };
    update(&[manifest.schema_version]);
    update(manifest.id.as_bytes());
    update(manifest.display_name.as_bytes());
    update(manifest.assets.logo.as_bytes());
    update(manifest.assets.mark.as_bytes());
    update(manifest.assets.window_icon.as_bytes());
    for theme in [&manifest.themes.light, &manifest.themes.dark] {
        for token in THEME_TOKEN_NAMES {
            update(token.as_bytes());
            update(
                theme
                    .get(token)
                    .ok_or_else(|| {
                        brand_error(
                            "brand_storage_invalid",
                            "The stored brand theme is incomplete.",
                        )
                    })?
                    .as_bytes(),
            );
        }
    }
    for asset in assets {
        update(asset.path.as_bytes());
        update(&asset.bytes);
    }
    Ok(format!("sha256:{:x}", digest.finalize()))
}

fn load_stored_pack_at(app_data: &Path, id: &str) -> BrandResult<StoredBrandPack> {
    load_stored_pack_at_impl(app_data, id, || {})
}

#[cfg(test)]
#[cfg_attr(windows, allow(dead_code))]
fn load_stored_pack_at_with_bound_hook(
    app_data: &Path,
    id: &str,
    hook: impl FnOnce(),
) -> BrandResult<StoredBrandPack> {
    load_stored_pack_at_impl(app_data, id, hook)
}

fn load_stored_pack_at_impl(
    app_data: &Path,
    id: &str,
    bound_hook: impl FnOnce(),
) -> BrandResult<StoredBrandPack> {
    if !validate_brand_id(id) || id == BUILTIN_BRAND_ID {
        return Err(brand_error(
            "brand_not_found",
            "The custom brand does not exist.",
        ));
    }
    let scope = BrandStorageScope::bind(app_data)?;
    let (directory, directory_identity) = scope.bind_pack(id)?;
    bound_hook();
    if !scope.named_pack_identity_matches(id, &directory_identity) {
        return Err(brand_storage_scope_changed());
    }
    load_stored_pack_from_directory(&scope, id, &directory, &directory_identity)
}

fn load_stored_pack_from_directory(
    scope: &BrandStorageScope,
    id: &str,
    directory: &Dir,
    directory_identity: &Handle,
) -> BrandResult<StoredBrandPack> {
    let (bytes, _) =
        read_bounded_cap_file(directory, Path::new("brand.yaml"), "brand_storage_invalid")?;
    let manifest: NativeBrandManifest = serde_json::from_slice(&bytes).map_err(|_| {
        brand_error(
            "brand_storage_invalid",
            "The stored brand manifest is corrupt.",
        )
    })?;
    if manifest.id != id {
        return Err(brand_error(
            "brand_storage_invalid",
            "The stored brand identity does not match its directory.",
        ));
    }
    let expected = validate_manifest(&manifest)?;
    let mut paths: Vec<String> = expected.into_iter().collect();
    paths.sort();
    let mut assets = Vec::with_capacity(paths.len());
    for relative in paths {
        let (parent, name) = bind_relative_parent(directory, &relative, "brand_storage_invalid")?;
        let (bytes, _) = read_bounded_cap_file(&parent, Path::new(&name), "brand_storage_invalid")?;
        validate_sanitized_asset(&BrandImportAsset {
            path: relative.clone(),
            source_sha256: String::new(),
            media_type: if relative.to_ascii_lowercase().ends_with(".png") {
                "image/png".to_owned()
            } else {
                "image/svg+xml".to_owned()
            },
            sanitized_bytes: bytes.clone(),
        })?;
        assets.push(StoredBrandAsset {
            path: relative,
            bytes,
        });
    }
    scope.verify()?;
    if !scope.named_pack_identity_matches(id, directory_identity) {
        return Err(brand_storage_scope_changed());
    }
    let revision = stored_pack_revision(&manifest, &assets)?;
    Ok(StoredBrandPack {
        manifest,
        assets,
        revision,
    })
}

fn bounded_native_warning(message: impl AsRef<str>) -> String {
    let message = message.as_ref();
    if message.len() <= 4096 {
        message.to_owned()
    } else {
        let boundary = (0..=4096)
            .rev()
            .find(|index| message.is_char_boundary(*index))
            .unwrap_or_default();
        format!("{}…", &message[..boundary])
    }
}

fn stored_pack_bytes(pack: &StoredBrandPack) -> BrandResult<u64> {
    let manifest = serde_json::to_vec_pretty(&pack.manifest)
        .map_err(|error| brand_error("brand_storage_invalid", error.to_string()))?;
    Ok(pack
        .assets
        .iter()
        .fold(manifest.len() as u64, |total, asset| {
            total.saturating_add(asset.bytes.len() as u64)
        }))
}

fn directory_tree_bytes(directory: &Dir) -> BrandResult<u64> {
    let mut total = 0_u64;
    for entry in directory
        .entries()
        .map_err(|error| io_error("brand_storage_failed", error))?
    {
        let entry = entry.map_err(|error| io_error("brand_storage_failed", error))?;
        let file_type = entry
            .file_type()
            .map_err(|error| io_error("brand_storage_failed", error))?;
        if file_type.is_symlink() {
            return Ok(MAX_PERSISTED_BYTES.saturating_add(1));
        }
        if file_type.is_file() {
            total = total.saturating_add(
                entry
                    .metadata()
                    .map_err(|error| io_error("brand_storage_failed", error))?
                    .len(),
            );
        } else if file_type.is_dir() {
            let child = entry
                .open_dir()
                .map_err(|error| io_error("brand_storage_failed", error))?;
            total = total.saturating_add(directory_tree_bytes(&child)?);
        } else {
            return Ok(MAX_PERSISTED_BYTES.saturating_add(1));
        }
        if total > MAX_PERSISTED_BYTES {
            break;
        }
    }
    Ok(total)
}

fn persisted_storage_usage(
    scope: &BrandStorageScope,
    excluded_entry: Option<&std::ffi::OsStr>,
) -> BrandResult<(usize, u64)> {
    scope.verify()?;
    let mut count = 0_usize;
    let mut bytes = 0_u64;
    for entry in scope
        .brands
        .entries()
        .map_err(|error| io_error("brand_storage_failed", error))?
    {
        let entry = entry.map_err(|error| io_error("brand_storage_failed", error))?;
        let name = entry.file_name();
        if name == ACTIVE_FILE || excluded_entry.is_some_and(|excluded| name == excluded) {
            continue;
        }
        count = count.saturating_add(1);
        let file_type = entry
            .file_type()
            .map_err(|error| io_error("brand_storage_failed", error))?;
        let entry_bytes = if file_type.is_symlink() {
            MAX_PERSISTED_BYTES.saturating_add(1)
        } else if file_type.is_file() {
            entry
                .metadata()
                .map_err(|error| io_error("brand_storage_failed", error))?
                .len()
        } else if file_type.is_dir() {
            directory_tree_bytes(
                &entry
                    .open_dir()
                    .map_err(|error| io_error("brand_storage_failed", error))?,
            )?
        } else {
            MAX_PERSISTED_BYTES.saturating_add(1)
        };
        bytes = bytes.saturating_add(entry_bytes);
        if count > MAX_PERSISTED_PACKS || bytes > MAX_PERSISTED_BYTES {
            break;
        }
    }
    scope.verify()?;
    Ok((count, bytes))
}

fn enforce_storage_quota(
    scope: &BrandStorageScope,
    new_pack_bytes: u64,
    excluded_entry: Option<&std::ffi::OsStr>,
) -> BrandResult<()> {
    let (count, bytes) = persisted_storage_usage(scope, excluded_entry)?;
    if count >= MAX_PERSISTED_PACKS {
        return Err(brand_error(
            "brand_pack_quota_exceeded",
            "Private brand storage already contains the maximum of 16 pack entries.",
        ));
    }
    if bytes.saturating_add(new_pack_bytes) > MAX_PERSISTED_BYTES {
        return Err(brand_error(
            "brand_storage_quota_exceeded",
            "Private brand storage cannot exceed 32 MiB in aggregate.",
        ));
    }
    Ok(())
}

fn list_brand_packs_at(app_data: &Path) -> BrandResult<BrandPackListResult> {
    let scope = BrandStorageScope::bind(app_data)?;
    let mut ids = Vec::new();
    for entry in scope
        .brands
        .entries()
        .map_err(|error| io_error("brand_storage_failed", error))?
    {
        let entry = entry.map_err(|error| io_error("brand_storage_failed", error))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if validate_brand_id(&name) && name != BUILTIN_BRAND_ID {
            ids.push(name);
        }
    }
    ids.sort();
    let mut packs = Vec::new();
    let mut warnings = Vec::new();
    let mut total_bytes = 0_u64;
    for id in ids {
        if packs.len() >= MAX_PERSISTED_PACKS {
            warnings.push(
                "Additional stored brand packs were omitted from this bounded listing.".to_owned(),
            );
            break;
        }
        let loaded = scope.bind_pack(&id).and_then(|(directory, identity)| {
            load_stored_pack_from_directory(&scope, &id, &directory, &identity)
        });
        match loaded {
            Ok(pack) => {
                let pack_bytes = stored_pack_bytes(&pack)?;
                if total_bytes.saturating_add(pack_bytes) > MAX_PERSISTED_BYTES {
                    warnings.push(
                        "Additional stored brand bytes were omitted from this bounded listing."
                            .to_owned(),
                    );
                    break;
                }
                total_bytes += pack_bytes;
                packs.push(pack);
            }
            Err(error) => warnings.push(bounded_native_warning(format!(
                "Stored brand {id} was ignored: {}",
                error.message
            ))),
        }
    }
    Ok(BrandPackListResult { packs, warnings })
}

#[cfg(test)]
fn load_window_icon_at_with_hook(
    app_data: &Path,
    id: &str,
    after_load: impl FnOnce(),
) -> BrandResult<Option<Vec<u8>>> {
    let pack = load_stored_pack_at(app_data, id)?;
    if !pack
        .manifest
        .assets
        .window_icon
        .to_ascii_lowercase()
        .ends_with(".png")
    {
        return Ok(None);
    }
    let bytes = pack
        .assets
        .into_iter()
        .find(|asset| asset.path == pack.manifest.assets.window_icon)
        .map(|asset| asset.bytes)
        .ok_or_else(|| {
            brand_error(
                "brand_storage_invalid",
                "The stored window icon is missing.",
            )
        })?;
    after_load();
    Ok(Some(bytes))
}

#[cfg_attr(target_os = "macos", allow(dead_code))]
fn load_window_icon_for_revision_at(
    app_data: &Path,
    id: &str,
    expected_revision: Option<&str>,
) -> BrandResult<Option<Vec<u8>>> {
    if id == BUILTIN_BRAND_ID {
        if expected_revision.is_some() {
            return Err(brand_error(
                "brand_icon_revision_mismatch",
                "LOOP24 does not use a custom icon revision.",
            ));
        }
        return Ok(None);
    }
    let pack = load_stored_pack_at(app_data, id)?;
    if expected_revision != Some(pack.revision.as_str()) {
        return Err(brand_error(
            "brand_icon_revision_mismatch",
            "The stored brand changed after activation; its icon was not applied.",
        ));
    }
    if !pack
        .manifest
        .assets
        .window_icon
        .to_ascii_lowercase()
        .ends_with(".png")
    {
        return Ok(None);
    }
    pack.assets
        .into_iter()
        .find(|asset| asset.path == pack.manifest.assets.window_icon)
        .map(|asset| Some(asset.bytes))
        .ok_or_else(|| {
            brand_error(
                "brand_storage_invalid",
                "The stored window icon is missing.",
            )
        })
}

#[cfg_attr(target_os = "macos", allow(dead_code))]
enum WindowIconSelection {
    Default { status: &'static str },
    Custom(Vec<u8>),
}

#[cfg_attr(target_os = "macos", allow(dead_code))]
fn select_window_icon_for_revision_at(
    app_data: &Path,
    id: &str,
    expected_revision: Option<&str>,
) -> BrandResult<WindowIconSelection> {
    match load_window_icon_for_revision_at(app_data, id, expected_revision)? {
        Some(bytes) => Ok(WindowIconSelection::Custom(bytes)),
        None if id == BUILTIN_BRAND_ID => Ok(WindowIconSelection::Default { status: "applied" }),
        None => Ok(WindowIconSelection::Default {
            status: "unsupported",
        }),
    }
}

fn activate_brand_pack_at(app_data: &Path, id: &str) -> BrandResult<BrandActivationResult> {
    let scope = BrandStorageScope::bind(app_data)?;
    let pack = if id == BUILTIN_BRAND_ID {
        None
    } else {
        let (directory, identity) = scope.bind_pack(id)?;
        Some(load_stored_pack_from_directory(
            &scope, id, &directory, &identity,
        )?)
    };
    atomic_active_write(&scope, id, pack.as_ref().map(|pack| pack.revision.as_str()))?;
    Ok(BrandActivationResult {
        id: id.to_owned(),
        pack,
    })
}

fn load_active_brand_with_recovery_at(app_data: &Path) -> BrandResult<BrandActiveLoadResult> {
    let loaded = load_active_record_at(app_data).and_then(|record| {
        if record.id == BUILTIN_BRAND_ID {
            return Ok(BrandActiveLoadResult {
                id: record.id,
                pack: None,
                recovered: false,
                warning: None,
            });
        }
        let pack = load_stored_pack_at(app_data, &record.id)?;
        if record.revision.as_deref() != Some(pack.revision.as_str()) {
            return Err(brand_error(
                "brand_active_revision_changed",
                "The active stored brand revision changed and LOOP24 must be restored.",
            ));
        }
        Ok(BrandActiveLoadResult {
            id: record.id,
            pack: Some(pack),
            recovered: false,
            warning: None,
        })
    });
    match loaded {
        Ok(result) => Ok(result),
        Err(error) => {
            activate_brand_pack_at(app_data, BUILTIN_BRAND_ID)?;
            Ok(BrandActiveLoadResult {
                id: BUILTIN_BRAND_ID.to_owned(),
                pack: None,
                recovered: true,
                warning: Some(bounded_native_warning(error.message)),
            })
        }
    }
}

fn reject_unsafe_tree(directory: &Dir) -> BrandResult<()> {
    for entry in directory
        .entries()
        .map_err(|error| io_error("brand_remove_failed", error))?
    {
        let entry = entry.map_err(|error| io_error("brand_remove_failed", error))?;
        let file_type = entry
            .file_type()
            .map_err(|error| io_error("brand_remove_failed", error))?;
        if file_type.is_symlink() {
            return Err(brand_error(
                "brand_storage_scope_invalid",
                "Stored brand removal refused a symbolic link.",
            ));
        }
        if file_type.is_dir() {
            reject_unsafe_tree(
                &entry
                    .open_dir()
                    .map_err(|error| io_error("brand_remove_failed", error))?,
            )?;
        } else if !file_type.is_file() {
            return Err(brand_error(
                "brand_storage_scope_invalid",
                "Stored brand removal refused a special file.",
            ));
        }
    }
    Ok(())
}

fn remove_brand_pack_at(
    app_data: &Path,
    id: &str,
    revert_active: bool,
) -> BrandResult<BrandRemovalResult> {
    remove_brand_pack_at_impl(
        app_data,
        id,
        revert_active,
        || {},
        |directory| directory.remove_open_dir_all(),
    )
}

#[cfg(test)]
fn remove_brand_pack_at_with_remover(
    app_data: &Path,
    id: &str,
    revert_active: bool,
    remover: impl FnOnce(Dir) -> std::io::Result<()>,
) -> BrandResult<BrandRemovalResult> {
    remove_brand_pack_at_impl(app_data, id, revert_active, || {}, remover)
}

#[cfg(test)]
#[cfg_attr(windows, allow(dead_code))]
fn remove_brand_pack_at_with_bound_hook(
    app_data: &Path,
    id: &str,
    revert_active: bool,
    bound_hook: impl FnOnce(),
) -> BrandResult<BrandRemovalResult> {
    remove_brand_pack_at_impl(app_data, id, revert_active, bound_hook, |directory| {
        directory.remove_open_dir_all()
    })
}

fn remove_brand_pack_at_impl(
    app_data: &Path,
    id: &str,
    revert_active: bool,
    bound_hook: impl FnOnce(),
    remover: impl FnOnce(Dir) -> std::io::Result<()>,
) -> BrandResult<BrandRemovalResult> {
    if id == BUILTIN_BRAND_ID {
        return Err(brand_error(
            "brand_builtin_protected",
            "The bundled LOOP24 brand cannot be removed.",
        ));
    }
    if !validate_brand_id(id) {
        return Err(brand_error(
            "brand_not_found",
            "The custom brand does not exist.",
        ));
    }
    let active = load_active_brand_at(app_data)?;
    if active == id && !revert_active {
        return Err(brand_error(
            "brand_active",
            "Revert to LOOP24 before removing the active custom brand.",
        ));
    }
    let scope = BrandStorageScope::bind(app_data)?;
    let (directory, identity) = scope.bind_pack(id)?;
    reject_unsafe_tree(&directory)?;
    bound_hook();
    scope.verify()?;
    if !scope.named_pack_identity_matches(id, &identity) {
        return Err(brand_storage_scope_changed());
    }
    if active == id {
        activate_brand_pack_at(app_data, BUILTIN_BRAND_ID)?;
    }
    match remover(directory) {
        Ok(()) => Ok(BrandRemovalResult {
            active_id: if active == id {
                BUILTIN_BRAND_ID.to_owned()
            } else {
                active
            },
            removed: true,
            warning: None,
        }),
        Err(error) if active == id => Ok(BrandRemovalResult {
            active_id: BUILTIN_BRAND_ID.to_owned(),
            removed: false,
            warning: Some(bounded_native_warning(format!(
                "The active brand reverted to LOOP24, but removal did not finish: {error}"
            ))),
        }),
        Err(error) => Err(io_error("brand_remove_failed", error)),
    }
}

fn app_data(app: &AppHandle) -> BrandResult<PathBuf> {
    app.path().app_data_dir().map_err(|error| {
        brand_error(
            "brand_storage_failed",
            format!("Application data is unavailable: {error}"),
        )
    })
}

#[tauri::command]
pub fn brand_choose_source(
    app: AppHandle,
    grants: State<'_, BrandGrantState>,
) -> BrandResult<Option<BrandSourceSelection>> {
    let Some(selected) = app
        .dialog()
        .file()
        .add_filter("Brand manifests", &["yaml"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = selected.into_path().map_err(|_| {
        brand_error(
            "brand_source_invalid",
            "The selected brand path is not a local filesystem path.",
        )
    })?;
    grant_brand_source(&path, &grants).map(Some)
}

#[tauri::command]
pub fn brand_read_source_assets(
    grant_token: String,
    paths: Vec<String>,
    grants: State<'_, BrandGrantState>,
) -> BrandResult<Vec<BrandSourceAsset>> {
    read_brand_source_assets(&grant_token, &paths, &grants)
}

#[tauri::command]
pub fn brand_revoke_source_grant(
    grant_token: String,
    grants: State<'_, BrandGrantState>,
) -> BrandResult<()> {
    revoke_brand_source_grant(&grant_token, &grants)
}

#[tauri::command]
pub fn import_brand_pack(
    app: AppHandle,
    request: BrandImportRequest,
    grants: State<'_, BrandGrantState>,
) -> BrandResult<ImportedBrand> {
    import_brand_pack_at(&app_data(&app)?, request, &grants)
}

#[tauri::command]
pub fn activate_brand_pack(app: AppHandle, id: String) -> BrandResult<BrandActivationResult> {
    activate_brand_pack_at(&app_data(&app)?, &id)
}

#[tauri::command]
pub fn remove_brand_pack(
    app: AppHandle,
    id: String,
    revert_active: bool,
) -> BrandResult<BrandRemovalResult> {
    remove_brand_pack_at(&app_data(&app)?, &id, revert_active)
}

#[tauri::command]
pub fn brand_load_active(app: AppHandle) -> BrandResult<BrandActiveLoadResult> {
    load_active_brand_with_recovery_at(&app_data(&app)?)
}

#[tauri::command]
pub fn brand_list_packs(app: AppHandle) -> BrandResult<BrandPackListResult> {
    list_brand_packs_at(&app_data(&app)?)
}

#[tauri::command]
pub fn brand_load_pack(app: AppHandle, id: String) -> BrandResult<StoredBrandPack> {
    load_stored_pack_at(&app_data(&app)?, &id)
}

#[tauri::command]
pub fn set_window_icon(
    app: AppHandle,
    id: String,
    expected_revision: Option<String>,
) -> BrandResult<WindowIconResult> {
    #[cfg(target_os = "macos")]
    {
        let _ = (app, id, expected_revision);
        Ok(WindowIconResult {
            status: "unsupported",
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        let selection = select_window_icon_for_revision_at(
            &app_data(&app)?,
            &id,
            expected_revision.as_deref(),
        )?;
        let (image, status) = match selection {
            WindowIconSelection::Default { status } => (
                app.default_window_icon().cloned().ok_or_else(|| {
                    brand_error(
                        "brand_icon_failed",
                        "The bundled default window icon is unavailable.",
                    )
                })?,
                status,
            ),
            WindowIconSelection::Custom(bytes) => (
                tauri::image::Image::from_bytes(&bytes)
                    .map_err(|error| brand_error("brand_icon_failed", error.to_string()))?,
                "applied",
            ),
        };
        let window = app.get_webview_window("main").ok_or_else(|| {
            brand_error(
                "brand_icon_failed",
                "The main application window is unavailable.",
            )
        })?;
        window
            .set_icon(image)
            .map_err(|error| brand_error("brand_icon_failed", error.to_string()))?;
        Ok(WindowIconResult { status })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::fs;

    fn svg(fill: &str) -> Vec<u8> {
        format!(
            r#"<svg xmlns="http://www.w3.org/2000/svg"><path fill="{fill}" d="M0 0h1v1z"/></svg>"#
        )
        .into_bytes()
    }

    fn source_pack() -> (tempfile::TempDir, std::path::PathBuf) {
        let source = tempfile::tempdir().unwrap();
        let manifest_path = source.path().join("brand.yaml");
        fs::write(&manifest_path, serde_yaml::to_string(&manifest()).unwrap()).unwrap();
        fs::write(source.path().join("logo.svg"), svg("#112233")).unwrap();
        fs::write(source.path().join("mark.svg"), svg("#445566")).unwrap();
        (source, manifest_path)
    }

    fn theme() -> HashMap<String, String> {
        THEME_TOKEN_NAMES
            .iter()
            .map(|name| {
                let value = match *name {
                    "background" | "surface" | "surface-elevated" | "accent-contrast"
                    | "canvas" | "node" | "node-selected" | "yaml-gutter" | "shadow" => "#000000",
                    _ => "#FFFFFF",
                };
                ((*name).to_owned(), value.to_owned())
            })
            .collect()
    }

    fn valid_png() -> Vec<u8> {
        vec![
            137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1,
            8, 4, 0, 0, 0, 181, 28, 12, 2, 0, 0, 0, 11, 73, 68, 65, 84, 120, 218, 99, 100, 248, 15,
            0, 1, 5, 1, 1, 39, 24, 227, 102, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
        ]
    }

    fn valid_png_with_text_chunk() -> Vec<u8> {
        let source = valid_png();
        let iend_offset = source.len() - 12;
        let data = b"x\0";
        let mut crc_input = b"tEXt".to_vec();
        crc_input.extend_from_slice(data);
        let mut result = source[..iend_offset].to_vec();
        result.extend_from_slice(&(data.len() as u32).to_be_bytes());
        result.extend_from_slice(b"tEXt");
        result.extend_from_slice(data);
        result.extend_from_slice(&crc32(&crc_input).to_be_bytes());
        result.extend_from_slice(&source[iend_offset..]);
        result
    }

    fn manifest() -> NativeBrandManifest {
        NativeBrandManifest {
            schema_version: 1,
            id: "acme".to_owned(),
            display_name: "Acme Studio".to_owned(),
            assets: NativeBrandAssets {
                logo: "logo.svg".to_owned(),
                mark: "mark.svg".to_owned(),
                window_icon: "mark.svg".to_owned(),
            },
            themes: NativeBrandThemes {
                light: theme(),
                dark: theme(),
            },
        }
    }

    fn request(
        selection: &BrandSourceSelection,
        sources: &[BrandSourceAsset],
    ) -> BrandImportRequest {
        BrandImportRequest {
            grant_token: selection.grant_token.clone(),
            manifest: manifest(),
            manifest_source_sha256: selection.manifest_sha256.clone(),
            assets: sources
                .iter()
                .map(|source| BrandImportAsset {
                    path: source.path.clone(),
                    source_sha256: source.sha256.clone(),
                    media_type: "image/svg+xml".to_owned(),
                    sanitized_bytes: source.bytes.clone(),
                })
                .collect(),
        }
    }

    #[test]
    fn selected_source_is_identity_bound_and_rejects_replacement_before_read() {
        let (_source, path) = source_pack();
        let grants = BrandGrantState::default();
        let selection = grant_brand_source(&path, &grants).unwrap();
        let parked = path.with_extension("old");
        fs::rename(&path, &parked).unwrap();
        fs::write(&path, "schemaVersion: 1\nid: replacement\n").unwrap();

        let error =
            read_brand_source_assets(&selection.grant_token, &["logo.svg".to_owned()], &grants)
                .unwrap_err();

        assert_eq!(error.code, "brand_source_changed");
    }

    #[test]
    fn source_grant_reads_only_exact_manifest_assets_and_rejects_manifest_substitution() {
        let (_source, path) = source_pack();
        fs::write(path.parent().unwrap().join("adjacent.svg"), svg("#ABCDEF")).unwrap();
        let app_data = tempfile::tempdir().unwrap();
        let grants = BrandGrantState::default();
        let selection = grant_brand_source(&path, &grants).unwrap();

        assert_eq!(
            read_brand_source_assets(&selection.grant_token, &["logo.svg".to_owned()], &grants,)
                .unwrap_err()
                .code,
            "brand_asset_set_invalid"
        );
        assert_eq!(
            read_brand_source_assets(
                &selection.grant_token,
                &["adjacent.svg".to_owned()],
                &grants,
            )
            .unwrap_err()
            .code,
            "brand_asset_set_invalid"
        );
        let sources = read_brand_source_assets(
            &selection.grant_token,
            &["logo.svg".to_owned(), "mark.svg".to_owned()],
            &grants,
        )
        .unwrap();
        let mut substituted = request(&selection, &sources);
        substituted.manifest.display_name = "Substituted Studio".to_owned();
        assert_eq!(
            import_brand_pack_at(app_data.path(), substituted, &grants)
                .unwrap_err()
                .code,
            "brand_manifest_mismatch"
        );
    }

    #[test]
    fn source_grants_can_be_revoked_idempotently_before_import() {
        let (_source, path) = source_pack();
        let app_data = tempfile::tempdir().unwrap();
        let grants = BrandGrantState::default();
        let selection = grant_brand_source(&path, &grants).unwrap();
        let sources = read_brand_source_assets(
            &selection.grant_token,
            &["logo.svg".to_owned(), "mark.svg".to_owned()],
            &grants,
        )
        .unwrap();

        revoke_brand_source_grant(&selection.grant_token, &grants).unwrap();
        revoke_brand_source_grant(&selection.grant_token, &grants).unwrap();

        assert_eq!(
            import_brand_pack_at(app_data.path(), request(&selection, &sources), &grants)
                .unwrap_err()
                .code,
            "brand_grant_required"
        );
    }

    #[cfg(unix)]
    #[test]
    fn source_reader_rejects_symlinks_and_paths_outside_the_granted_directory() {
        use std::os::unix::fs::symlink;

        let (_source, path) = source_pack();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("outside.svg"), svg("#000000")).unwrap();
        symlink(
            outside.path().join("outside.svg"),
            path.parent().unwrap().join("linked.svg"),
        )
        .unwrap();
        let grants = BrandGrantState::default();
        let selection = grant_brand_source(&path, &grants).unwrap();

        for relative in [
            "linked.svg",
            "../outside.svg",
            "/tmp/outside.svg",
            "nested\\..\\outside.svg",
        ] {
            let error =
                read_brand_source_assets(&selection.grant_token, &[relative.to_owned()], &grants)
                    .unwrap_err();
            assert!(matches!(
                error.code.as_str(),
                "brand_asset_path_invalid" | "brand_source_changed" | "brand_asset_set_invalid"
            ));
        }
    }

    #[cfg(unix)]
    #[test]
    fn source_reader_keeps_a_nested_directory_capability_when_its_name_is_swapped() {
        use std::os::unix::fs::symlink;

        let (source, path) = source_pack();
        let nested = source.path().join("nested");
        fs::create_dir(&nested).unwrap();
        let expected = svg("#123456");
        fs::write(nested.join("logo.svg"), &expected).unwrap();
        let mut source_manifest = manifest();
        source_manifest.assets.logo = "nested/logo.svg".to_owned();
        fs::write(&path, serde_yaml::to_string(&source_manifest).unwrap()).unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("logo.svg"), svg("#DEAD00")).unwrap();
        let grants = BrandGrantState::default();
        let selection = grant_brand_source(&path, &grants).unwrap();
        let parked = source.path().join("parked-nested");

        let assets = read_brand_source_assets_with_bound_hook(
            &selection.grant_token,
            &["nested/logo.svg".to_owned(), "mark.svg".to_owned()],
            &grants,
            |relative| {
                if relative == "nested/logo.svg" {
                    fs::rename(&nested, &parked).unwrap();
                    symlink(outside.path(), &nested).unwrap();
                }
            },
        )
        .unwrap();

        assert_eq!(assets[0].bytes, expected);
        assert_eq!(
            fs::read(outside.path().join("logo.svg")).unwrap(),
            svg("#DEAD00")
        );
    }

    #[test]
    fn imports_only_validated_referenced_bytes_into_private_app_data() {
        let (_source, path) = source_pack();
        fs::write(path.parent().unwrap().join("ignored.svg"), svg("#ABCDEF")).unwrap();
        let app_data = tempfile::tempdir().unwrap();
        let grants = BrandGrantState::default();
        let selection = grant_brand_source(&path, &grants).unwrap();
        let sources = read_brand_source_assets(
            &selection.grant_token,
            &["logo.svg".to_owned(), "mark.svg".to_owned()],
            &grants,
        )
        .unwrap();

        let imported =
            import_brand_pack_at(app_data.path(), request(&selection, &sources), &grants).unwrap();

        assert_eq!(imported.id, "acme");
        let stored = app_data.path().join("brands/acme");
        assert!(stored.join("brand.yaml").is_file());
        assert_eq!(fs::read(stored.join("logo.svg")).unwrap(), sources[0].bytes);
        assert_eq!(fs::read(stored.join("mark.svg")).unwrap(), sources[1].bytes);
        assert!(!stored.join("ignored.svg").exists());
        assert!(fs::read_to_string(stored.join("brand.yaml"))
            .unwrap()
            .contains("\"id\": \"acme\""));
        assert!(fs::read_dir(app_data.path().join("brands"))
            .unwrap()
            .all(|entry| !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .contains(".tmp")));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&stored).unwrap().permissions().mode() & 0o777,
                0o700
            );
            assert_eq!(
                fs::metadata(stored.join("brand.yaml"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
    }

    #[test]
    fn list_retains_inactive_valid_packs_and_reports_corrupt_entries_without_hiding_valid_ones() {
        let (_source, path) = source_pack();
        let app_data = tempfile::tempdir().unwrap();
        let grants = BrandGrantState::default();
        let selection = grant_brand_source(&path, &grants).unwrap();
        let sources = read_brand_source_assets(
            &selection.grant_token,
            &["logo.svg".to_owned(), "mark.svg".to_owned()],
            &grants,
        )
        .unwrap();
        import_brand_pack_at(app_data.path(), request(&selection, &sources), &grants).unwrap();
        activate_brand_pack_at(app_data.path(), BUILTIN_BRAND_ID).unwrap();
        let corrupt = app_data.path().join("brands/corrupt");
        fs::create_dir(&corrupt).unwrap();
        fs::write(corrupt.join("brand.yaml"), b"not-json").unwrap();

        let listed = list_brand_packs_at(app_data.path()).unwrap();

        assert_eq!(listed.packs.len(), 1);
        assert_eq!(listed.packs[0].manifest.id, "acme");
        assert!(listed.packs[0].revision.starts_with("sha256:"));
        assert_eq!(listed.warnings.len(), 1);
        assert!(listed.warnings[0].contains("corrupt"));
    }

    #[test]
    fn import_rejects_a_seventeenth_persisted_entry_without_partial_storage_or_consuming_grant() {
        let (_source, path) = source_pack();
        let app_data = tempfile::tempdir().unwrap();
        let storage = app_data.path().join("brands");
        fs::create_dir(&storage).unwrap();
        for index in 0..16 {
            fs::create_dir(storage.join(format!("corrupt-{index}"))).unwrap();
        }
        let grants = BrandGrantState::default();
        let selection = grant_brand_source(&path, &grants).unwrap();
        let sources = read_brand_source_assets(
            &selection.grant_token,
            &["logo.svg".to_owned(), "mark.svg".to_owned()],
            &grants,
        )
        .unwrap();

        let error = import_brand_pack_at(app_data.path(), request(&selection, &sources), &grants)
            .unwrap_err();

        assert_eq!(error.code, "brand_pack_quota_exceeded");
        assert!(!storage.join("acme").exists());
        assert!(fs::read_dir(&storage).unwrap().all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".acme-")));
        fs::remove_dir(storage.join("corrupt-15")).unwrap();
        assert!(
            import_brand_pack_at(app_data.path(), request(&selection, &sources), &grants,).is_ok()
        );
    }

    #[test]
    fn import_rejects_aggregate_persisted_bytes_conservatively_without_consuming_grant() {
        let (_source, path) = source_pack();
        let app_data = tempfile::tempdir().unwrap();
        let storage = app_data.path().join("brands");
        fs::create_dir(&storage).unwrap();
        let quota_filler = storage.join("corrupt-bytes");
        fs::File::create(&quota_filler)
            .unwrap()
            .set_len(32 * 1024 * 1024)
            .unwrap();
        let grants = BrandGrantState::default();
        let selection = grant_brand_source(&path, &grants).unwrap();
        let sources = read_brand_source_assets(
            &selection.grant_token,
            &["logo.svg".to_owned(), "mark.svg".to_owned()],
            &grants,
        )
        .unwrap();

        let error = import_brand_pack_at(app_data.path(), request(&selection, &sources), &grants)
            .unwrap_err();

        assert_eq!(error.code, "brand_storage_quota_exceeded");
        assert!(!storage.join("acme").exists());
        fs::remove_file(quota_filler).unwrap();
        assert!(
            import_brand_pack_at(app_data.path(), request(&selection, &sources), &grants,).is_ok()
        );
    }

    #[test]
    fn activation_returns_and_persists_the_exact_revalidated_stored_revision() {
        let (_source, path) = source_pack();
        let app_data = tempfile::tempdir().unwrap();
        let grants = BrandGrantState::default();
        let selection = grant_brand_source(&path, &grants).unwrap();
        let sources = read_brand_source_assets(
            &selection.grant_token,
            &["logo.svg".to_owned(), "mark.svg".to_owned()],
            &grants,
        )
        .unwrap();
        import_brand_pack_at(app_data.path(), request(&selection, &sources), &grants).unwrap();

        let activated = activate_brand_pack_at(app_data.path(), "acme").unwrap();
        let pack = activated.pack.unwrap();
        let record = load_active_record_at(app_data.path()).unwrap();

        assert_eq!(activated.id, "acme");
        assert_eq!(record.revision.as_deref(), Some(pack.revision.as_str()));
        assert_eq!(
            pack.assets[0].bytes,
            fs::read(app_data.path().join("brands/acme/logo.svg")).unwrap()
        );
    }

    #[test]
    fn startup_revision_corruption_recovers_to_loop24_with_a_bounded_warning() {
        let (_source, path) = source_pack();
        let app_data = tempfile::tempdir().unwrap();
        let grants = BrandGrantState::default();
        let selection = grant_brand_source(&path, &grants).unwrap();
        let sources = read_brand_source_assets(
            &selection.grant_token,
            &["logo.svg".to_owned(), "mark.svg".to_owned()],
            &grants,
        )
        .unwrap();
        import_brand_pack_at(app_data.path(), request(&selection, &sources), &grants).unwrap();
        activate_brand_pack_at(app_data.path(), "acme").unwrap();
        fs::write(app_data.path().join("brands/acme/logo.svg"), svg("#ABCDEF")).unwrap();

        let result = load_active_brand_with_recovery_at(app_data.path()).unwrap();

        assert_eq!(result.id, BUILTIN_BRAND_ID);
        assert!(result.recovered);
        assert!(result
            .warning
            .as_deref()
            .is_some_and(|warning| warning.len() <= 4096));
        assert_eq!(
            load_active_brand_at(app_data.path()).unwrap(),
            BUILTIN_BRAND_ID
        );
    }

    #[test]
    fn active_removal_failure_returns_coherent_loop24_state_for_renderer_reconciliation() {
        let (_source, path) = source_pack();
        let app_data = tempfile::tempdir().unwrap();
        let grants = BrandGrantState::default();
        let selection = grant_brand_source(&path, &grants).unwrap();
        let sources = read_brand_source_assets(
            &selection.grant_token,
            &["logo.svg".to_owned(), "mark.svg".to_owned()],
            &grants,
        )
        .unwrap();
        import_brand_pack_at(app_data.path(), request(&selection, &sources), &grants).unwrap();
        activate_brand_pack_at(app_data.path(), "acme").unwrap();

        let result = remove_brand_pack_at_with_remover(app_data.path(), "acme", true, |_| {
            Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "denied",
            ))
        })
        .unwrap();

        assert_eq!(result.active_id, BUILTIN_BRAND_ID);
        assert!(!result.removed);
        assert!(result
            .warning
            .as_deref()
            .is_some_and(|warning| warning.contains("did not finish")));
        assert_eq!(
            load_active_brand_at(app_data.path()).unwrap(),
            BUILTIN_BRAND_ID
        );
        assert!(app_data.path().join("brands/acme").is_dir());
    }

    #[cfg(unix)]
    #[test]
    fn stored_pack_load_and_removal_never_follow_a_replaced_pack_ancestor() {
        use std::os::unix::fs::symlink;

        let (_source, path) = source_pack();
        let app_data = tempfile::tempdir().unwrap();
        let grants = BrandGrantState::default();
        let selection = grant_brand_source(&path, &grants).unwrap();
        let sources = read_brand_source_assets(
            &selection.grant_token,
            &["logo.svg".to_owned(), "mark.svg".to_owned()],
            &grants,
        )
        .unwrap();
        import_brand_pack_at(app_data.path(), request(&selection, &sources), &grants).unwrap();
        let storage = app_data.path().join("brands");
        let pack_path = storage.join("acme");
        let parked = storage.join("parked-acme");
        let outside = tempfile::tempdir().unwrap();
        fs::copy(
            pack_path.join("brand.yaml"),
            outside.path().join("brand.yaml"),
        )
        .unwrap();
        fs::copy(pack_path.join("logo.svg"), outside.path().join("logo.svg")).unwrap();
        fs::copy(pack_path.join("mark.svg"), outside.path().join("mark.svg")).unwrap();
        fs::write(outside.path().join("sentinel"), b"outside").unwrap();

        let loaded = load_stored_pack_at_with_bound_hook(app_data.path(), "acme", || {
            fs::rename(&pack_path, &parked).unwrap();
            symlink(outside.path(), &pack_path).unwrap();
        })
        .unwrap_err();

        assert_eq!(loaded.code, "brand_storage_scope_invalid");
        assert_eq!(
            fs::read(outside.path().join("sentinel")).unwrap(),
            b"outside"
        );

        fs::remove_file(&pack_path).unwrap();
        fs::rename(&parked, &pack_path).unwrap();
        let removal = remove_brand_pack_at_with_bound_hook(app_data.path(), "acme", false, || {
            fs::rename(&pack_path, &parked).unwrap();
            symlink(outside.path(), &pack_path).unwrap();
        })
        .unwrap_err();

        assert_eq!(removal.code, "brand_storage_scope_invalid");
        assert_eq!(
            fs::read(outside.path().join("sentinel")).unwrap(),
            b"outside"
        );
        assert!(parked.is_dir());
    }

    #[test]
    fn icon_loading_is_revision_bound_and_loop24_selects_the_default_icon_path() {
        let (_source, path) = source_pack();
        let app_data = tempfile::tempdir().unwrap();
        let grants = BrandGrantState::default();
        let selection = grant_brand_source(&path, &grants).unwrap();
        let sources = read_brand_source_assets(
            &selection.grant_token,
            &["logo.svg".to_owned(), "mark.svg".to_owned()],
            &grants,
        )
        .unwrap();
        import_brand_pack_at(app_data.path(), request(&selection, &sources), &grants).unwrap();
        let pack = load_stored_pack_at(app_data.path(), "acme").unwrap();

        assert!(
            load_window_icon_for_revision_at(app_data.path(), "acme", Some("sha256:stale"))
                .is_err()
        );
        assert!(
            load_window_icon_for_revision_at(app_data.path(), "acme", Some(&pack.revision))
                .unwrap()
                .is_none()
        );
        assert!(matches!(
            select_window_icon_for_revision_at(app_data.path(), "acme", Some(&pack.revision))
                .unwrap(),
            WindowIconSelection::Default {
                status: "unsupported"
            }
        ));
        assert!(
            load_window_icon_for_revision_at(app_data.path(), BUILTIN_BRAND_ID, None)
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn import_rechecks_every_source_after_renderer_validation() {
        let (_source, path) = source_pack();
        let app_data = tempfile::tempdir().unwrap();
        let grants = BrandGrantState::default();
        let selection = grant_brand_source(&path, &grants).unwrap();
        let sources = read_brand_source_assets(
            &selection.grant_token,
            &["logo.svg".to_owned(), "mark.svg".to_owned()],
            &grants,
        )
        .unwrap();
        fs::write(path.parent().unwrap().join("logo.svg"), svg("#DEAD00")).unwrap();

        let error = import_brand_pack_at(app_data.path(), request(&selection, &sources), &grants)
            .unwrap_err();

        assert_eq!(error.code, "brand_source_changed");
        assert!(!app_data.path().join("brands/acme").exists());
    }

    #[test]
    fn import_rejects_different_safe_svg_and_png_bytes_for_an_exact_source_grant() {
        let (_source, path) = source_pack();
        let app_data = tempfile::tempdir().unwrap();
        let grants = BrandGrantState::default();
        let selection = grant_brand_source(&path, &grants).unwrap();
        let sources = read_brand_source_assets(
            &selection.grant_token,
            &["logo.svg".to_owned(), "mark.svg".to_owned()],
            &grants,
        )
        .unwrap();
        let mut substituted_svg = request(&selection, &sources);
        substituted_svg.assets[0].sanitized_bytes = svg("#ABCDEF");

        assert_eq!(
            import_brand_pack_at(app_data.path(), substituted_svg, &grants)
                .unwrap_err()
                .code,
            "brand_source_changed"
        );

        let png_source = tempfile::tempdir().unwrap();
        let mut png_manifest = manifest();
        png_manifest.assets.window_icon = "icon.png".to_owned();
        let png_manifest_path = png_source.path().join("brand.yaml");
        fs::write(
            &png_manifest_path,
            serde_yaml::to_string(&png_manifest).unwrap(),
        )
        .unwrap();
        fs::write(png_source.path().join("logo.svg"), svg("#112233")).unwrap();
        fs::write(png_source.path().join("mark.svg"), svg("#445566")).unwrap();
        fs::write(png_source.path().join("icon.png"), valid_png()).unwrap();
        let png_grants = BrandGrantState::default();
        let png_selection = grant_brand_source(&png_manifest_path, &png_grants).unwrap();
        let png_sources = read_brand_source_assets(
            &png_selection.grant_token,
            &[
                "logo.svg".to_owned(),
                "mark.svg".to_owned(),
                "icon.png".to_owned(),
            ],
            &png_grants,
        )
        .unwrap();
        let mut substituted_png = BrandImportRequest {
            grant_token: png_selection.grant_token.clone(),
            manifest: png_manifest,
            manifest_source_sha256: png_selection.manifest_sha256.clone(),
            assets: png_sources
                .iter()
                .map(|source| BrandImportAsset {
                    path: source.path.clone(),
                    source_sha256: source.sha256.clone(),
                    media_type: if source.path.ends_with(".png") {
                        "image/png".to_owned()
                    } else {
                        "image/svg+xml".to_owned()
                    },
                    sanitized_bytes: source.bytes.clone(),
                })
                .collect(),
        };
        let alternate_png = valid_png_with_text_chunk();
        assert!(validate_png(&alternate_png));
        substituted_png
            .assets
            .iter_mut()
            .find(|asset| asset.path == "icon.png")
            .unwrap()
            .sanitized_bytes = alternate_png;

        assert_eq!(
            import_brand_pack_at(app_data.path(), substituted_png, &png_grants)
                .unwrap_err()
                .code,
            "brand_source_changed"
        );
    }

    #[test]
    fn import_rechecks_manifest_and_parent_identity_at_the_final_boundary() {
        let (source, path) = source_pack();
        let app_data = tempfile::tempdir().unwrap();
        let grants = BrandGrantState::default();
        let selection = grant_brand_source(&path, &grants).unwrap();
        let sources = read_brand_source_assets(
            &selection.grant_token,
            &["logo.svg".to_owned(), "mark.svg".to_owned()],
            &grants,
        )
        .unwrap();
        fs::write(&path, "schemaVersion: 1\nid: changed\n").unwrap();
        assert_eq!(
            import_brand_pack_at(app_data.path(), request(&selection, &sources), &grants)
                .unwrap_err()
                .code,
            "brand_source_changed"
        );

        fs::write(&path, serde_yaml::to_string(&manifest()).unwrap()).unwrap();
        let replacement_grants = BrandGrantState::default();
        let replacement = grant_brand_source(&path, &replacement_grants).unwrap();
        let replacement_sources = read_brand_source_assets(
            &replacement.grant_token,
            &["logo.svg".to_owned(), "mark.svg".to_owned()],
            &replacement_grants,
        )
        .unwrap();
        let parked = source.path().with_extension("parked");
        fs::rename(source.path(), &parked).unwrap();
        fs::create_dir(source.path()).unwrap();
        assert_eq!(
            import_brand_pack_at(
                app_data.path(),
                request(&replacement, &replacement_sources),
                &replacement_grants,
            )
            .unwrap_err()
            .code,
            "brand_source_changed"
        );
    }

    #[test]
    fn duplicate_manifest_references_require_one_exact_payload_without_alias_collision() {
        let (_source, path) = source_pack();
        let mut source_manifest = manifest();
        source_manifest.assets.mark = "logo.svg".to_owned();
        source_manifest.assets.window_icon = "logo.svg".to_owned();
        fs::write(&path, serde_yaml::to_string(&source_manifest).unwrap()).unwrap();
        let app_data = tempfile::tempdir().unwrap();
        let grants = BrandGrantState::default();
        let selection = grant_brand_source(&path, &grants).unwrap();
        let sources =
            read_brand_source_assets(&selection.grant_token, &["logo.svg".to_owned()], &grants)
                .unwrap();
        let mut exact = request(&selection, &sources);
        exact.manifest.assets.mark = "logo.svg".to_owned();
        exact.manifest.assets.window_icon = "logo.svg".to_owned();
        assert!(import_brand_pack_at(app_data.path(), exact, &grants).is_ok());

        let other_data = tempfile::tempdir().unwrap();
        let other_grants = BrandGrantState::default();
        let other = grant_brand_source(&path, &other_grants).unwrap();
        let other_sources =
            read_brand_source_assets(&other.grant_token, &["logo.svg".to_owned()], &other_grants)
                .unwrap();
        let mut duplicate = request(&other, &other_sources);
        duplicate.manifest.assets.mark = "logo.svg".to_owned();
        duplicate.manifest.assets.window_icon = "logo.svg".to_owned();
        duplicate.assets.push(duplicate.assets[0].clone());
        assert_eq!(
            import_brand_pack_at(other_data.path(), duplicate, &other_grants)
                .unwrap_err()
                .code,
            "brand_asset_set_invalid"
        );
    }

    #[test]
    fn failed_staged_write_rolls_back_every_temporary_file() {
        let (_source, path) = source_pack();
        let app_data = tempfile::tempdir().unwrap();
        let grants = BrandGrantState::default();
        let selection = grant_brand_source(&path, &grants).unwrap();
        let sources = read_brand_source_assets(
            &selection.grant_token,
            &["logo.svg".to_owned(), "mark.svg".to_owned()],
            &grants,
        )
        .unwrap();
        let error = import_brand_pack_at_with_commit_hook(
            app_data.path(),
            request(&selection, &sources),
            &grants,
            |storage| fs::create_dir(storage.join("acme")).unwrap(),
        )
        .unwrap_err();
        assert_eq!(error.code, "brand_storage_scope_invalid");
        let storage = app_data.path().join("brands");
        assert!(fs::read_dir(storage).unwrap().all(|entry| {
            let name = entry.unwrap().file_name();
            name == "acme" || !name.to_string_lossy().starts_with(".acme-")
        }));
    }

    #[test]
    fn corrupt_activation_leaves_the_previous_active_id_unchanged() {
        let (_source, path) = source_pack();
        let app_data = tempfile::tempdir().unwrap();
        let grants = BrandGrantState::default();
        let selection = grant_brand_source(&path, &grants).unwrap();
        let sources = read_brand_source_assets(
            &selection.grant_token,
            &["logo.svg".to_owned(), "mark.svg".to_owned()],
            &grants,
        )
        .unwrap();
        import_brand_pack_at(app_data.path(), request(&selection, &sources), &grants).unwrap();
        activate_brand_pack_at(app_data.path(), BUILTIN_BRAND_ID).unwrap();
        fs::write(app_data.path().join("brands/acme/logo.svg"), b"<script/>").unwrap();

        assert!(activate_brand_pack_at(app_data.path(), "acme").is_err());
        assert_eq!(
            load_active_brand_at(app_data.path()).unwrap(),
            BUILTIN_BRAND_ID
        );
    }

    #[test]
    fn window_icon_intake_accepts_only_a_bounded_valid_png() {
        let mut asset = BrandImportAsset {
            path: "icon.png".to_owned(),
            source_sha256: String::new(),
            media_type: "image/png".to_owned(),
            sanitized_bytes: valid_png(),
        };
        assert!(validate_sanitized_asset(&asset).is_ok());
        asset.sanitized_bytes = valid_png();
        asset.sanitized_bytes[29] ^= 0xff;
        assert_eq!(
            validate_sanitized_asset(&asset).unwrap_err().code,
            "brand_asset_invalid"
        );
        asset.sanitized_bytes = valid_png();
        asset.sanitized_bytes[16..20].copy_from_slice(&4097_u32.to_be_bytes());
        assert_eq!(
            validate_sanitized_asset(&asset).unwrap_err().code,
            "brand_asset_invalid"
        );
        asset.path = "icon.svg".to_owned();
        assert_eq!(
            validate_sanitized_asset(&asset).unwrap_err().code,
            "brand_asset_invalid"
        );
    }

    #[test]
    fn native_png_revalidation_requires_a_complete_decodable_image() {
        let mut asset = BrandImportAsset {
            path: "icon.png".to_owned(),
            source_sha256: String::new(),
            media_type: "image/png".to_owned(),
            sanitized_bytes: valid_png()[..33].to_vec(),
        };
        assert_eq!(
            validate_sanitized_asset(&asset).unwrap_err().code,
            "brand_asset_invalid"
        );

        asset.sanitized_bytes = valid_png();
        asset.sanitized_bytes.pop();
        assert_eq!(
            validate_sanitized_asset(&asset).unwrap_err().code,
            "brand_asset_invalid"
        );

        asset.sanitized_bytes = valid_png();
        let final_byte = asset.sanitized_bytes.last_mut().unwrap();
        *final_byte ^= 0xff;
        assert_eq!(
            validate_sanitized_asset(&asset).unwrap_err().code,
            "brand_asset_invalid"
        );

        asset.sanitized_bytes = valid_png();
        asset.sanitized_bytes[43] ^= 0xff;
        let idat_crc = crc32(&asset.sanitized_bytes[37..52]);
        asset.sanitized_bytes[52..56].copy_from_slice(&idat_crc.to_be_bytes());
        assert_eq!(
            validate_sanitized_asset(&asset).unwrap_err().code,
            "brand_asset_invalid"
        );
    }

    #[test]
    fn native_svg_revalidation_structurally_rejects_renderer_bypass_payloads() {
        let valid = BrandImportAsset {
            path: "mark.SvG".to_owned(),
            source_sha256: String::new(),
            media_type: "image/svg+xml".to_owned(),
            sanitized_bytes: svg("#000000"),
        };
        assert!(safe_asset_path(&valid.path));
        validate_sanitized_asset(&valid).unwrap();

        for payload in [
            r#"<svg xmlns="http://www.w3.org/2000/svg"><path onmouseover = "alert(1)" d="M0 0h1v1z"/></svg>"#,
            r#"<svg xmlns="http://www.w3.org/2000/svg"><use href = "https://example.com/mark.svg#id"/></svg>"#,
            r#"<svg xmlns="http://www.w3.org/2000/svg"><evil:script xmlns:evil="urn:evil"/></svg>"#,
            r#"<svg xmlns="http://www.w3.org/2000/svg"><g>"#,
        ] {
            let mut asset = valid.clone();
            asset.sanitized_bytes = payload.as_bytes().to_vec();
            assert_eq!(
                validate_sanitized_asset(&asset).unwrap_err().code,
                "brand_asset_invalid"
            );
        }
    }

    #[test]
    fn window_icon_uses_the_exact_bounded_bytes_that_were_validated_before_path_replacement() {
        let (_source, path) = source_pack();
        fs::write(path.parent().unwrap().join("icon.png"), valid_png()).unwrap();
        let mut source_manifest = manifest();
        source_manifest.assets.window_icon = "icon.png".to_owned();
        fs::write(&path, serde_yaml::to_string(&source_manifest).unwrap()).unwrap();
        let app_data = tempfile::tempdir().unwrap();
        let grants = BrandGrantState::default();
        let selection = grant_brand_source(&path, &grants).unwrap();
        let sources = read_brand_source_assets(
            &selection.grant_token,
            &[
                "logo.svg".to_owned(),
                "mark.svg".to_owned(),
                "icon.png".to_owned(),
            ],
            &grants,
        )
        .unwrap();
        let mut import = request(&selection, &sources);
        import.manifest.assets.window_icon = "icon.png".to_owned();
        import.assets = sources
            .iter()
            .map(|source| BrandImportAsset {
                path: source.path.clone(),
                source_sha256: source.sha256.clone(),
                media_type: if source.path.ends_with(".png") {
                    "image/png".to_owned()
                } else {
                    "image/svg+xml".to_owned()
                },
                sanitized_bytes: source.bytes.clone(),
            })
            .collect();
        import_brand_pack_at(app_data.path(), import, &grants).unwrap();
        let icon_path = app_data.path().join("brands/acme/icon.png");

        let loaded = load_window_icon_at_with_hook(app_data.path(), "acme", || {
            fs::rename(&icon_path, icon_path.with_extension("old")).unwrap();
            fs::write(&icon_path, b"replacement").unwrap();
        })
        .unwrap()
        .unwrap();

        assert_eq!(loaded, valid_png());
    }

    #[test]
    fn import_rejects_duplicates_oversized_or_unreferenced_payloads_without_partial_storage() {
        let (_source, path) = source_pack();
        let app_data = tempfile::tempdir().unwrap();
        let grants = BrandGrantState::default();
        let selection = grant_brand_source(&path, &grants).unwrap();
        let sources = read_brand_source_assets(
            &selection.grant_token,
            &["logo.svg".to_owned(), "mark.svg".to_owned()],
            &grants,
        )
        .unwrap();
        import_brand_pack_at(app_data.path(), request(&selection, &sources), &grants).unwrap();

        let second_grant = BrandGrantState::default();
        let second = grant_brand_source(&path, &second_grant).unwrap();
        let second_sources = read_brand_source_assets(
            &second.grant_token,
            &["logo.svg".to_owned(), "mark.svg".to_owned()],
            &second_grant,
        )
        .unwrap();
        let duplicate = import_brand_pack_at(
            app_data.path(),
            request(&second, &second_sources),
            &second_grant,
        )
        .unwrap_err();
        assert_eq!(duplicate.code, "brand_id_exists");

        let third_grant = BrandGrantState::default();
        let third = grant_brand_source(&path, &third_grant).unwrap();
        let third_sources = read_brand_source_assets(
            &third.grant_token,
            &["logo.svg".to_owned(), "mark.svg".to_owned()],
            &third_grant,
        )
        .unwrap();
        let mut bad = request(&third, &third_sources);
        bad.manifest.id = "other".to_owned();
        bad.assets.push(BrandImportAsset {
            path: "not-referenced.svg".to_owned(),
            source_sha256: "0".repeat(64),
            media_type: "image/svg+xml".to_owned(),
            sanitized_bytes: svg("#000000"),
        });
        let unreferenced = import_brand_pack_at(app_data.path(), bad, &third_grant).unwrap_err();
        assert_eq!(unreferenced.code, "brand_asset_set_invalid");
        assert!(!app_data.path().join("brands/other").exists());
    }

    #[cfg(unix)]
    #[test]
    fn import_rejects_a_symlinked_private_brand_root() {
        use std::os::unix::fs::symlink;

        let (_source, path) = source_pack();
        let app_data = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        symlink(outside.path(), app_data.path().join("brands")).unwrap();
        let grants = BrandGrantState::default();
        let selection = grant_brand_source(&path, &grants).unwrap();
        let sources = read_brand_source_assets(
            &selection.grant_token,
            &["logo.svg".to_owned(), "mark.svg".to_owned()],
            &grants,
        )
        .unwrap();

        let error = import_brand_pack_at(app_data.path(), request(&selection, &sources), &grants)
            .unwrap_err();
        assert_eq!(error.code, "brand_storage_scope_invalid");
        assert!(fs::read_dir(outside.path()).unwrap().next().is_none());
    }

    #[cfg(unix)]
    #[test]
    fn import_never_commits_through_a_replaced_brands_capability() {
        use std::os::unix::fs::symlink;

        let (_source, path) = source_pack();
        let app_data = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        BrandStorageScope::bind(app_data.path()).unwrap();
        let grants = BrandGrantState::default();
        let selection = grant_brand_source(&path, &grants).unwrap();
        let sources = read_brand_source_assets(
            &selection.grant_token,
            &["logo.svg".to_owned(), "mark.svg".to_owned()],
            &grants,
        )
        .unwrap();
        let parked = app_data.path().join("parked-brands");

        let error = import_brand_pack_at_with_commit_hook(
            app_data.path(),
            request(&selection, &sources),
            &grants,
            |storage| {
                fs::rename(storage, &parked).unwrap();
                symlink(outside.path(), storage).unwrap();
            },
        )
        .unwrap_err();

        assert_eq!(error.code, "brand_storage_scope_invalid");
        assert!(fs::read_dir(outside.path()).unwrap().next().is_none());
        assert!(!parked.join("acme").exists());
        assert!(fs::read_dir(&parked).unwrap().all(|entry| {
            !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".acme-")
        }));
    }

    #[test]
    fn removal_protects_loop24_and_requires_atomic_revert_for_an_active_custom_pack() {
        let (_source, path) = source_pack();
        let app_data = tempfile::tempdir().unwrap();
        let grants = BrandGrantState::default();
        let selection = grant_brand_source(&path, &grants).unwrap();
        let sources = read_brand_source_assets(
            &selection.grant_token,
            &["logo.svg".to_owned(), "mark.svg".to_owned()],
            &grants,
        )
        .unwrap();
        import_brand_pack_at(app_data.path(), request(&selection, &sources), &grants).unwrap();
        activate_brand_pack_at(app_data.path(), "acme").unwrap();

        assert_eq!(
            remove_brand_pack_at(app_data.path(), "loop24", false)
                .unwrap_err()
                .code,
            "brand_builtin_protected"
        );
        assert_eq!(
            remove_brand_pack_at(app_data.path(), "acme", false)
                .unwrap_err()
                .code,
            "brand_active"
        );
        remove_brand_pack_at(app_data.path(), "acme", true).unwrap();
        assert_eq!(load_active_brand_at(app_data.path()).unwrap(), "loop24");
        assert!(!app_data.path().join("brands/acme").exists());
    }

    #[test]
    fn active_record_replaces_an_existing_selection_and_uses_the_platform_replace_branch() {
        let app_data = tempfile::tempdir().unwrap();
        activate_brand_pack_at(app_data.path(), BUILTIN_BRAND_ID).unwrap();
        activate_brand_pack_at(app_data.path(), BUILTIN_BRAND_ID).unwrap();
        assert_eq!(
            load_active_brand_at(app_data.path()).unwrap(),
            BUILTIN_BRAND_ID
        );

        let branch = std::cell::Cell::new(0);
        select_active_record_commit(
            true,
            || {
                branch.set(1);
                Ok(())
            },
            || {
                branch.set(2);
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(branch.get(), 2);
        select_active_record_commit(
            false,
            || {
                branch.set(3);
                Ok(())
            },
            || {
                branch.set(4);
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(branch.get(), 3);
    }

    #[cfg(unix)]
    #[test]
    fn active_record_load_rejects_symlinks_and_oversized_content() {
        use std::os::unix::fs::symlink;

        let app_data = tempfile::tempdir().unwrap();
        BrandStorageScope::bind(app_data.path()).unwrap();
        let storage = app_data.path().join("brands");
        let outside = tempfile::NamedTempFile::new().unwrap();
        symlink(outside.path(), storage.join(ACTIVE_FILE)).unwrap();
        assert_eq!(
            load_active_brand_at(app_data.path()).unwrap_err().code,
            "brand_active_invalid"
        );
        fs::remove_file(storage.join(ACTIVE_FILE)).unwrap();
        fs::write(storage.join(ACTIVE_FILE), vec![b'x'; 4097]).unwrap();
        assert_eq!(
            load_active_brand_at(app_data.path()).unwrap_err().code,
            "brand_active_invalid"
        );
    }
}
