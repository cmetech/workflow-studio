import type { ValidationIssue } from '$src/lib/documents/types'

export function keyIssues(issues: readonly ValidationIssue[]): readonly { issue: ValidationIssue; key: string }[] {
  const occurrences = new Map<string, number>()
  return issues.map((issue) => {
    const fingerprint = issueViewKey(issue, 0)
    const ordinal = occurrences.get(fingerprint) ?? 0
    occurrences.set(fingerprint, ordinal + 1)
    return { issue, key: issueViewKey(issue, ordinal) }
  })
}

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
    issue.referenceStart ?? null,
    issue.referenceEnd ?? null,
    occurrence,
  ])
}
