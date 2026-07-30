use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

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
    parent_path: PathBuf,
    parent_identity: Handle,
    manifest_path: PathBuf,
    manifest_identity: Handle,
    manifest_sha256: String,
    source_manifest: Option<NativeBrandManifest>,
    authorized_paths: HashSet<String>,
    assets: HashMap<String, BoundBrandAsset>,
}

struct BoundBrandAsset {
    path: PathBuf,
    identity: Handle,
    sha256: String,
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

fn read_bounded_file(path: &Path, code: &'static str) -> BrandResult<(Vec<u8>, Handle)> {
    let metadata = fs::symlink_metadata(path).map_err(|error| io_error(code, error))?;
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
    let mut file = File::open(path).map_err(|error| io_error(code, error))?;
    let identity = Handle::from_file(file.try_clone().map_err(|error| io_error(code, error))?)
        .map_err(|error| io_error(code, error))?;
    let named_identity = Handle::from_path(path).map_err(|error| io_error(code, error))?;
    if identity != named_identity {
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
    if Handle::from_path(path).map_err(|error| io_error(code, error))? != identity {
        return Err(brand_error(
            "brand_source_changed",
            "The brand file path changed while its bytes were read.",
        ));
    }
    Ok((bytes, identity))
}

fn verify_regular_parent(parent: &Path, expected: &Handle) -> BrandResult<()> {
    let metadata = fs::symlink_metadata(parent).map_err(|_| {
        brand_error(
            "brand_source_changed",
            "The selected brand directory is no longer available.",
        )
    })?;
    if metadata.file_type().is_symlink()
        || !metadata.is_dir()
        || Handle::from_path(parent).map_err(|_| {
            brand_error(
                "brand_source_changed",
                "The selected brand directory could not be identified.",
            )
        })? != *expected
    {
        return Err(brand_error(
            "brand_source_changed",
            "The selected brand directory changed.",
        ));
    }
    Ok(())
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
    let parent_metadata = fs::symlink_metadata(&parent_path)
        .map_err(|error| io_error("brand_source_invalid", error))?;
    if parent_metadata.file_type().is_symlink() || !parent_metadata.is_dir() {
        return Err(brand_error(
            "brand_source_invalid",
            "The brand source directory must be a regular directory.",
        ));
    }
    let parent_identity =
        Handle::from_path(&parent_path).map_err(|error| io_error("brand_grant_failed", error))?;
    let (manifest_bytes, manifest_identity) =
        read_bounded_file(&canonical, "brand_source_invalid")?;
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
                parent_path,
                parent_identity,
                manifest_path: canonical,
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

fn verify_manifest(grant: &GrantedBrandSource) -> BrandResult<()> {
    verify_regular_parent(&grant.parent_path, &grant.parent_identity)?;
    let (bytes, identity) = read_bounded_file(&grant.manifest_path, "brand_source_changed")?;
    if identity != grant.manifest_identity || sha256(&bytes) != grant.manifest_sha256 {
        return Err(brand_error(
            "brand_source_changed",
            "The selected brand manifest changed after it was granted.",
        ));
    }
    Ok(())
}

fn checked_asset_path(parent: &Path, relative: &str) -> BrandResult<PathBuf> {
    if !safe_asset_path(relative) {
        return Err(brand_error(
            "brand_asset_path_invalid",
            "Brand asset paths must be safe relative SVG or PNG paths.",
        ));
    }
    let mut current = parent.to_path_buf();
    for component in Path::new(relative).components() {
        let Component::Normal(name) = component else {
            return Err(brand_error(
                "brand_asset_path_invalid",
                "Brand asset paths must remain inside the selected directory.",
            ));
        };
        current.push(name);
        let metadata = fs::symlink_metadata(&current).map_err(|_| {
            brand_error(
                "brand_asset_missing",
                format!("Brand asset {relative} is missing."),
            )
        })?;
        if metadata.file_type().is_symlink() {
            return Err(brand_error(
                "brand_source_changed",
                "Brand source assets cannot traverse symbolic links.",
            ));
        }
    }
    Ok(current)
}

fn read_brand_source_assets(
    token: &str,
    paths: &[String],
    grants: &BrandGrantState,
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
        let path = checked_asset_path(&grant.parent_path, relative)?;
        let (bytes, identity) = read_bounded_file(&path, "brand_source_changed")?;
        let digest = sha256(&bytes);
        grant.assets.insert(
            relative.clone(),
            BoundBrandAsset {
                path,
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
    let path = checked_asset_path(&grant.parent_path, &asset.path)?;
    let (bytes, identity) = read_bounded_file(&path, "brand_source_changed")?;
    let digest = sha256(&bytes);
    if path != bound.path
        || identity != bound.identity
        || digest != bound.sha256
        || digest != asset.source_sha256
    {
        return Err(brand_error(
            "brand_source_changed",
            "A brand asset changed after renderer validation.",
        ));
    }
    Ok(())
}

fn prepare_storage_root(app_data: &Path) -> BrandResult<(PathBuf, Handle)> {
    let app_metadata = fs::symlink_metadata(app_data)
        .map_err(|error| io_error("brand_storage_scope_invalid", error))?;
    if app_metadata.file_type().is_symlink() || !app_metadata.is_dir() {
        return Err(brand_error(
            "brand_storage_scope_invalid",
            "Application data must be a regular private directory.",
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(app_data, fs::Permissions::from_mode(0o700))
            .map_err(|error| io_error("brand_storage_failed", error))?;
    }
    let root = app_data.join("brands");
    match fs::symlink_metadata(&root) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            return Err(brand_error(
                "brand_storage_scope_invalid",
                "The private brand storage root is not a regular directory.",
            ));
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(&root).map_err(|error| io_error("brand_storage_failed", error))?;
        }
        Err(error) => return Err(io_error("brand_storage_failed", error)),
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700))
            .map_err(|error| io_error("brand_storage_failed", error))?;
    }
    let identity =
        Handle::from_path(&root).map_err(|error| io_error("brand_storage_failed", error))?;
    Ok((root, identity))
}

fn write_private_file(path: &Path, bytes: &[u8]) -> BrandResult<()> {
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .map_err(|error| io_error("brand_storage_failed", error))?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|error| io_error("brand_storage_failed", error))
}

fn write_staged_asset(root: &Path, relative: &str, bytes: &[u8]) -> BrandResult<()> {
    let path = root.join(relative);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| io_error("brand_storage_failed", error))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut current = root.to_path_buf();
            for component in Path::new(relative)
                .parent()
                .into_iter()
                .flat_map(Path::components)
            {
                if let Component::Normal(name) = component {
                    current.push(name);
                    fs::set_permissions(&current, fs::Permissions::from_mode(0o700))
                        .map_err(|error| io_error("brand_storage_failed", error))?;
                }
            }
        }
    }
    write_private_file(&path, bytes)
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

    let (storage, storage_identity) = prepare_storage_root(app_data)?;
    let destination = storage.join(&request.manifest.id);
    if fs::symlink_metadata(&destination).is_ok() {
        return Err(brand_error(
            "brand_id_exists",
            "A stored brand already uses this ID.",
        ));
    }
    let staging = tempfile::Builder::new()
        .prefix(&format!(".{}-", request.manifest.id))
        .tempdir_in(&storage)
        .map_err(|error| io_error("brand_storage_failed", error))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(staging.path(), fs::Permissions::from_mode(0o700))
            .map_err(|error| io_error("brand_storage_failed", error))?;
    }
    write_private_file(&staging.path().join("brand.yaml"), &manifest_bytes)?;
    for asset in &request.assets {
        write_staged_asset(staging.path(), &asset.path, &asset.sanitized_bytes)?;
    }
    before_commit(&storage);
    if Handle::from_path(&storage).map_err(|error| io_error("brand_storage_failed", error))?
        != storage_identity
        || fs::symlink_metadata(&destination).is_ok()
    {
        return Err(brand_error(
            "brand_storage_scope_invalid",
            "Private brand storage changed before commit.",
        ));
    }
    fs::rename(staging.path(), &destination)
        .map_err(|error| io_error("brand_storage_failed", error))?;
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

