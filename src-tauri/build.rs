#[path = "src/updater_key.rs"]
mod updater_key;

fn main() {
    // Mock-webview integration tests link Windows GUI APIs too. Give only test
    // executables the common-controls v6 dependency; leave the app manifest alone.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg-tests=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'");
    }
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
