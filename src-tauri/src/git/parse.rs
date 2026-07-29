use std::str;

use super::{GitCommitSummary, GitError, GitPathStatus, GitResult, GitStatus};

#[derive(Clone, Debug)]
pub(crate) struct HistoryRecord {
    pub(crate) summary: GitCommitSummary,
    pub(crate) snapshot_path: Option<String>,
    pub(crate) prior_path: Option<String>,
}

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
        if fields.len() != field_count || !valid_xy(fields[1].as_bytes()) {
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
            index: char::from(fields[1].as_bytes()[0]).to_string(),
            worktree: char::from(fields[1].as_bytes()[1]).to_string(),
            untracked: false,
        });
    }
    Ok(GitStatus { entries })
}

fn valid_xy(bytes: &[u8]) -> bool {
    bytes.len() == 2
        && bytes
            .iter()
            .all(|byte| matches!(byte, b'.' | b'M' | b'T' | b'A' | b'D' | b'R' | b'C' | b'U'))
}

#[cfg(test)]
pub(crate) fn parse_history(bytes: &[u8]) -> GitResult<Vec<GitCommitSummary>> {
    Ok(parse_history_records(bytes)?
        .into_iter()
        .map(|record| record.summary)
        .collect())
}

pub(crate) fn parse_history_records(bytes: &[u8]) -> GitResult<Vec<HistoryRecord>> {
    let tokens = bytes.split(|byte| *byte == 0).collect::<Vec<_>>();
    let mut records = Vec::new();
    let mut index = 0;
    while index < tokens.len() {
        let marker = trim_record_prefix(tokens[index]);
        index += 1;
        if marker.is_empty() {
            continue;
        }
        if marker != b"C" || index + 6 > tokens.len() {
            return Err(invalid_output());
        }
        let oid = text(tokens[index])?;
        let short_oid = text(tokens[index + 1])?;
        let author_name = text(tokens[index + 2])?;
        let authored_epoch = text(tokens[index + 3])?
            .parse::<i64>()
            .map_err(|_| invalid_output())?;
        let authored_at = text(tokens[index + 4])?;
        let subject = text(tokens[index + 5])?;
        index += 6;
        if !(7..=64).contains(&oid.len()) || !oid.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(invalid_output());
        }

        let mut snapshot_path = None;
        let mut prior_path = None;
        while index < tokens.len() {
            let status = trim_record_prefix(tokens[index]);
            if status.is_empty() {
                index += 1;
                continue;
            }
            if status == b"C" {
                break;
            }
            index += 1;
            if status.starts_with(b"R") || status.starts_with(b"C") {
                if status.len() < 2
                    || !status[1..].iter().all(u8::is_ascii_digit)
                    || index + 2 > tokens.len()
                {
                    return Err(invalid_output());
                }
                let old_path = text(tokens[index])?.to_owned();
                let new_path = text(tokens[index + 1])?.to_owned();
                index += 2;
                snapshot_path = Some(new_path);
                prior_path = Some(old_path);
            } else {
                if status.len() != 1
                    || !matches!(status[0], b'A' | b'D' | b'M' | b'T' | b'U')
                    || index >= tokens.len()
                {
                    return Err(invalid_output());
                }
                let path = text(tokens[index])?.to_owned();
                index += 1;
                match status[0] {
                    b'A' => {
                        snapshot_path = Some(path);
                        prior_path = None;
                    }
                    b'D' => {
                        snapshot_path = None;
                        prior_path = Some(path);
                    }
                    _ => {
                        snapshot_path = Some(path.clone());
                        prior_path = Some(path);
                    }
                }
            }
        }
        records.push(HistoryRecord {
            summary: GitCommitSummary {
                oid: oid.to_owned(),
                short_oid: short_oid.to_owned(),
                author_name: author_name.to_owned(),
                authored_at: authored_at.to_owned(),
                subject: subject.to_owned(),
                authored_epoch,
            },
            snapshot_path,
            prior_path,
        });
    }
    Ok(records)
}

fn trim_record_prefix(mut bytes: &[u8]) -> &[u8] {
    while bytes.first() == Some(&b'\n') {
        bytes = &bytes[1..];
    }
    bytes
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
