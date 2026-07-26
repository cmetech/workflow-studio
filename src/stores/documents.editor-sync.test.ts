import { afterEach, describe, expect, it } from 'vitest'
import type { WorkflowPairText } from '$src/lib/documents/types'
import { editDocumentText } from '$src/lib/documents/revisions'
import { $documentSyncOrigins, closeDocumentSession, openDocumentSession, updateDocumentSession } from './documents'

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
})
