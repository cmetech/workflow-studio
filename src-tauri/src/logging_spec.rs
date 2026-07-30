use tauri_plugin_log::log::LevelFilter;

use crate::logging::{configuration, LogTarget};

#[test]
fn debug_logging_routes_debug_records_to_stdout_and_the_log_directory() {
    assert_eq!(
        configuration(true),
        crate::logging::LoggingConfiguration {
            level: LevelFilter::Debug,
            targets: vec![LogTarget::Stdout, LogTarget::LogDirectory],
        }
    );
}

#[test]
fn release_logging_routes_info_records_to_the_log_directory_only() {
    assert_eq!(
        configuration(false),
        crate::logging::LoggingConfiguration {
            level: LevelFilter::Info,
            targets: vec![LogTarget::LogDirectory],
        }
    );
}
