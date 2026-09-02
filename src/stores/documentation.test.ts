import { afterEach, describe, expect, it } from 'vitest'
import { $documentSession } from './documents'
import {
  $documentationSession,
  INITIAL_DOCUMENTATION_SESSION,
  reconcileDocumentationSession,
  resetDocumentationSession,
  updateDocumentationSession,
} from './documentation'
import type { DocumentationIndex, DocumentationTopic } from '$src/lib/docs/types'

const topic = (id: string): DocumentationTopic => ({
  id,
  kind: id.startsWith('guide:') ? 'guide' : 'field',
  title: id,
  description: `${id} description`,
  body: `${id} body`,
  qualifier: id.startsWith('guide:') ? 'Guide' : 'Prompt node',
  useWhen: `Use ${id}.`,
  breadcrumb: id.startsWith('guide:') ? ['Guides', 'Getting started'] : ['Reference', 'Node-specific fields'],
  renderer: 'markdown',
  examples: [],
  status: 'supported',
  profile: 'archon-2026-07',
  fieldPaths: [],
})

function indexWith(...ids: string[]): DocumentationIndex {
  const topics = ids.map(topic)
  return {
    topics,
    byId: new Map(topics.map((item) => [item.id, item])),
    searchText: new Map(),
    tokenIndex: new Map(),
    guideGroups: new Map(),
    referenceGroups: new Map(),
    duplicateTitleGroups: new Map(),
  }
}

afterEach(() => {
  resetDocumentationSession()
  $documentSession.set({ pair: null, revision: null, analysis: null })
})

describe('documentation session store', () => {
  it('merges session-only navigation changes without replacing retained values or touching workflow documents', () => {
    const documentState = { pair: null, revision: null, analysis: null }
    $documentSession.set(documentState)
    updateDocumentationSession({ mode: 'reference', query: 'context', navigationScrollTop: 96 })
    updateDocumentationSession({ selectedTopicId: 'field:prompt.node.context', history: ['guide:quick-start'] })

    expect($documentationSession.get()).toEqual({
      ...INITIAL_DOCUMENTATION_SESSION,
      mode: 'reference',
      query: 'context',
      selectedTopicId: 'field:prompt.node.context',
      history: ['guide:quick-start'],
      navigationScrollTop: 96,
    })
    expect($documentSession.get()).toBe(documentState)
  })

  it('reconciles selection, history, and highlight by stable topic ID when a profile removes topics', () => {
    updateDocumentationSession({
      selectedTopicId: 'field:prompt.node.context',
      history: ['field:removed', 'guide:quick-start', 'field:prompt.node.context'],
      highlightedTopicId: 'field:removed',
      expandedGroupIds: ['reference:common-node-settings', 'duplicate:context'],
      articleScrollTop: 140,
    })

    reconcileDocumentationSession(indexWith('field:prompt.node.context', 'guide:quick-start'))

    expect($documentationSession.get()).toMatchObject({
      selectedTopicId: 'field:prompt.node.context',
      history: ['guide:quick-start', 'field:prompt.node.context'],
      expandedGroupIds: ['reference:common-node-settings', 'duplicate:context'],
      articleScrollTop: 140,
    })
    expect($documentationSession.get()).not.toHaveProperty('highlightedTopicId')
  })

  it('clears absent selected and highlighted topics and restores the exact initial state on reset', () => {
    updateDocumentationSession({
      mode: 'guides',
      query: 'missing',
      selectedTopicId: 'field:removed',
      highlightedTopicId: 'field:removed',
      history: ['field:removed'],
      expandedGroupIds: ['duplicate:context'],
      navigationScrollTop: 22,
      articleScrollTop: 33,
    })

    reconcileDocumentationSession(indexWith('guide:quick-start'))
    expect($documentationSession.get()).toMatchObject({ history: [] })
    expect($documentationSession.get()).not.toHaveProperty('selectedTopicId')
    expect($documentationSession.get()).not.toHaveProperty('highlightedTopicId')

    resetDocumentationSession()
    expect($documentationSession.get()).toEqual(INITIAL_DOCUMENTATION_SESSION)
  })
})
