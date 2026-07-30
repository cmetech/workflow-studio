#[path = "src/updater_key.rs"]
mod updater_key;

fn main() {
    println!("cargo:rerun-if-changed=tauri.conf.json");
    if std::env::var("PROFILE").as_deref() == Ok("release") {
        let config: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string("tauri.conf.json").expect("read updater configuration"),
        )
        .expect("parse updater configuration");
        let key = config
            .pointer("/plugins/updater/pubkey")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        updater_key::validate_public_key(key, false)
            .expect("release updater configuration must contain a non-test public key");
    }
    tauri_build::build()
}
