import { atom } from 'nanostores'
import {
  acceptAnalysis,
  confirmDocumentSaved,
  createDocumentRevision,
  isAnalysisCurrent,
} from '$src/lib/documents/revisions'
import type { ContractDigest, DocumentAnalysis, DocumentRevision, WorkflowPairText } from '$src/lib/documents/types'

export interface DocumentSessionState {
  pair: WorkflowPairText | null
  revision: DocumentRevision | null
  analysis: DocumentAnalysis | null
}

const emptyDocumentSession: DocumentSessionState = {
  pair: null,
  revision: null,
  analysis: null,
}

export const $documentSession = atom<DocumentSessionState>(emptyDocumentSession)

export function openDocumentSession(pair: WorkflowPairText, contractDigest: ContractDigest): void {
  $documentSession.set({
    pair,
    revision: createDocumentRevision(pair, contractDigest),
    analysis: null,
  })
}

export function updateDocumentSession(pair: WorkflowPairText, contractDigest: ContractDigest): void {
  const revision = createDocumentRevision(pair, contractDigest)
  const current = $documentSession.get()
  const analysis = current.analysis
  $documentSession.set({
    pair,
    revision,
    analysis: analysis && isAnalysisCurrent(revision, analysis) ? analysis : null,
  })
}

export function receiveDocumentAnalysis(analysis: DocumentAnalysis): void {
  const current = $documentSession.get()
  if (!current.revision) return

  const accepted = acceptAnalysis({ revision: current.revision, analysis: current.analysis }, analysis)
  if (accepted.analysis === current.analysis) return

  $documentSession.set({ ...current, analysis: accepted.analysis })
}

export function replaceDocumentSessionPair(pair: WorkflowPairText, contractDigest: ContractDigest): void {
  const current = $documentSession.get()
  if (current.pair?.workflowId !== pair.workflowId || current.pair.generation !== pair.generation) return

  let merged = current.pair
  merged = mergeSavedDocument(merged, pair, 'definition')
  merged = mergeSavedDocument(merged, pair, 'companion')
  updateDocumentSession(merged, contractDigest)
}

function mergeSavedDocument(
  current: WorkflowPairText,
  saved: WorkflowPairText,
  kind: 'definition' | 'companion',
): WorkflowPairText {
  const currentDocument = kind === 'definition' ? current.definition : current.companion
  const savedDocument = kind === 'definition' ? saved.definition : saved.companion
  if (
    !currentDocument ||
    !savedDocument ||
    currentDocument.path !== savedDocument.path ||
    savedDocument.diskHash === null ||
    savedDocument.savedRevision < currentDocument.savedRevision ||
    (savedDocument.savedRevision === currentDocument.savedRevision &&
      savedDocument.diskHash === currentDocument.diskHash) ||
    savedDocument.savedRevision > currentDocument.revision
  ) {
    return current
  }
  return confirmDocumentSaved(current, kind, {
    revision: savedDocument.savedRevision,
    diskHash: savedDocument.diskHash,
  })
}

export function isDocumentPairDirty(pair: WorkflowPairText): boolean {
  return (
    pair.definition.revision !== pair.definition.savedRevision ||
    (pair.companion !== null && pair.companion.revision !== pair.companion.savedRevision)
  )
}

export function closeDocumentSession(): void {
  $documentSession.set(emptyDocumentSession)
}
