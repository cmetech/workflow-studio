import type { WorkflowPairText } from '$src/lib/documents/types'
import type { WorkflowMutation } from '$src/lib/yaml/mutations'
import type { GitPairSnapshot, GitVersionResult } from './types'

export interface VersionActionsNative {
  gitCreatePairVersion(
    root: string,
    definitionPath: string,
    companionPath: string | null,
    message: string,
  ): Promise<GitVersionResult>
}

export interface VersionReadiness {
  readonly structurallyValid: boolean
  readonly definitionRevision: number
  readonly companionRevision: number | null
}

export async function createVersion(
  native: VersionActionsNative,
  input: {
    readonly root: string
    readonly pair: WorkflowPairText
    readonly analysis: VersionReadiness | null
    readonly message: string
  },
) {
  const message = input.message.trim()
  if (!message) return { status: 'blocked' as const, reason: 'message_required' as const }
  if (!pairIsSavedCurrentValid(input.pair, input.analysis)) {
    return { status: 'blocked' as const, reason: 'pair_not_saved_current_valid' as const }
  }
  const version = await native.gitCreatePairVersion(
    input.root,
    input.pair.definition.path,
    input.pair.companion?.path ?? null,
    message,
  )
  return { status: 'created' as const, version }
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
  ) => Promise<WorkflowPairText>
}): Promise<WorkflowPairText> {
  const group = `restore:${input.snapshot.oid}`
  let pair = input.pair
  if (input.snapshot.definition !== null && input.snapshot.definition !== pair.definition.text) {
    pair = await input.apply(
      pair,
      { type: 'replace-document', document: 'definition', text: input.snapshot.definition },
      group,
    )
  }
  if (
    input.snapshot.companion !== null &&
    pair.companion !== null &&
    input.snapshot.companion !== pair.companion.text
  ) {
    pair = await input.apply(
      pair,
      { type: 'replace-document', document: 'companion', text: input.snapshot.companion },
      group,
    )
  }
  return pair
}

export function compareHistoricalPair(pair: WorkflowPairText, snapshot: GitPairSnapshot) {
  return Object.freeze({
    oid: snapshot.oid,
    definition: Object.freeze({ current: pair.definition.text, historical: snapshot.definition }),
    companion: Object.freeze({ current: pair.companion?.text ?? null, historical: snapshot.companion }),
  })
}
