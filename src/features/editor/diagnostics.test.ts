import { describe, expect, it, vi } from 'vitest'
import type { DocumentAnalysis, DocumentRevision, ValidationIssue } from '$src/lib/documents/types'
import { issuesToCodeMirrorDiagnostics } from './diagnostics'

const digest = `sha256:${'1'.repeat(64)}` as const

const revision: DocumentRevision = {
  workflowId: 'workflow:workspace:flow.yaml',
  pairGeneration: 0,
  definitionPath: 'flow.yaml',
  companionPath: 'flow.hermes.yaml',
  definitionRevision: 4,
  companionRevision: 2,
  contractDigest: digest,
}

function issue(overrides: Partial<ValidationIssue> = {}): ValidationIssue {
  return {
    code: 'required_field',
    layer: 'contract',
    severity: 'error',
    blocking: true,
    message: 'A required field is missing.',
    document: 'definition',
    line: 2,
    column: 3,
    ...overrides,
  }
}

function analysis(overrides: Partial<DocumentAnalysis> = {}): DocumentAnalysis {
  return {
    ...revision,
    structurallyValid: false,
    issues: [issue()],
    ...overrides,
  }
}

describe('issuesToCodeMirrorDiagnostics', () => {
  it('maps only current-revision issues for the requested document', () => {
    const diagnostics = issuesToCodeMirrorDiagnostics({
      text: 'name: Flow\nnodes: []\n',
      document: 'definition',
      revision,
      analysis: analysis({ issues: [issue(), issue({ document: 'companion', message: 'Companion issue' })] }),
    })

    expect(diagnostics).toEqual([
      expect.objectContaining({ from: 13, to: 14, severity: 'error', message: 'A required field is missing.' }),
    ])

    expect(
      issuesToCodeMirrorDiagnostics({
        text: 'name: Flow\n',
        document: 'definition',
        revision,
        analysis: analysis({ definitionRevision: 3 }),
      }),
    ).toEqual([])
  })

  it('clamps out-of-range line and column coordinates to current text', () => {
    const diagnostics = issuesToCodeMirrorDiagnostics({
      text: 'name: Flow\n',
      document: 'definition',
      revision,
      analysis: analysis({ issues: [issue({ line: 99, column: 99, severity: 'warning' })] }),
    })

    expect(diagnostics).toEqual([expect.objectContaining({ from: 11, to: 11, severity: 'warning' })])
  })

  it('routes a diagnostic action through the supplied central focus handler', () => {
    const focus = vi.fn()
    const currentIssue = issue()
    const [diagnostic] = issuesToCodeMirrorDiagnostics({
      text: 'name: Flow\nnodes: []\n',
      document: 'definition',
      revision,
      analysis: analysis({ issues: [currentIssue] }),
      onFocus: focus,
    })

    diagnostic?.actions?.[0]?.apply({} as never, 0, 0)

    expect(focus).toHaveBeenCalledWith(currentIssue)
  })
})
