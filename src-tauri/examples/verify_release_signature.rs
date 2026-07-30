use std::{
    env,
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
};

use base64::{engine::general_purpose::STANDARD, Engine};
use minisign_verify::{PublicKey, Signature};
use serde_json::Value;

const MAX_CONFIG_BYTES: u64 = 1024 * 1024;
const MAX_SIGNATURE_BYTES: u64 = 16 * 1024;

fn bounded_text(path: &Path, limit: u64, kind: &str) -> Result<String, String> {
    let metadata = fs::metadata(path).map_err(|_| format!("cannot read {kind}"))?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > limit {
        return Err(format!(
            "{kind} must be a non-empty regular file within its size limit"
        ));
    }
    fs::read_to_string(path).map_err(|_| format!("{kind} must be valid UTF-8 text"))
}

fn public_key(config_path: &Path) -> Result<PublicKey, String> {
    let config = bounded_text(config_path, MAX_CONFIG_BYTES, "Tauri configuration")?;
    let value: Value = serde_json::from_str(&config)
        .map_err(|_| "Tauri configuration is invalid JSON".to_owned())?;
    let encoded = value
        .pointer("/plugins/updater/pubkey")
        .and_then(Value::as_str)
        .ok_or_else(|| "Tauri updater public key is missing".to_owned())?;
    let document = STANDARD
        .decode(encoded.trim())
        .map_err(|_| "Tauri updater public key is malformed".to_owned())?;
    let document = std::str::from_utf8(&document)
        .map_err(|_| "Tauri updater public key is malformed".to_owned())?;
    PublicKey::decode(document).map_err(|_| "Tauri updater public key is malformed".to_owned())
}

fn verify(config_path: &Path, artifact_path: &Path, signature_path: &Path) -> Result<(), String> {
    let key = public_key(config_path)?;
    let encoded_signature = bounded_text(signature_path, MAX_SIGNATURE_BYTES, "updater signature")?;
    let signature_document = STANDARD
        .decode(encoded_signature.trim())
        .map_err(|_| "updater signature is malformed".to_owned())?;
    let signature_document = std::str::from_utf8(&signature_document)
        .map_err(|_| "updater signature is malformed".to_owned())?;
    let signature = Signature::decode(signature_document)
        .map_err(|_| "updater signature is malformed".to_owned())?;

    let metadata =
        fs::metadata(artifact_path).map_err(|_| "cannot read updater artifact".to_owned())?;
    if !metadata.is_file() {
        return Err("updater artifact must be a regular file".to_owned());
    }
    let mut artifact =
        File::open(artifact_path).map_err(|_| "cannot read updater artifact".to_owned())?;
    let mut verifier = key
        .verify_stream(&signature)
        .map_err(|error| format!("cannot initialize streaming verification: {error}"))?;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = artifact
            .read(&mut buffer)
            .map_err(|_| "cannot read updater artifact".to_owned())?;
        if count == 0 {
            break;
        }
        verifier.update(&buffer[..count]);
    }
    verifier
        .finalize()
        .map_err(|_| "cryptographic signature does not match updater artifact".to_owned())
}

fn arguments() -> Result<(PathBuf, PathBuf, PathBuf), String> {
    let mut args = env::args_os().skip(1);
    let config = args.next().map(PathBuf::from);
    let artifact = args.next().map(PathBuf::from);
    let signature = args.next().map(PathBuf::from);
    if config.is_none() || artifact.is_none() || signature.is_none() || args.next().is_some() {
        return Err(
            "usage: verify_release_signature <tauri-config> <artifact> <signature>".to_owned(),
        );
    }
    Ok((config.unwrap(), artifact.unwrap(), signature.unwrap()))
}

fn main() {
    let result = arguments()
        .and_then(|(config, artifact, signature)| verify(&config, &artifact, &signature));
    if let Err(error) = result {
        eprintln!("Updater signature verification failed: {error}");
        std::process::exit(1);
    }
}
