import {
  confirmDocumentSaved,
  confirmPairStructureSaved,
  createDocumentRevision,
  editDocumentText,
  isAnalysisCurrent,
} from '$src/lib/documents/revisions'
import type {
  ContractDigest,
  DocumentAnalysis,
  DocumentKind,
  TextDocumentState,
  WorkflowPairText,
} from '$src/lib/documents/types'
import type {
  WorkspaceReadResult,
  WorkspaceTrashResult,
  WorkspaceTrashRequest,
  WorkspaceWriteRequest,
  WorkspaceWriteResult,
} from '$src/lib/native/types'
import { createRecoveryDraft } from '$src/lib/recovery/recovery-store'
import type { RecoveryDraft } from '$src/lib/recovery/types'
import type { HistoryState } from '$src/stores/history'
import { recordTransaction } from '$src/stores/history'
import { isDocumentPairDirty, openDocumentSession, replaceDocumentSessionPair } from '$src/stores/documents'
import type { YamlTransaction } from '$src/lib/documents/transactions'

export interface DocumentActionNative {
  workspaceRead(relativePath: string): Promise<WorkspaceReadResult>
  workspaceWrite(request: WorkspaceWriteRequest): Promise<WorkspaceWriteResult>
  workspaceTrashPaths(requests: readonly WorkspaceTrashRequest[]): Promise<WorkspaceTrashResult>
}

export interface OpenWorkflowPairOptions {
  readonly workflowId: string
  readonly definitionPath: string
  readonly companionPath: string | null
  readonly contractDigest: ContractDigest
  readonly native: DocumentActionNative
  readonly scheduleAnalysis: (pair: WorkflowPairText, reason: 'open') => void
}

export async function openWorkflowPair(options: OpenWorkflowPairOptions): Promise<WorkflowPairText> {
  const [definition, companion] = await Promise.all([
    options.native.workspaceRead(options.definitionPath),
    options.companionPath ? options.native.workspaceRead(options.companionPath) : Promise.resolve(null),
  ])
  const pair: WorkflowPairText = {
    workflowId: options.workflowId,
    generation: 0,
    savedGeneration: 0,
    definition: openedDocument(options.workflowId, 'definition', definition),
    companion: companion ? openedDocument(options.workflowId, 'companion', companion) : null,
  }
  openDocumentSession(pair, options.contractDigest)
  options.scheduleAnalysis(pair, 'open')
  return pair
}

export interface SaveWorkflowPairOptions {
  readonly pair: WorkflowPairText
  readonly analysis: DocumentAnalysis | null
  readonly native: DocumentActionNative
  readonly removedCompanion?: { readonly path: string; readonly diskHash: string }
  readonly keepRecovery?: (draft: RecoveryDraft) => Promise<void>
  readonly discardRecovery?: (workflowId: string) => Promise<void>
  readonly now?: () => string
}

export interface SaveFileResult {
  readonly path: string
  readonly status: 'unchanged' | 'saved' | 'deleted' | 'failed'
  readonly diskHash?: string
  readonly modifiedAt?: string
  readonly errorCode?: string
  readonly message?: string
}

export type SaveWorkflowPairResult =
  | {
      readonly status: 'blocked'
      readonly pair: WorkflowPairText
      readonly issues: readonly DocumentAnalysis['issues'][number][]
      readonly reason: 'analysis_missing_or_stale' | 'structurally_invalid'
    }
  | {
      readonly status: 'saved' | 'partial'
      readonly pair: WorkflowPairText
      readonly results: {
        readonly definition: SaveFileResult
        readonly companion: SaveFileResult | null
      }
      readonly recoveryDraft?: RecoveryDraft
    }

