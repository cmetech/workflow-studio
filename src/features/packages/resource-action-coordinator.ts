import type { WorkflowPairText } from '$src/lib/documents/types'
import type { ResourceCreationPlan } from '$src/lib/packages/resource-actions'
import type { PackageMutationPlan, WorkspaceTransactionResult } from '$src/lib/native/types'
import type { YamlTransaction } from '$src/lib/documents/transactions'
import { confirmDocumentSaved } from '$src/lib/documents/revisions'
interface Dependencies {
  current(): WorkflowPairText | null
  workspaceId(): string | null
  apply(plan: PackageMutationPlan): Promise<WorkspaceTransactionResult>
  publish(pair: WorkflowPairText, transaction: YamlTransaction): void
}
/** Publish the YAML history boundary only after the exact native transaction commits. */
export async function commitResourcePlan(plan: ResourceCreationPlan, deps: Dependencies): Promise<void> {
  const before = deps.current()
  const revision = plan.expectedRevision
  const current = () => deps.current() === before && deps.workspaceId() === plan.nativePlan.workspaceId
  if (
    !before ||
    !current() ||
    before.workflowId !== revision.workflowId ||
    before.generation !== revision.pairGeneration ||
    before.definition.path !== revision.definitionPath ||
    before.definition.revision !== revision.definitionRevision ||
    (before.companion?.path ?? null) !== revision.companionPath ||
    (before.companion?.revision ?? null) !== revision.companionRevision
  )
    throw Error('The workflow or workspace changed. Preview the resource action again.')
  const diskHash = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(plan.nextPair.definition.text))),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('')
  if (!current()) throw Error('The workflow changed. Preview the resource action again.')
  await deps.apply(plan.nativePlan)
  if (!current())
    throw Error(
      'The resource transaction committed to disk, but the open workflow changed. Your newer draft was preserved; compare it with disk before saving.',
    )
  const saved = confirmDocumentSaved(plan.nextPair, 'definition', {
    revision: plan.nextPair.definition.revision,
    diskHash,
  })
  deps.publish(saved, plan.transaction)
}