fn atomic_active_write(storage: &Path, id: &str, revision: Option<&str>) -> BrandResult<()> {
    let storage_identity =
        Handle::from_path(storage).map_err(|error| io_error("brand_storage_failed", error))?;
    let token = opaque_token()?;
    let temporary = storage.join(format!(".{ACTIVE_FILE}-{token}.tmp"));
    let bytes = serde_json::to_vec(&ActiveBrandRecord {
        schema_version: 1,
        id: id.to_owned(),
        revision: revision.map(str::to_owned),
    })
    .map_err(|error| brand_error("brand_storage_failed", error.to_string()))?;
    write_private_file(&temporary, &bytes)?;
    let destination = storage.join(ACTIVE_FILE);
    let destination_exists = match fs::symlink_metadata(&destination) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                let _ = fs::remove_file(&temporary);
                return Err(brand_error(
                    "brand_storage_scope_invalid",
                    "The active-brand record is not a regular private file.",
                ));
            }
            true
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(error) => {
            let _ = fs::remove_file(&temporary);
            return Err(io_error("brand_storage_failed", error));
        }
    };
    if Handle::from_path(storage).map_err(|error| io_error("brand_storage_failed", error))?
        != storage_identity
    {
        let _ = fs::remove_file(&temporary);
        return Err(brand_error(
            "brand_storage_scope_invalid",
            "Private brand storage changed before active-brand commit.",
        ));
    }
    select_active_record_commit(
        destination_exists,
        || {
            fs::rename(&temporary, &destination)
                .map_err(|error| io_error("brand_storage_failed", error))
        },
        || replace_active_file(&temporary, &destination),
    )
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
fn replace_active_file(source: &Path, destination: &Path) -> BrandResult<()> {
    fs::rename(source, destination).map_err(|error| io_error("brand_storage_failed", error))
}