export async function saveWorkflowPair(options: SaveWorkflowPairOptions): Promise<SaveWorkflowPairResult> {
  const currentAnalysis = options.analysis
  if (
    !currentAnalysis ||
    !isAnalysisCurrent(createDocumentRevision(options.pair, currentAnalysis.contractDigest), currentAnalysis)
  ) {
    return {
      status: 'blocked',
      pair: options.pair,
      issues: currentAnalysis?.issues ?? [],
      reason: 'analysis_missing_or_stale',
    }
  }
  if (!currentAnalysis.structurallyValid || hasStructuralBlocker(currentAnalysis)) {
    return {
      status: 'blocked',
      pair: options.pair,
      issues: currentAnalysis.issues,
      reason: 'structurally_invalid',
    }
  }

  let nextPair = options.pair
  const definitionResult = await saveDocument(nextPair.definition, options.native)
  if (definitionResult.status === 'failed') {
    const authoritativePair = replaceDocumentSessionPair(nextPair, currentAnalysis.contractDigest)
    const draft = await retainRecovery(authoritativePair, options)
    return {
      status: 'partial',
      pair: authoritativePair,
      results: { definition: definitionResult, companion: null },
      recoveryDraft: draft,
    }
  }
  if (definitionResult.status === 'saved') {
    nextPair = confirmDocumentSaved(nextPair, 'definition', {
      revision: options.pair.definition.revision,
      diskHash: definitionResult.diskHash ?? options.pair.definition.diskHash ?? '',
    })
  }

  let companionResult: SaveFileResult | null = null
  if (nextPair.companion) {
    companionResult = await saveDocument(nextPair.companion, options.native)
    if (companionResult.status === 'saved') {
      nextPair = confirmDocumentSaved(nextPair, 'companion', {
        revision: options.pair.companion?.revision ?? nextPair.companion.revision,
        diskHash: companionResult.diskHash ?? nextPair.companion.diskHash ?? '',
      })
    }
  } else if (options.removedCompanion) {
    companionResult = await deleteRemovedCompanion(options.removedCompanion, options.native)
  }

  if (companionResult?.status === 'failed') {
    const authoritativePair = replaceDocumentSessionPair(nextPair, currentAnalysis.contractDigest)
    const draft = await retainRecovery(authoritativePair, options)
    return {
      status: 'partial',
      pair: authoritativePair,
      results: { definition: definitionResult, companion: companionResult },
      recoveryDraft: draft,
    }
  }

  if (
    (nextPair.companion !== null && companionResult?.status === 'saved') ||
    (nextPair.companion === null && companionResult?.status === 'deleted')
  ) {
    nextPair = confirmPairStructureSaved(nextPair, options.pair.generation)
  }

  const authoritativePair = replaceDocumentSessionPair(nextPair, currentAnalysis.contractDigest)
  const recoveryDraft = isDocumentPairDirty(authoritativePair)
    ? await retainRecovery(authoritativePair, options)
    : undefined
  if (!recoveryDraft) await options.discardRecovery?.(authoritativePair.workflowId)
  return {
    status: 'saved',
    pair: authoritativePair,
    results: { definition: definitionResult, companion: companionResult },
    ...(recoveryDraft ? { recoveryDraft } : {}),
  }
}

export interface ExternalChangeConflict {
  readonly pair: WorkflowPairText
  readonly document: DocumentKind
  readonly disk: WorkspaceReadResult
  readonly choices: readonly ['keep-mine', 'reload-disk', 'compare']
  readonly diffViewed: boolean
}

export type ExternalChangeResult =
  | { readonly status: 'ignored'; readonly pair: WorkflowPairText }
  | { readonly status: 'reloaded'; readonly pair: WorkflowPairText }
  | { readonly status: 'conflict'; readonly pair: WorkflowPairText; readonly conflict: ExternalChangeConflict }

export function handleExternalChange(pair: WorkflowPairText, disk: WorkspaceReadResult): ExternalChangeResult {
  const document = documentForPath(pair, disk.relativePath)
  if (!document) return { status: 'ignored', pair }
  if (document.revision !== document.savedRevision) {
    return {
      status: 'conflict',
      pair,
      conflict: {
        pair,
        document: document.kind,
        disk,
        choices: ['keep-mine', 'reload-disk', 'compare'],
        diffViewed: false,
      },
    }
  }
  return { status: 'reloaded', pair: reloadDocument(pair, document.kind, disk) }
}

export type ExternalChangeChoice = ExternalChangeConflict['choices'][number]

export type ResolveExternalChangeResult =
  | {
      readonly status: 'diff-required'
      readonly pair: WorkflowPairText
      readonly conflict: ExternalChangeConflict
      readonly history: HistoryState
    }
  | {
      readonly status: 'compare'
      readonly pair: WorkflowPairText
      readonly conflict: ExternalChangeConflict
      readonly history: HistoryState
    }
  | {
      readonly status: 'resolved'
      readonly pair: WorkflowPairText
      readonly history: HistoryState
      readonly transaction?: YamlTransaction
    }

export function resolveExternalChange(
  conflict: ExternalChangeConflict,
  choice: ExternalChangeChoice,
  history: HistoryState,
): ResolveExternalChangeResult {
  if (choice === 'compare') {
    return { status: 'compare', pair: conflict.pair, conflict: { ...conflict, diffViewed: true }, history }
  }
  if (choice === 'keep-mine') {
    if (!conflict.diffViewed) return { status: 'diff-required', pair: conflict.pair, conflict, history }
    return {
      status: 'resolved',
      pair: updateDiskBaseline(conflict.pair, conflict.document, conflict.disk.sha256),
      history,
    }
  }

  const next = reloadDocument(conflict.pair, conflict.document, conflict.disk)
  const transaction = reloadTransaction(conflict.pair, next, conflict.document)
  return { status: 'resolved', pair: next, history: recordTransaction(history, transaction), transaction }
}

function openedDocument(workflowId: string, kind: DocumentKind, read: WorkspaceReadResult): TextDocumentState {
  return {
    id: `${workflowId}:${kind}`,
    kind,
    path: read.relativePath,
    text: read.text,
    revision: 0,
    savedRevision: 0,
    diskHash: read.sha256,
  }
}

