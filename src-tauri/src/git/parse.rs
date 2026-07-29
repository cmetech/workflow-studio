use std::str;

use super::{GitCommitSummary, GitError, GitPathStatus, GitResult, GitStatus};

pub(crate) fn parse_status(bytes: &[u8]) -> GitResult<GitStatus> {
    let records: Vec<&[u8]> = bytes.split(|byte| *byte == 0).collect();
    let mut entries = Vec::new();
    let mut index = 0;
    while index < records.len() {
        let record = text(records[index])?;
        index += 1;
        if record.is_empty() || record.starts_with("# ") || record.starts_with("! ") {
            continue;
        }
        if let Some(path) = record.strip_prefix("? ") {
            entries.push(GitPathStatus {
                path: path.to_owned(),
                original_path: None,
                index: "?".to_owned(),
                worktree: "?".to_owned(),
                untracked: true,
            });
            continue;
        }
        let (kind, field_count) = if record.starts_with("1 ") {
            ('1', 9)
        } else if record.starts_with("2 ") {
            ('2', 10)
        } else if record.starts_with("u ") {
            ('u', 11)
        } else {
            return Err(invalid_output());
        };
        let fields: Vec<&str> = record.splitn(field_count, ' ').collect();
        if fields.len() != field_count || fields[1].len() != 2 {
            return Err(invalid_output());
        }
        let original_path = if kind == '2' {
            let value = records.get(index).ok_or_else(invalid_output)?;
            index += 1;
            Some(text(value)?.to_owned())
        } else {
            None
        };
        entries.push(GitPathStatus {
            path: fields[field_count - 1].to_owned(),
            original_path,
            index: fields[1][0..1].to_owned(),
            worktree: fields[1][1..2].to_owned(),
            untracked: false,
        });
    }
    Ok(GitStatus { entries })
}

pub(crate) fn parse_history(bytes: &[u8]) -> GitResult<Vec<GitCommitSummary>> {
    let fields: Vec<&str> = bytes
        .split(|byte| *byte == 0)
        .filter_map(|value| {
            if value.is_empty() || value == b"\n" {
                None
            } else {
                Some(text(value))
            }
        })
        .collect::<GitResult<_>>()?;
    if fields.len() % 5 != 0 {
        return Err(invalid_output());
    }
    fields
        .chunks_exact(5)
        .map(|fields| {
            let oid = fields[0].trim_start_matches('\n');
            if !(7..=64).contains(&oid.len()) || !oid.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                return Err(invalid_output());
            }
            Ok(GitCommitSummary {
                oid: oid.to_owned(),
                short_oid: fields[1].to_owned(),
                author_name: fields[2].to_owned(),
                authored_at: fields[3].to_owned(),
                subject: fields[4].to_owned(),
            })
        })
        .collect()
}

fn text(bytes: &[u8]) -> GitResult<&str> {
    str::from_utf8(bytes).map_err(|_| invalid_output())
}

fn invalid_output() -> GitError {
    GitError::new(
        "git_output_invalid",
        "Git returned malformed or unsupported machine-readable output.",
    )
}
