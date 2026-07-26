import { atom } from 'nanostores'
import { acceptAnalysis, createDocumentRevision, isAnalysisCurrent } from '$src/lib/documents/revisions'
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

export function closeDocumentSession(): void {
  $documentSession.set(emptyDocumentSession)
}
