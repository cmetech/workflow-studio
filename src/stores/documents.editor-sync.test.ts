import { afterEach, describe, expect, it } from 'vitest'
import type { DocumentAnalysis, WorkflowPairText } from '$src/lib/documents/types'
import { createDocumentRevision, editDocumentText } from '$src/lib/documents/revisions'
import {
  $documentSession,
  $documentSyncOrigins,
  closeDocumentSession,
  openDocumentSession,
  updateDocumentSession,
} from './documents'

const digest = `sha256:${'1'.repeat(64)}` as const

function pair(): WorkflowPairText {
  return {
    workflowId: 'workflow:workspace:flow.yaml',
    generation: 0,
    savedGeneration: 0,
    definition: {
      id: 'definition',
      kind: 'definition',
      path: 'flow.yaml',
      text: 'name: Flow\n',
      revision: 0,
      savedRevision: 0,
      diskHash: null,
    },
    companion: {
      id: 'companion',
      kind: 'companion',
      path: 'flow.hermes.yaml',
      text: 'language_compatibility: hermes-legacy\n',
      revision: 0,
      savedRevision: 0,
      diskHash: null,
    },
  }
}

describe('document editor synchronization origins', () => {
  afterEach(() => closeDocumentSession())

  it('tracks the exact changed tab origin without changing the other tab', () => {
    const opened = pair()
    openDocumentSession(opened, digest)
    const visual = editDocumentText(opened, 'definition', 'name: Visual\n')
    updateDocumentSession(visual, digest, 'visual')

    expect($documentSyncOrigins.get()).toEqual({
      workflowId: opened.workflowId,
      definition: { revision: 1, origin: 'visual' },
      companion: { revision: 0, origin: 'unknown' },
    })

    const user = editDocumentText(visual, 'companion', 'language_compatibility: archon-2026-07\n')
    updateDocumentSession(user, digest, 'user')
    expect($documentSyncOrigins.get()).toEqual({
      workflowId: opened.workflowId,
      definition: { revision: 1, origin: 'visual' },
      companion: { revision: 1, origin: 'user' },
    })
  })

  it('publishes an exact supplied analysis atomically with its changed pair and revision', () => {
    const opened = pair()
    openDocumentSession(opened, digest)
    const edited = editDocumentText(opened, 'definition', 'name: Analyzed\n')
    const analysis: DocumentAnalysis = {
      ...createDocumentRevision(edited, digest),
      issues: [],
      structurallyValid: true,
      projection: { nodes: [], edges: [] },
    }
    let publications = 0
    const unbind = $documentSession.subscribe(() => {
      publications += 1
    })
    publications = 0

    const accepted = updateDocumentSession(edited, digest, 'form', analysis)

    expect(accepted).toBe(true)
    expect($documentSession.get()).toEqual({ pair: edited, revision: createDocumentRevision(edited, digest), analysis })
    expect(publications).toBe(1)
    unbind()
  })

  it('rejects a stale or digest-mismatched supplied analysis while still publishing the edit once', () => {
    const opened = pair()
    openDocumentSession(opened, digest)
    const edited = editDocumentText(opened, 'definition', 'name: Changed\n')
    const stale: DocumentAnalysis = {
      ...createDocumentRevision(opened, digest),
      issues: [],
      structurallyValid: true,
    }
    const wrongDigest: DocumentAnalysis = {
      ...createDocumentRevision(edited, `sha256:${'2'.repeat(64)}`),
      issues: [],
      structurallyValid: true,
    }

    expect(updateDocumentSession(edited, digest, 'form', stale)).toBe(false)
    expect($documentSession.get().analysis).toBeNull()
    expect(updateDocumentSession(edited, digest, 'form', wrongDigest)).toBe(false)
    expect($documentSession.get().analysis).toBeNull()
  })
})
