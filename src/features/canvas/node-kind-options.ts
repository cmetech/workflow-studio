import { readScopedDagCapabilities } from '$src/lib/contract/scoped-dag-rule'
import type { AuthoringContract, NodeKindDescriptor, WorkflowProfile } from '$src/lib/contract/types'
import type { GraphScope } from '$src/lib/projection/types'

export const NODE_KIND_DRAG_TYPE = 'application/x-workflow-studio-node-kind'

export function nodeKindAvailable(descriptor: NodeKindDescriptor, profile: WorkflowProfile): boolean {
  return descriptor.status === 'supported' && descriptor.applicability.profiles.includes(profile)
}

export function nodeKindStatus(descriptor: NodeKindDescriptor, profile: WorkflowProfile): string {
  if (!descriptor.applicability.profiles.includes(profile)) return `not available in ${profile}`
  return descriptor.status
}

export function nodeKindDescriptorsForScope(
  contract: AuthoringContract,
  scope: GraphScope,
): readonly NodeKindDescriptor[] {
  const supported = contract.node_kinds.filter((descriptor) => nodeKindAvailable(descriptor, contract.profile))
  if (scope.kind === 'root') return supported
  const allowed = new Set(readScopedDagCapabilities(contract).allowedNodeKinds)
  return supported.filter(({ id }) => allowed.has(id))
}
