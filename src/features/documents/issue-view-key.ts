import type { ValidationIssue } from '$src/lib/documents/types'

export function issueViewKey(issue: ValidationIssue, occurrence: number): string {
  return JSON.stringify([
    issue.document,
    issue.layer,
    issue.code,
    issue.path ?? '',
    issue.line ?? null,
    issue.column ?? null,
    issue.scopeKey ?? '',
    issue.groupId ?? '',
    issue.nodeId ?? '',
    issue.field ?? '',
    occurrence,
  ])
}
