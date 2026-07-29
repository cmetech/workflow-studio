import type { NodeKindDescriptor, WorkflowProfile } from '$src/lib/contract/types'

export const NODE_KIND_DRAG_TYPE = 'application/x-workflow-studio-node-kind'

export function nodeKindAvailable(descriptor: NodeKindDescriptor, profile: WorkflowProfile): boolean {
  return descriptor.status === 'supported' && descriptor.applicability.profiles.includes(profile)
}

export function nodeKindStatus(descriptor: NodeKindDescriptor, profile: WorkflowProfile): string {
  if (!descriptor.applicability.profiles.includes(profile)) return `not available in ${profile}`
  return descriptor.status
}