async function saveDocument(document: TextDocumentState, native: DocumentActionNative): Promise<SaveFileResult> {
  if (document.diskHash !== null && document.revision === document.savedRevision) {
    return { path: document.path, status: 'unchanged' }
  }
  try {
    const result = await native.workspaceWrite({
      relativePath: document.path,
      text: document.text,
      expectedCurrentHash: document.diskHash,
    })
    return {
      path: result.relativePath,
      status: 'saved',
      diskHash: result.sha256,
      modifiedAt: result.modifiedAt,
    }
  } catch (error: unknown) {
    return failedFile(document.path, error)
  }
}

async function deleteRemovedCompanion(
  removed: { readonly path: string; readonly diskHash: string },
  native: DocumentActionNative,
): Promise<SaveFileResult> {
  try {
    const latest = await native.workspaceRead(removed.path)
    if (latest.sha256 !== removed.diskHash) {
      return {
        path: removed.path,
        status: 'failed',
        errorCode: 'external_revision_conflict',
        message: 'The companion changed on disk before it could be removed.',
      }
    }
    const result = await native.workspaceTrashPaths([
      { relativePath: removed.path, expectedCurrentHash: removed.diskHash },
    ])
    const exact = result.results.filter((pathResult) => pathResult.relativePath === removed.path)
    if (result.results.length !== 1 || exact.length !== 1 || exact[0]?.status !== 'trashed') {
      const outcome = exact[0]
      return {
        path: removed.path,
        status: 'failed',
        errorCode: outcome?.errorCode ?? 'workspace_trash_failed',
        message: outcome?.message ?? 'The native Trash operation did not confirm the exact companion path.',
      }
    }
    return { path: removed.path, status: 'deleted' }
  } catch (error: unknown) {
    return failedFile(removed.path, error)
  }
}

async function retainRecovery(pair: WorkflowPairText, options: SaveWorkflowPairOptions): Promise<RecoveryDraft> {
  const draft = createRecoveryDraft(pair, (options.now ?? (() => new Date().toISOString()))())
  await options.keepRecovery?.(draft)
  return draft
}

function failedFile(path: string, error: unknown): SaveFileResult {
  return {
    path,
    status: 'failed',
    errorCode: readErrorField(error, 'code') ?? 'workspace_write_failed',
    message:
      error instanceof Error ? error.message : (readErrorField(error, 'message') ?? 'The file operation failed.'),
  }
}

function readErrorField(error: unknown, field: 'code' | 'message'): string | null {
  if (typeof error !== 'object' || error === null || !(field in error)) return null
  const value = (error as Record<string, unknown>)[field]
  return typeof value === 'string' ? value : null
}

function hasStructuralBlocker(analysis: DocumentAnalysis): boolean {
  return analysis.issues.some(
    (issue) => issue.blocking && (issue.layer === 'syntax' || issue.layer === 'contract' || issue.layer === 'semantic'),
  )
}

function documentForPath(pair: WorkflowPairText, path: string): TextDocumentState | null {
  if (pair.definition.path === path) return pair.definition
  if (pair.companion?.path === path) return pair.companion
  return null
}

function documentForKind(pair: WorkflowPairText, kind: DocumentKind): TextDocumentState | null {
  return kind === 'definition' ? pair.definition : pair.companion
}

function replaceDocument(pair: WorkflowPairText, kind: DocumentKind, document: TextDocumentState): WorkflowPairText {
  return kind === 'definition' ? { ...pair, definition: document } : { ...pair, companion: document }
}

function reloadDocument(pair: WorkflowPairText, kind: DocumentKind, disk: WorkspaceReadResult): WorkflowPairText {
  const current = documentForKind(pair, kind)
  if (!current) return pair
  const edited = editDocumentText(pair, kind, disk.text)
  const next = documentForKind(edited, kind)
  if (!next) return pair
  return replaceDocument(edited, kind, { ...next, savedRevision: next.revision, diskHash: disk.sha256 })
}

function updateDiskBaseline(pair: WorkflowPairText, kind: DocumentKind, diskHash: string): WorkflowPairText {
  const current = documentForKind(pair, kind)
  return current ? replaceDocument(pair, kind, { ...current, diskHash }) : pair
}

function reloadTransaction(before: WorkflowPairText, after: WorkflowPairText, kind: DocumentKind): YamlTransaction {
  return {
    mutation: { type: 'replace-document', document: kind, text: documentForKind(after, kind)?.text ?? '' },
    label: `Reload ${kind} from disk`,
    workflowId: before.workflowId,
    pairGeneration: before.generation,
    before: { definition: before.definition.text, companion: before.companion?.text ?? null },
    after: { definition: after.definition.text, companion: after.companion?.text ?? null },
    beforeRevisions: { definition: before.definition.revision, companion: before.companion?.revision ?? null },
    afterRevisions: { definition: after.definition.revision, companion: after.companion?.revision ?? null },
    selection: { document: kind },
  }
}
