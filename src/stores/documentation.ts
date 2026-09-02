import { atom } from 'nanostores'
import type { DocumentationIndex, DocumentationSessionState } from '$src/lib/docs/types'

export const INITIAL_DOCUMENTATION_SESSION: DocumentationSessionState = {
  mode: 'overview',
  query: '',
  history: [],
  expandedGroupIds: [],
  navigationScrollTop: 0,
  articleScrollTop: 0,
}

export const $documentationSession = atom<DocumentationSessionState>(INITIAL_DOCUMENTATION_SESSION)

type DocumentationSessionPatch = Omit<Partial<DocumentationSessionState>, 'selectedTopicId' | 'highlightedTopicId'> & {
  readonly selectedTopicId?: string | undefined
  readonly highlightedTopicId?: string | undefined
}
type MutableDocumentationSessionState = {
  -readonly [Key in keyof DocumentationSessionState]: DocumentationSessionState[Key]
}

export function updateDocumentationSession(patch: DocumentationSessionPatch): void {
  const { selectedTopicId, highlightedTopicId, ...retainedPatch } = patch
  const next: MutableDocumentationSessionState = { ...$documentationSession.get(), ...retainedPatch }
  if (selectedTopicId !== undefined) next.selectedTopicId = selectedTopicId
  else if (Object.hasOwn(patch, 'selectedTopicId')) delete next.selectedTopicId
  if (highlightedTopicId !== undefined) next.highlightedTopicId = highlightedTopicId
  else if (Object.hasOwn(patch, 'highlightedTopicId')) delete next.highlightedTopicId
  $documentationSession.set(next)
}

export function reconcileDocumentationSession(index: DocumentationIndex): void {
  const current = $documentationSession.get()
  const next: MutableDocumentationSessionState = {
    ...current,
    history: current.history.filter((id) => index.byId.has(id)),
  }
  if (current.selectedTopicId && !index.byId.has(current.selectedTopicId)) delete next.selectedTopicId
  if (current.highlightedTopicId && !index.byId.has(current.highlightedTopicId)) delete next.highlightedTopicId
  $documentationSession.set(next)
}

export function resetDocumentationSession(): void {
  $documentationSession.set(INITIAL_DOCUMENTATION_SESSION)
}
