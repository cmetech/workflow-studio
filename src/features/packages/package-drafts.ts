import type { ArtifactRecoveryDraft, RecoveryDraft, RecoveryDocumentDraft } from '$src/lib/recovery/types'
import { comparePackagePaths } from '$src/lib/packages/paths'

/** Closed drafts remain recoverable; preparation must not silently substitute older disk content. */
export async function unresolvedPackageDrafts(input: {
  readonly workspaceId: string
  readonly packageRoot: string
  readonly artifactDrafts: readonly ArtifactRecoveryDraft[]
  readonly workflowDrafts: readonly RecoveryDraft[]
  readonly read: (path: string) => Promise<{ readonly text: string }>
}): Promise<readonly string[]> {
  const inside = (path: string) => !input.packageRoot || path.startsWith(input.packageRoot + '/')
  const documents: RecoveryDocumentDraft[] = input.artifactDrafts.filter(
    (draft) => draft.workspaceId === input.workspaceId && inside(draft.path),
  )
  for (const draft of input.workflowDrafts) {
    if (draft.workflowId !== `workflow:${input.workspaceId}:${draft.definition.path}`) continue
    if (inside(draft.definition.path)) documents.push(draft.definition)
    if (draft.companion && inside(draft.companion.path)) documents.push(draft.companion)
  }
  const unresolved = new Set<string>()
  for (const draft of documents) {
    try {
      if ((await input.read(draft.path)).text !== draft.text) unresolved.add(draft.path)
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'path_not_found')
        unresolved.add(draft.path)
      else throw error
    }
  }
  return [...unresolved].sort(comparePackagePaths)
}
