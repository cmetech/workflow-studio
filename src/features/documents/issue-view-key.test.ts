import { describe, expect, it } from 'vitest'
import type { ValidationIssue } from '$src/lib/documents/types'
import { issueViewKey } from './issue-view-key'

function issue(overrides: Partial<ValidationIssue> = {}): ValidationIssue {
  return {
    code: 'required',
    layer: 'contract',
    severity: 'error',
    blocking: true,
    message: 'A required field is missing.',
    document: 'definition',
    ...overrides,
  }
}

describe('issueViewKey', () => {
  it('gives repeated equivalent diagnostics deterministic occurrence identities', () => {
    const duplicate = issue({ code: 'duplicate_id', path: '/nodes/1/id', line: 8, column: 5 })

    expect(issueViewKey(duplicate, 0)).not.toBe(issueViewKey(duplicate, 1))
    expect(issueViewKey(duplicate, 0)).toBe(issueViewKey({ ...duplicate }, 0))
  })
})