#[cfg(windows)]
fn replace_active_file(source: &Path, destination: &Path) -> BrandResult<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let moved = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if moved == 0 {
        Err(io_error(
            "brand_storage_failed",
            std::io::Error::last_os_error(),
        ))
    } else {
        Ok(())
    }
}

fn load_active_record_at(app_data: &Path) -> BrandResult<ActiveBrandRecord> {
    let (storage, _) = prepare_storage_root(app_data)?;
    let path = storage.join(ACTIVE_FILE);
    match fs::symlink_metadata(&path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > 4096 {
                return Err(brand_error(
                    "brand_active_invalid",
                    "The saved active brand record is not a bounded regular file.",
                ));
            }
            let (bytes, _) = read_bounded_file(&path, "brand_active_invalid")?;
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
    let (storage, _) = prepare_storage_root(app_data)?;
    if !validate_brand_id(id) || id == BUILTIN_BRAND_ID {
        return Err(brand_error(
            "brand_not_found",
            "The custom brand does not exist.",
        ));
    }
    let directory = storage.join(id);
    let metadata = fs::symlink_metadata(&directory)
        .map_err(|_| brand_error("brand_not_found", "The custom brand does not exist."))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(brand_error(
            "brand_storage_scope_invalid",
            "The stored brand directory is unsafe.",
        ));
    }
    let directory_identity =
        Handle::from_path(&directory).map_err(|error| io_error("brand_storage_invalid", error))?;
    let (bytes, _) = read_bounded_file(&directory.join("brand.yaml"), "brand_storage_invalid")?;
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
        let path = checked_asset_path(&directory, &relative)?;
        let (bytes, _) = read_bounded_file(&path, "brand_storage_invalid")?;
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
    if Handle::from_path(&directory).map_err(|error| io_error("brand_storage_invalid", error))?
        != directory_identity
    {
        return Err(brand_error(
            "brand_storage_scope_invalid",
            "The stored brand directory changed while it was loaded.",
        ));
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

fn list_brand_packs_at(app_data: &Path) -> BrandResult<BrandPackListResult> {
    const MAX_LISTED_PACKS: usize = 16;
    const MAX_LISTED_BYTES: usize = 32 * 1024 * 1024;
    let (storage, _) = prepare_storage_root(app_data)?;
    let mut ids = Vec::new();
    for entry in fs::read_dir(&storage).map_err(|error| io_error("brand_storage_failed", error))? {
        let entry = entry.map_err(|error| io_error("brand_storage_failed", error))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if validate_brand_id(&name) && name != BUILTIN_BRAND_ID {
            ids.push(name);
        }
    }
    ids.sort();
    let mut packs = Vec::new();
    let mut warnings = Vec::new();
    let mut total_bytes = 0_usize;
    for id in ids {
        if packs.len() >= MAX_LISTED_PACKS {
            warnings.push(
                "Additional stored brand packs were omitted from this bounded listing.".to_owned(),
            );
            break;
        }
        match load_stored_pack_at(app_data, &id) {
            Ok(pack) => {
                let pack_bytes = pack
                    .assets
                    .iter()
                    .map(|asset| asset.bytes.len())
                    .sum::<usize>();
                if total_bytes.saturating_add(pack_bytes) > MAX_LISTED_BYTES {
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

fn activate_brand_pack_at(app_data: &Path, id: &str) -> BrandResult<BrandActivationResult> {
    let pack = if id == BUILTIN_BRAND_ID {
        None
    } else {
        Some(load_stored_pack_at(app_data, id)?)
    };
    let (storage, _) = prepare_storage_root(app_data)?;
    atomic_active_write(
        &storage,
        id,
        pack.as_ref().map(|pack| pack.revision.as_str()),
    )?;
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

fn reject_unsafe_tree(path: &Path) -> BrandResult<()> {
    for entry in fs::read_dir(path).map_err(|error| io_error("brand_remove_failed", error))? {
        let entry = entry.map_err(|error| io_error("brand_remove_failed", error))?;
        let metadata = fs::symlink_metadata(entry.path())
            .map_err(|error| io_error("brand_remove_failed", error))?;
        if metadata.file_type().is_symlink() {
            return Err(brand_error(
                "brand_storage_scope_invalid",
                "Stored brand removal refused a symbolic link.",
            ));
        }
        if metadata.is_dir() {
            reject_unsafe_tree(&entry.path())?;
        } else if !metadata.is_file() {
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
    remove_brand_pack_at_with_remover(app_data, id, revert_active, |path| fs::remove_dir_all(path))
}

fn remove_brand_pack_at_with_remover(
    app_data: &Path,
    id: &str,
    revert_active: bool,
    remover: impl FnOnce(&Path) -> std::io::Result<()>,
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
    let (storage, _) = prepare_storage_root(app_data)?;
    let directory = storage.join(id);
    let metadata = fs::symlink_metadata(&directory)
        .map_err(|_| brand_error("brand_not_found", "The custom brand does not exist."))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(brand_error(
            "brand_storage_scope_invalid",
            "The stored brand directory is unsafe.",
        ));
    }
    reject_unsafe_tree(&directory)?;
    if active == id {
        activate_brand_pack_at(app_data, BUILTIN_BRAND_ID)?;
    }
    match remover(&directory) {
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
        let image = if id == BUILTIN_BRAND_ID {
            if expected_revision.is_some() {
                return Err(brand_error(
                    "brand_icon_revision_mismatch",
                    "LOOP24 does not use a custom icon revision.",
                ));
            }
            app.default_window_icon().cloned().ok_or_else(|| {
                brand_error(
                    "brand_icon_failed",
                    "The bundled default window icon is unavailable.",
                )
            })?
        } else {
            let Some(bytes) = load_window_icon_for_revision_at(
                &app_data(&app)?,
                &id,
                expected_revision.as_deref(),
            )?
            else {
                return Ok(WindowIconResult {
                    status: "unsupported",
                });
            };
            tauri::image::Image::from_bytes(&bytes)
                .map_err(|error| brand_error("brand_icon_failed", error.to_string()))?
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
        Ok(WindowIconResult { status: "applied" })
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
        let (storage, _) = prepare_storage_root(app_data.path()).unwrap();
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
