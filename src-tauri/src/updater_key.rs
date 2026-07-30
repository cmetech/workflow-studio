use base64::{engine::general_purpose::STANDARD, Engine};
use minisign_verify::PublicKey;

pub const TEST_UPDATER_PUBLIC_KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEVFNkU2NjA0QkU0NjgxREEKUldUYWdVYStCR1p1N2x5aGFPUEhlREo5SUtuL1FrZUNqeEN2Wk9iWUU4dDBkUHdCS1JUS1RJcDkK";

pub fn validate_public_key(
    value: &str,
    allow_documented_test_key: bool,
) -> Result<(), &'static str> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed == TEST_UPDATER_PUBLIC_KEY {
        if trimmed.is_empty() || !allow_documented_test_key {
            return Err("a production updater public key is required");
        }
    }
    if trimmed.len() < 100
        || trimmed.len() > 4_096
        || !trimmed.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '+' | '/' | '=')
        })
    {
        return Err("the updater public key is malformed");
    }

    let decoded = STANDARD
        .decode(trimmed)
        .map_err(|_| "the updater public key is malformed")?;
    let document =
        std::str::from_utf8(&decoded).map_err(|_| "the updater public key is malformed")?;
    let mut lines = document.lines();
    let comment = lines.next().ok_or("the updater public key is malformed")?;
    let encoded_key = lines.next().ok_or("the updater public key is malformed")?;
    if !comment.starts_with("untrusted comment: ")
        || comment.len() == "untrusted comment: ".len()
        || encoded_key.is_empty()
        || lines.next().is_some()
        || PublicKey::decode(document).is_err()
    {
        return Err("the updater public key is malformed");
    }
    Ok(())
}
