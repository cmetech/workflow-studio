use tauri::Runtime;
use tauri_plugin_log::{log::LevelFilter, Target, TargetKind};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum LogTarget {
    Stdout,
    LogDirectory,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct LoggingConfiguration {
    pub(crate) level: LevelFilter,
    pub(crate) targets: Vec<LogTarget>,
}

pub(crate) fn configuration(debug_build: bool) -> LoggingConfiguration {
    LoggingConfiguration {
        level: if debug_build {
            LevelFilter::Debug
        } else {
            LevelFilter::Info
        },
        targets: if debug_build {
            vec![LogTarget::Stdout, LogTarget::LogDirectory]
        } else {
            vec![LogTarget::LogDirectory]
        },
    }
}

fn native_log_level() -> LevelFilter {
    if cfg!(debug_assertions) {
        LevelFilter::Debug
    } else {
        LevelFilter::Info
    }
}

pub(crate) fn plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    let configuration = configuration(cfg!(debug_assertions));
    debug_assert_eq!(configuration.level, native_log_level());
    let targets = configuration.targets.into_iter().map(|target| match target {
        LogTarget::Stdout => Target::new(TargetKind::Stdout),
        LogTarget::LogDirectory => Target::new(TargetKind::LogDir { file_name: None }),
    });

    tauri_plugin_log::Builder::new()
        .level(native_log_level())
        .targets(targets)
        .build()
}
