use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostInfo {
    app_version: String,
    os: String,
    arch: String,
}

fn host_os_name(os: &str) -> Option<&'static str> {
    match os {
        "macos" => Some("macos"),
        "windows" => Some("windows"),
        "linux" => Some("linux"),
        _ => None,
    }
}

#[tauri::command]
pub fn host_health(app: tauri::AppHandle) -> HostInfo {
    HostInfo {
        app_version: app.package_info().version.to_string(),
        os: host_os_name(std::env::consts::OS)
            .expect("Workflow Studio supports macOS, Windows, and Linux only")
            .to_string(),
        arch: std::env::consts::ARCH.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::host_os_name;

    #[test]
    fn maps_supported_target_os_names_for_the_renderer_contract() {
        assert_eq!(host_os_name("macos"), Some("macos"));
        assert_eq!(host_os_name("windows"), Some("windows"));
        assert_eq!(host_os_name("linux"), Some("linux"));
        assert_eq!(host_os_name("android"), None);
    }
}
