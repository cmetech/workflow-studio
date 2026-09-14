#[cfg(windows)]
pub(crate) fn background_creation_flags() -> u32 {
    use windows_sys::Win32::System::Threading::{CREATE_NO_WINDOW, CREATE_SUSPENDED};

    CREATE_SUSPENDED | CREATE_NO_WINDOW
}

#[cfg(all(test, windows))]
pub(crate) mod test_support {
    use std::path::Path;
    use std::process::Command;
    use std::time::Duration;

    use windows_sys::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
    use windows_sys::Win32::Storage::FileSystem::SYNCHRONIZE;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, WaitForSingleObject, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    const FIXTURE_ENV: &str = "WORKFLOW_STUDIO_BACKGROUND_CHILD_FIXTURE";
    const FIXTURE_ROLE_ENV: &str = "WORKFLOW_STUDIO_BACKGROUND_CHILD_FIXTURE_ROLE";
    const CONSOLE_RECORD_ENV: &str = "WORKFLOW_STUDIO_BACKGROUND_CHILD_CONSOLE_RECORD";
    const DESCENDANT_PID_ENV: &str = "WORKFLOW_STUDIO_BACKGROUND_CHILD_DESCENDANT_PID";

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetConsoleWindow() -> isize;
    }

    pub(crate) fn fixture_command(
        test_name: &str,
        fixture_name: &str,
        directory: &Path,
    ) -> Command {
        let mut command = Command::new(std::env::current_exe().expect("test executable path"));
        command
            .arg(test_name)
            .args(["--exact", "--nocapture"])
            .env(FIXTURE_ENV, fixture_name)
            .env(FIXTURE_ROLE_ENV, "parent")
            .env(CONSOLE_RECORD_ENV, directory.join("console.txt"))
            .env(DESCENDANT_PID_ENV, directory.join("descendant-pid.txt"));
        command
    }

    pub(crate) fn run_fixture(test_name: &str, fixture_name: &str) {
        if std::env::var_os(FIXTURE_ENV).as_deref() != Some(fixture_name.as_ref()) {
            return;
        }
        if std::env::var_os(FIXTURE_ROLE_ENV).as_deref() == Some("descendant".as_ref()) {
            std::thread::sleep(Duration::from_secs(30));
            return;
        }

        let console_record = std::env::var_os(CONSOLE_RECORD_ENV).expect("console record path");
        let console = if unsafe { GetConsoleWindow() } == 0 {
            "none"
        } else {
            "attached"
        };
        std::fs::write(console_record, console).expect("record console attachment");

        let mut descendant = Command::new(std::env::current_exe().expect("test executable path"));
        let child = descendant
            .arg(test_name)
            .args(["--exact", "--nocapture"])
            .env(FIXTURE_ENV, fixture_name)
            .env(FIXTURE_ROLE_ENV, "descendant")
            .spawn()
            .expect("spawn process-tree descendant");
        let descendant_pid = std::env::var_os(DESCENDANT_PID_ENV).expect("descendant pid path");
        std::fs::write(descendant_pid, child.id().to_string()).expect("record descendant pid");
        std::thread::sleep(Duration::from_secs(30));
    }

    pub(crate) fn assert_hidden_and_descendant_terminated(directory: &Path) {
        assert_eq!(
            std::fs::read_to_string(directory.join("console.txt")).unwrap(),
            "none"
        );
        let process_id = std::fs::read_to_string(directory.join("descendant-pid.txt"))
            .unwrap()
            .parse::<u32>()
            .unwrap();
        let process = unsafe {
            OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE,
                0,
                process_id,
            )
        };
        if process.is_null() {
            return;
        }
        let wait = unsafe { WaitForSingleObject(process, 2_000) };
        unsafe { CloseHandle(process) };
        assert_eq!(
            wait, WAIT_OBJECT_0,
            "descendant {process_id} remained alive"
        );
    }
}

#[cfg(test)]
mod tests {
    #[cfg(windows)]
    #[test]
    fn windows_background_children_are_suspended_without_a_console_window() {
        use windows_sys::Win32::System::Threading::{CREATE_NO_WINDOW, CREATE_SUSPENDED};

        assert_eq!(
            super::background_creation_flags(),
            CREATE_SUSPENDED | CREATE_NO_WINDOW
        );
    }
}
