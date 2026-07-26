import type {
  ContractDigest,
  DocumentAnalysis,
  DocumentKind,
  DocumentRevision,
  TextDocumentState,
  WorkflowPairText,
} from './types'

export interface AnalysisState {
  revision: DocumentRevision
  analysis: DocumentAnalysis | null
}

export interface ConfirmedDocumentWrite {
  revision: number
  diskHash: string
}

export function editDocumentText(pair: WorkflowPairText, kind: DocumentKind, text: string): WorkflowPairText {
  const current = documentForKind(pair, kind)
  if (!current || current.text === text) return pair

  return replaceDocument(pair, kind, {
    ...current,
    text,
    revision: current.revision + 1,
  })
}

export function confirmDocumentSaved(
  pair: WorkflowPairText,
  kind: DocumentKind,
  confirmation: ConfirmedDocumentWrite,
): WorkflowPairText {
  const current = documentForKind(pair, kind)
  if (!current || confirmation.revision < current.savedRevision) return pair
  if (confirmation.revision > current.revision) {
    throw new RangeError('A saved revision cannot be newer than the authoritative text revision.')
  }

  return replaceDocument(pair, kind, {
    ...current,
    savedRevision: confirmation.revision,
    diskHash: confirmation.diskHash,
  })
}

export function removeCompanion(pair: WorkflowPairText): WorkflowPairText {
  if (!pair.companion) return pair

  return {
    ...pair,
    generation: pair.generation + 1,
    companion: null,
  }
}

export function setCompanion(pair: WorkflowPairText, companion: TextDocumentState): WorkflowPairText {
  if (companion.kind !== 'companion') throw new TypeError('A workflow companion must have kind "companion".')
  if (pair.companion === companion) return pair

  return {
    ...pair,
    generation: pair.generation + 1,
    companion,
  }
}

export function createDocumentRevision(pair: WorkflowPairText, contractDigest: ContractDigest): DocumentRevision {
  return {
    workflowId: pair.workflowId,
    pairGeneration: pair.generation,
    definitionRevision: pair.definition.revision,
    companionRevision: pair.companion?.revision ?? null,
    contractDigest,
  }
}

export function isAnalysisCurrent(revision: DocumentRevision, analysis: DocumentRevision): boolean {
  return (
    revision.workflowId === analysis.workflowId &&
    revision.pairGeneration === analysis.pairGeneration &&
    revision.definitionRevision === analysis.definitionRevision &&
    revision.companionRevision === analysis.companionRevision &&
    revision.contractDigest === analysis.contractDigest
  )
}

export function acceptAnalysis<T extends AnalysisState>(state: T, analysis: DocumentAnalysis): T {
  if (!isAnalysisCurrent(state.revision, analysis)) return state

  return { ...state, analysis }
}

function documentForKind(pair: WorkflowPairText, kind: DocumentKind): TextDocumentState | null {
  return kind === 'definition' ? pair.definition : pair.companion
}

function replaceDocument(pair: WorkflowPairText, kind: DocumentKind, document: TextDocumentState): WorkflowPairText {
  return kind === 'definition' ? { ...pair, definition: document } : { ...pair, companion: document }
}
