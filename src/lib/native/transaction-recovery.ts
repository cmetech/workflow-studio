import type { PathOperationResult } from './types'

export interface TransactionRecoveryReceipt {
  readonly pathResults: readonly PathOperationResult[]
  readonly omittedPathResults: number
}
const statuses = new Set(['moved', 'rolledBack', 'trashed', 'written', 'failed', 'partial', 'recoveryRetained'])
const exactPath = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 32768

/** Display-only receipt: never treats a reported path as filesystem authority. */
export function extractTransactionRecovery(cause: unknown): TransactionRecoveryReceipt {
  if (!cause || typeof cause !== 'object') return { pathResults: [], omittedPathResults: 0 }
  const envelope = cause as Record<string, unknown>
  const successfulTransaction = !Array.isArray(envelope.pathResults) && !Array.isArray(envelope.recoveryResults)
  const values: readonly unknown[] = Array.isArray(envelope.pathResults)
    ? envelope.pathResults
    : Array.isArray(envelope.recoveryResults)
      ? envelope.recoveryResults
      : Array.isArray(envelope.results)
        ? envelope.results
        : []
  const alreadyOmitted =
    typeof envelope.omittedPathResults === 'number' &&
    Number.isSafeInteger(envelope.omittedPathResults) &&
    envelope.omittedPathResults > 0
      ? envelope.omittedPathResults
      : 0
  const pathResults: PathOperationResult[] = []
  let ordinaryResults = 0
  // Bound both inspection work and display size. Never turn a truncated path into a false recovery location.
  for (const value of values.slice(0, 256)) {
    if (pathResults.length === 128) break
    if (!value || typeof value !== 'object') continue
    const row = value as Record<string, unknown>
    const status = row.status
    if (
      !exactPath(row.relativePath) ||
      typeof status !== 'string' ||
      !statuses.has(status) ||
      (row.destinationPath !== undefined && !exactPath(row.destinationPath))
    )
      continue
    if (successfulTransaction && status !== 'recoveryRetained') {
      ordinaryResults += 1
      continue
    }
    pathResults.push(
      Object.freeze({
        relativePath: row.relativePath,
        ...(typeof row.destinationPath === 'string' ? { destinationPath: row.destinationPath } : {}),
        status: status as PathOperationResult['status'],
        ...(typeof row.errorCode === 'string' ? { errorCode: row.errorCode.slice(0, 128) } : {}),
        ...(typeof row.message === 'string' ? { message: row.message.slice(0, 1024) } : {}),
      }),
    )
  }
  return Object.freeze({
    pathResults: Object.freeze(pathResults),
    omittedPathResults: Math.min(
      Number.MAX_SAFE_INTEGER,
      alreadyOmitted + values.length - pathResults.length - ordinaryResults,
    ),
  })
}
