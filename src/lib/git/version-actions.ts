import type { WorkflowPairText } from '$src/lib/documents/types'
import type { YamlTransaction } from '$src/lib/documents/transactions'
import type { WorkflowMutation } from '$src/lib/yaml/mutations'
import type { GitPairSnapshot, GitVersionResult } from './types'

export interface VersionActionsNative {
  gitCreatePairVersion(
    root: string,
    definitionPath: string,
    companionPath: string | null,
    message: string,
    authorizationToken: string,
  ): Promise<GitVersionResult>
}

export interface VersionReadiness {
  readonly structurallyValid: boolean
  readonly definitionRevision: number
  readonly companionRevision: number | null
}

export type CreateVersionOutcome =
  | { readonly status: 'committed'; readonly oid: string; readonly warnings: readonly string[] }
  | {
      readonly status: 'unknown'
      readonly code: 'git_commit_outcome_unknown'
      readonly message: string
    }

export async function createVersion(
  native: VersionActionsNative,
  input: {
    readonly root: string
    readonly pair: WorkflowPairText
    readonly analysis: VersionReadiness | null
    readonly message: string
    readonly authorizationToken: string
  },
) {
  const message = input.message.trim()
  if (!message) return { status: 'blocked' as const, reason: 'message_required' as const }
  if (!input.authorizationToken) return { status: 'blocked' as const, reason: 'preview_required' as const }
  if (!pairIsSavedCurrentValid(input.pair, input.analysis)) {
    return { status: 'blocked' as const, reason: 'pair_not_saved_current_valid' as const }
  }
  const version = await native.gitCreatePairVersion(
    input.root,
    input.pair.definition.path,
    input.pair.companion?.path ?? null,
    message,
    input.authorizationToken,
  )
  if (version.outcome === 'unknown') {
    return { status: 'unknown' as const, code: version.code, message: version.message }
  }
  return { status: 'committed' as const, oid: version.oid, warnings: version.warnings }
}

export async function refreshAfterVersion(
  result: CreateVersionOutcome,
  refresh: () => Promise<void>,
): Promise<CreateVersionOutcome> {
  if (result.status === 'unknown') return result
  const warnings = [...result.warnings]
  try {
    await refresh()
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : 'Local Git refresh failed.'
    warnings.push(boundedWarning(`The version was committed, but the Git view could not be refreshed: ${detail}`))
  }
  return { ...result, warnings }
}

function boundedWarning(message: string): string {
  return message.length <= 4_096 ? message : `${message.slice(0, 4_096)}…`
}

export function pairIsSavedCurrentValid(pair: WorkflowPairText, analysis: VersionReadiness | null): boolean {
  return Boolean(
    analysis?.structurallyValid &&
    pair.generation === pair.savedGeneration &&
    pair.definition.revision === pair.definition.savedRevision &&
    (pair.companion === null || pair.companion.revision === pair.companion.savedRevision) &&
    analysis.definitionRevision === pair.definition.revision &&
    analysis.companionRevision === (pair.companion?.revision ?? null),
  )
}

export async function loadHistoricalPairAsDraft(input: {
  readonly pair: WorkflowPairText
  readonly snapshot: GitPairSnapshot
  readonly apply: (
    pair: WorkflowPairText,
    mutation: Extract<WorkflowMutation, { readonly type: 'replace-document' }>,
    group: string,
  ) => Promise<{ readonly pair: WorkflowPairText; readonly transaction: YamlTransaction }>
}): Promise<{ readonly pair: WorkflowPairText; readonly transaction: YamlTransaction | null }> {
  const group = `restore:${input.snapshot.oid}`
  let pair = input.pair
  const transactions: YamlTransaction[] = []
  if (input.snapshot.definition !== null && input.snapshot.definition !== pair.definition.text) {
    const applied = await input.apply(
      pair,
      { type: 'replace-document', document: 'definition', text: input.snapshot.definition },
      group,
    )
    pair = applied.pair
    transactions.push(applied.transaction)
  }
  if (
    input.snapshot.companion !== null &&
    pair.companion !== null &&
    input.snapshot.companion !== pair.companion.text
  ) {
    const applied = await input.apply(
      pair,
      { type: 'replace-document', document: 'companion', text: input.snapshot.companion },
      group,
    )
    pair = applied.pair
    transactions.push(applied.transaction)
  }
  return { pair, transaction: composeRestoreTransaction(transactions, input.snapshot.oid) }
}

function composeRestoreTransaction(transactions: readonly YamlTransaction[], oid: string): YamlTransaction | null {
  const first = transactions[0]
  const last = transactions.at(-1)
  if (!first || !last) return null
  return Object.freeze({
    ...first,
    label: `Restore pair from ${oid.slice(0, 12)}`,
    before: first.before,
    after: last.after,
    beforeRevisions: first.beforeRevisions,
    afterRevisions: last.afterRevisions,
  })
}

export function compareHistoricalPair(pair: WorkflowPairText, snapshot: GitPairSnapshot) {
  return Object.freeze({
    oid: snapshot.oid,
    definition: Object.freeze({ current: pair.definition.text, historical: snapshot.definition }),
    companion: Object.freeze({ current: pair.companion?.text ?? null, historical: snapshot.companion }),
  })
}
