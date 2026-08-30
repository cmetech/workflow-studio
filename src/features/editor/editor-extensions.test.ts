import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthoringContract } from '$src/lib/contract/types'
import { createDocumentRevision } from '$src/lib/documents/revisions'
import type { DocumentAnalysis, WorkflowPairText } from '$src/lib/documents/types'
import type { WorkflowProjection } from '$src/lib/projection/types'
import { DocumentClient, type DocumentWorkerEndpoint } from '$src/workers/document-client'
import type { DocumentWorkerRequest } from '$src/workers/document-worker-protocol'
import {
  applyAuthoritativeEditorText,
  nodeAtCursor,
  rangeForSelectedNode,
  synchronizeEditorProjection,
} from './editor-extensions'

function pair(): WorkflowPairText {
  return {
    workflowId: 'workflow:workspace:flow.yaml',
    generation: 0,
    savedGeneration: 0,
    definition: {
      id: 'workflow:workspace:flow.yaml:definition',
      kind: 'definition',
      path: 'flow.yaml',
      text: 'name: Flow\n',
      revision: 0,
      savedRevision: 0,
      diskHash: 'a'.repeat(64),
    },
    companion: {
      id: 'workflow:workspace:flow.yaml:companion',
      kind: 'companion',
      path: 'flow.hermes.yaml',
      text: 'language_compatibility: hermes-legacy\n',
      revision: 3,
      savedRevision: 3,
      diskHash: 'b'.repeat(64),
    },
  }
}

describe('authoritative editor synchronization', () => {
  afterEach(() => vi.useRealTimers())

  it('commits text immediately to only the edited document revision', () => {
    const commit = vi.fn()
    const original = pair()

    const edited = applyAuthoritativeEditorText(
      original,
      'companion',
      'language_compatibility: archon-2026-07\n',
      commit,
    )

    expect(edited.definition).toBe(original.definition)
    expect(edited.companion).toMatchObject({ revision: 4, savedRevision: 3 })
    expect(commit).toHaveBeenCalledOnce()
    expect(commit).toHaveBeenCalledWith(edited)
  })

  it('maps graph selections and cursor positions through exact projected source ranges', () => {
    const nodes = [
      { id: 'collect', source: { path: '/nodes/0', start: 12, end: 40 } },
      { id: 'review', source: { path: '/nodes/1', start: 41, end: 74 } },
    ]

    expect(rangeForSelectedNode(nodes, 'review', 60)).toEqual({ from: 41, to: 60 })
    expect(nodeAtCursor(nodes, 40)).toBe('collect')
    expect(nodeAtCursor(nodes, 41)).toBe('review')
    expect(nodeAtCursor(nodes, 75)).toBeNull()
  })

  it('keeps the last valid graph stale and read-only until a current valid correction arrives', () => {
    const original = pair()
    const projection = workflowProjection('collect')
    const correctedProjection = workflowProjection('review')
    const currentRevision = createDocumentRevision(original, `sha256:${'1'.repeat(64)}`)
    const valid: DocumentAnalysis = {
      ...currentRevision,
      structurallyValid: true,
      issues: [],
      projection,
    }
    const initial = synchronizeEditorProjection(null, { pair: original, revision: currentRevision, analysis: valid })
    const edited = { ...original, definition: { ...original.definition, text: 'name: [\n', revision: 1 } }
    const editedRevision = createDocumentRevision(edited, currentRevision.contractDigest)

    const pending = synchronizeEditorProjection(initial, { pair: edited, revision: editedRevision, analysis: null })
    const staleResponse = synchronizeEditorProjection(pending, {
      pair: edited,
      revision: editedRevision,
      analysis: valid,
    })
    const invalid = synchronizeEditorProjection(pending, {
      pair: edited,
      revision: editedRevision,
      analysis: { ...editedRevision, structurallyValid: false, issues: [] },
    })
    const corrected = synchronizeEditorProjection(invalid, {
      pair: edited,
      revision: editedRevision,
      analysis: { ...editedRevision, structurallyValid: true, issues: [], projection: correctedProjection },
    })

    expect(pending).toMatchObject({ projection, stale: true, readOnly: true, staleSource: 'retained' })
    expect(staleResponse).toMatchObject({ projection, stale: true, readOnly: true, staleSource: 'retained' })
    expect(invalid).toMatchObject({ projection, stale: true, readOnly: true, staleSource: 'retained' })
    expect(corrected).toMatchObject({
      projection: correctedProjection,
      stale: false,
      readOnly: false,
      staleSource: null,
    })
  })

  it('retains a current visually-authorable incomplete-node projection as stale and read-only', () => {
    const current = pair()
    const revision = createDocumentRevision(current, `sha256:${'1'.repeat(64)}`)
    const projection = workflowProjection('draft')

    const state = synchronizeEditorProjection(null, {
      pair: current,
      revision,
      analysis: {
        ...revision,
        structurallyValid: false,
        visuallyAuthorable: true,
        issues: [
          {
            code: 'schema_min_length',
            layer: 'contract',
            severity: 'error',
            blocking: true,
            message: 'Command must not be empty.',
            document: 'definition',
          },
        ],
        projection,
      },
    })

    expect(state).toEqual({
      workflowId: current.workflowId,
      projection,
      stale: true,
      readOnly: true,
      staleSource: 'current',
    })
  })

  it('commits every edit immediately while dispatching only the latest debounced worker analysis', () => {
    vi.useFakeTimers()
    const worker = new FakeWorker()
    const client = new DocumentClient(worker)
    let current = pair()
    const commit = (next: WorkflowPairText) => {
      current = next
      client.schedule(next, contract, 'edit')
    }

    applyAuthoritativeEditorText(current, 'definition', 'name: F\n', commit)
    applyAuthoritativeEditorText(current, 'definition', 'name: Fl\n', commit)
    applyAuthoritativeEditorText(current, 'definition', 'name: Flow\n', commit)

    expect(current.definition).toMatchObject({ text: 'name: Flow\n', revision: 3 })
    expect(worker.messages).toEqual([])
    vi.advanceTimersByTime(180)
    expect(worker.messages.filter(({ type }) => type === 'analyze')).toEqual([
      expect.objectContaining({ definition: expect.objectContaining({ text: 'name: Flow\n', revision: 3 }) }),
    ])
    client.dispose()
  })
})

const contract: AuthoringContract = {
  schema_version: 1,
  contract_reader_version: 1,
  profile: 'hermes-legacy',
  normalizer_version: 1,
  contract_digest: `sha256:${'1'.repeat(64)}`,
  definition_schema: {},
  sidecar_schema: {},
  node_kinds: [],
  semantic_rules: [],
  compatibility_codes: {},
  documentation: { topics: [], examples: [] },
  limits: { max_document_bytes: 2 * 1024 * 1024 },
  extensions: {},
}

function workflowProjection(id: string): WorkflowProjection {
  return {
    name: 'Flow',
    description: '',
    profile: 'hermes-legacy',
    nodes: [
      {
        id,
        kind: 'command',
        value: 'run',
        dependsOn: [],
        options: {},
        source: { path: '/nodes/0', start: 0, end: 10 },
      },
    ],
    edges: [],
    definition: {},
    companion: null,
  }
}

class FakeWorker implements DocumentWorkerEndpoint {
  readonly messages: DocumentWorkerRequest[] = []
  postMessage(message: DocumentWorkerRequest): void {
    this.messages.push(message)
  }
  addEventListener(): void {}
  removeEventListener(): void {}
}
