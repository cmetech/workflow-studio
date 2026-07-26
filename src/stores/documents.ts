import { atom } from 'nanostores'
import {
  acceptAnalysis,
  confirmDocumentSaved,
  createDocumentRevision,
  isAnalysisCurrent,
} from '$src/lib/documents/revisions'
import type {
  ContractDigest,
  DocumentAnalysis,
  DocumentRevision,
  ValidationIssue,
  WorkflowPairText,
} from '$src/lib/documents/types'

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

export type DocumentSyncOrigin = 'user' | 'visual' | 'form' | 'disk' | 'recovery' | 'unknown'

export interface DocumentSyncOrigins {
  readonly workflowId: string | null
  readonly definition: { readonly revision: number; readonly origin: DocumentSyncOrigin } | null
  readonly companion: { readonly revision: number; readonly origin: DocumentSyncOrigin } | null
}

const emptyDocumentSyncOrigins: DocumentSyncOrigins = {
  workflowId: null,
  definition: null,
  companion: null,
}

export const $documentSyncOrigins = atom<DocumentSyncOrigins>(emptyDocumentSyncOrigins)

export interface ProblemFocusState {
  readonly issue: ValidationIssue | null
  readonly targetRevision: DocumentRevision | null
  readonly requested: boolean
  readonly requestRevision: number
}

export const $problemFocus = atom<ProblemFocusState>({
  issue: null,
  targetRevision: null,
  requested: false,
  requestRevision: 0,
})

export function selectProblem(issue: ValidationIssue): void {
  const current = $problemFocus.get()
  $problemFocus.set({
    issue: structuredClone(issue),
    targetRevision: $documentSession.get().revision ? structuredClone($documentSession.get().revision) : null,
    requested: false,
    requestRevision: current.requestRevision,
  })
}

export function acknowledgeProblemFocus(requestRevision?: number): void {
  const current = $problemFocus.get()
  if (requestRevision !== undefined && current.requestRevision !== requestRevision) return
  $problemFocus.set({
    issue: null,
    targetRevision: null,
    requested: false,
    requestRevision: current.requestRevision,
  })
}

export function requestProblemFocus(): void {
  const current = $problemFocus.get()
  if (!current.issue) return
  $problemFocus.set({ ...current, requested: true, requestRevision: current.requestRevision + 1 })
}

export function openDocumentSession(pair: WorkflowPairText, contractDigest: ContractDigest): void {
  $documentSession.set({
    pair,
    revision: createDocumentRevision(pair, contractDigest),
    analysis: null,
  })
  $documentSyncOrigins.set(syncOriginsFor(pair, 'unknown'))
}

export function updateDocumentSession(
  pair: WorkflowPairText,
  contractDigest: ContractDigest,
  origin: DocumentSyncOrigin = 'unknown',
): void {
  const revision = createDocumentRevision(pair, contractDigest)
  const current = $documentSession.get()
  const analysis = current.analysis
  const syncOrigins = mergeSyncOrigins(current.pair, pair, origin)
  $documentSession.set({
    pair,
    revision,
    analysis: analysis && isAnalysisCurrent(revision, analysis) ? analysis : null,
  })
  $documentSyncOrigins.set(syncOrigins)
}

export function receiveDocumentAnalysis(analysis: DocumentAnalysis): void {
  const current = $documentSession.get()
  if (!current.revision) return

  const accepted = acceptAnalysis({ revision: current.revision, analysis: current.analysis }, analysis)
  if (accepted.analysis === current.analysis) return

  $documentSession.set({ ...current, analysis: accepted.analysis })
}

export function invalidateDocumentAnalysis(): void {
  const current = $documentSession.get()
  if (current.analysis) $documentSession.set({ ...current, analysis: null })
}

export function replaceDocumentSessionPair(pair: WorkflowPairText, contractDigest: ContractDigest): WorkflowPairText {
  const current = $documentSession.get()
  if (current.pair?.workflowId !== pair.workflowId) return pair
  if (current.pair.generation !== pair.generation) {
    let mergedGeneration = current.pair
    mergedGeneration = mergeSavedDocument(mergedGeneration, pair, 'definition')
    mergedGeneration = mergeSavedDocument(mergedGeneration, pair, 'companion')
    mergedGeneration = mergeSavedPairStructure(mergedGeneration, pair)
    updateDocumentSession(mergedGeneration, contractDigest)
    return mergedGeneration
  }
  if (
    current.pair.definition.revision < pair.definition.revision ||
    (current.pair.companion?.revision ?? -1) < (pair.companion?.revision ?? -1)
  ) {
    updateDocumentSession(pair, contractDigest)
    return pair
  }

  let merged = current.pair
  merged = mergeSavedDocument(merged, pair, 'definition')
  merged = mergeSavedDocument(merged, pair, 'companion')
  merged = mergeSavedPairStructure(merged, pair)
  updateDocumentSession(merged, contractDigest)
  return merged
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
    pair.generation !== pair.savedGeneration ||
    pair.definition.revision !== pair.definition.savedRevision ||
    (pair.companion !== null && pair.companion.revision !== pair.companion.savedRevision)
  )
}

function mergeSavedPairStructure(current: WorkflowPairText, saved: WorkflowPairText): WorkflowPairText {
  if (saved.savedGeneration <= current.savedGeneration || saved.savedGeneration > current.generation) return current
  return { ...current, savedGeneration: saved.savedGeneration }
}

export function closeDocumentSession(): void {
  $documentSession.set(emptyDocumentSession)
  $documentSyncOrigins.set(emptyDocumentSyncOrigins)
  acknowledgeProblemFocus()
}

export function renameOpenDocumentPath(from: string, to: string): void {
  const current = $documentSession.get()
  if (!current.pair) return
  const definition =
    current.pair.definition.path === from ? { ...current.pair.definition, path: to } : current.pair.definition
  const companion =
    current.pair.companion?.path === from ? { ...current.pair.companion, path: to } : current.pair.companion
  if (definition === current.pair.definition && companion === current.pair.companion) return
  $documentSession.set({ ...current, pair: { ...current.pair, definition, companion } })
}

function syncOriginsFor(pair: WorkflowPairText, origin: DocumentSyncOrigin): DocumentSyncOrigins {
  return {
    workflowId: pair.workflowId,
    definition: { revision: pair.definition.revision, origin },
    companion: pair.companion ? { revision: pair.companion.revision, origin } : null,
  }
}

function mergeSyncOrigins(
  currentPair: WorkflowPairText | null,
  pair: WorkflowPairText,
  origin: DocumentSyncOrigin,
): DocumentSyncOrigins {
  const current = $documentSyncOrigins.get()
  if (current.workflowId !== pair.workflowId || currentPair?.workflowId !== pair.workflowId) {
    return syncOriginsFor(pair, origin)
  }
  return {
    workflowId: pair.workflowId,
    definition:
      currentPair.definition.revision === pair.definition.revision
        ? current.definition
        : { revision: pair.definition.revision, origin },
    companion: pair.companion
      ? currentPair.companion?.revision === pair.companion.revision
        ? current.companion
        : { revision: pair.companion.revision, origin }
      : null,
  }
}
