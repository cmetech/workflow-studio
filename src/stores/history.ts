import { atom } from 'nanostores'
import type { WorkflowPairText } from '$src/lib/documents/types'
import { editDocumentText } from '$src/lib/documents/revisions'
import type { TransactionRevisions, TransactionTexts, YamlTransaction } from '$src/lib/documents/transactions'

const MAX_TRANSACTIONS = 200
const MAX_TEXT_BYTES = 16 * 1024 * 1024

export interface HistoryState {
  readonly undo: readonly YamlTransaction[]
  readonly redo: readonly YamlTransaction[]
}

export type HistoryOperationResult =
  | { ok: true; pair: WorkflowPairText; history: HistoryState; transaction: YamlTransaction }
  | { ok: false; code: 'history_revision_conflict'; message: string; history: HistoryState }

export function createHistoryState(): HistoryState {
  return historyState([], [])
}

export const historyStore = atom<HistoryState>(createHistoryState())

export function migrateHistoryWorkflowIdentity(
  history: HistoryState,
  fromWorkflowId: string,
  toWorkflowId: string,
): HistoryState {
  const migrate = (transaction: YamlTransaction): YamlTransaction =>
    transaction.workflowId === fromWorkflowId
      ? snapshotTransaction({ ...transaction, workflowId: toWorkflowId })
      : snapshotTransaction(transaction)
  return historyState(history.undo.map(migrate), history.redo.map(migrate))
}

export function recordTransaction(history: HistoryState, transaction: YamlTransaction): HistoryState {
  const undo = [...history.undo, snapshotTransaction(transaction)]
  while (undo.length > MAX_TRANSACTIONS || historyBytes(undo) > MAX_TEXT_BYTES) undo.shift()
  return historyState(undo, [])
}

export function undoTransaction(history: HistoryState, pair: WorkflowPairText): HistoryOperationResult {
  const transaction = history.undo.at(-1)
  if (!transaction) return conflict(history, 'There is no transaction to undo.')
  if (!matchesBoundary(pair, transaction, transaction.afterRevisions)) {
    return conflict(history, 'The workflow revision changed after this transaction was recorded.')
  }

  const restored = applyExactTexts(pair, transaction.before)
  const redoTransaction = withBoundaries(
    transaction,
    pairRevisions(restored),
    nextRevisions(restored, transaction.after),
  )
  return {
    ok: true,
    pair: restored,
    transaction,
    history: historyState(history.undo.slice(0, -1), [...history.redo, redoTransaction]),
  }
}

export function redoTransaction(history: HistoryState, pair: WorkflowPairText): HistoryOperationResult {
  const transaction = history.redo.at(-1)
  if (!transaction) return conflict(history, 'There is no transaction to redo.')
  if (!matchesBoundary(pair, transaction, transaction.beforeRevisions)) {
    return conflict(history, 'The workflow revision changed after this transaction was undone.')
  }

  const restored = applyExactTexts(pair, transaction.after)
  const undoTransaction = withBoundaries(transaction, transaction.beforeRevisions, pairRevisions(restored))
  return {
    ok: true,
    pair: restored,
    transaction,
    history: historyState([...history.undo, undoTransaction], history.redo.slice(0, -1)),
  }
}

function applyExactTexts(pair: WorkflowPairText, texts: TransactionTexts): WorkflowPairText {
  let next = editDocumentText(pair, 'definition', texts.definition)
  if (next.companion && texts.companion !== null) next = editDocumentText(next, 'companion', texts.companion)
  return next
}

function matchesBoundary(
  pair: WorkflowPairText,
  transaction: YamlTransaction,
  revisions: TransactionRevisions,
): boolean {
  return (
    pair.workflowId === transaction.workflowId &&
    pair.generation === transaction.pairGeneration &&
    pair.definition.revision === revisions.definition &&
    (pair.companion?.revision ?? null) === revisions.companion
  )
}

function pairRevisions(pair: WorkflowPairText): TransactionRevisions {
  return { definition: pair.definition.revision, companion: pair.companion?.revision ?? null }
}

function nextRevisions(pair: WorkflowPairText, texts: TransactionTexts): TransactionRevisions {
  return {
    definition: pair.definition.revision + (pair.definition.text === texts.definition ? 0 : 1),
    companion:
      pair.companion && texts.companion !== null
        ? pair.companion.revision + (pair.companion.text === texts.companion ? 0 : 1)
        : null,
  }
}

function withBoundaries(
  transaction: YamlTransaction,
  beforeRevisions: TransactionRevisions,
  afterRevisions: TransactionRevisions,
): YamlTransaction {
  return snapshotTransaction({ ...transaction, beforeRevisions, afterRevisions })
}

function snapshotTransaction(transaction: YamlTransaction): YamlTransaction {
  return deepFreeze(structuredClone(transaction))
}

function historyState(undo: readonly YamlTransaction[], redo: readonly YamlTransaction[]): HistoryState {
  return Object.freeze({ undo: Object.freeze([...undo]), redo: Object.freeze([...redo]) })
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

function historyBytes(transactions: readonly YamlTransaction[]): number {
  const encoder = new TextEncoder()
  return transactions.reduce(
    (total, transaction) =>
      total +
      encoder.encode(transaction.before.definition).byteLength +
      encoder.encode(transaction.before.companion ?? '').byteLength +
      encoder.encode(transaction.after.definition).byteLength +
      encoder.encode(transaction.after.companion ?? '').byteLength,
    0,
  )
}

function conflict(history: HistoryState, message: string): HistoryOperationResult {
  return { ok: false, code: 'history_revision_conflict', message, history }
}
