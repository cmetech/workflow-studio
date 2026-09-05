import type { WorkflowProfile } from '$src/lib/contract/types'
import type { GraphScopeKey, ProjectedGraph } from '$src/lib/projection/types'
import {
  referenceSurfaceForField,
  type PreparedReferenceContract,
  type ReferenceInsertionNamespace,
  type ReferenceSurfaceScope,
} from '$src/lib/references/reference-index'

export type ReferenceSuggestionNamespace = ReferenceInsertionNamespace

export interface LoopGroupReferenceSuggestion {
  readonly namespace: ReferenceSuggestionNamespace
  readonly producerId: string
  readonly token: string
  readonly available: boolean
  readonly canAddDependency: boolean
  readonly reason?: string
}

export function buildLoopGroupReferenceGuidance(input: {
  readonly bodyGraph: ProjectedGraph
  readonly rootGraph: ProjectedGraph
  readonly prepared: PreparedReferenceContract
  readonly consumerId?: string
}): readonly LoopGroupReferenceSuggestion[] {
  const { bodyGraph, rootGraph, prepared } = input
  if (bodyGraph.scope.kind !== 'loop-group' || !bodyGraph.scope.groupId) return []
  const bodyIds = new Set(bodyGraph.nodes.map(({ id }) => id))
  const groupId = bodyGraph.scope.groupId
  const consumer = bodyGraph.nodes.find(({ id }) => id === input.consumerId)
  const currentIds = consumer?.dependsOn ?? []
  const current = currentIds
    .filter((id) => bodyIds.has(id))
    .map((producerId) => suggestion('current', producerId, `$${producerId}.output`, true))
  const directOuter = bodyGraph.outerInputs
    .filter((producerId) => !bodyIds.has(producerId))
    .map((producerId) => suggestion('outer', producerId, `$${producerId}.output`, true))
  const unavailableOuter = rootGraph.definitionOrder
    .filter(
      (producerId) => producerId !== groupId && !bodyIds.has(producerId) && !bodyGraph.outerInputs.includes(producerId),
    )
    .map((producerId) => ({
      ...suggestion('outer', producerId, `$${producerId}.output`, false),
      canAddDependency: true,
      reason: `Add ${producerId} as a dependency of ${groupId} to use this outer output.`,
    }))
  const previous = bodyGraph.definitionOrder.map((producerId) =>
    suggestion('previous', producerId, `${prepared.capabilities.previousIteration.prefix}${producerId}.output`, true),
  )
  return Object.freeze([...current, ...directOuter, ...previous, ...unavailableOuter])
}

function suggestion(
  namespace: ReferenceSuggestionNamespace,
  producerId: string,
  token: string,
  available: boolean,
): LoopGroupReferenceSuggestion {
  return Object.freeze({ namespace, producerId, token, available, canAddDependency: false })
}

export interface ReferenceTargetIdentity {
  readonly workflowId: string
  readonly pairGeneration: number
  readonly definitionRevision: number
  readonly companionRevision: number | null
  readonly contractDigest: `sha256:${string}`
  readonly profile: WorkflowProfile
  readonly scopeKey: GraphScopeKey
  readonly bindingIdentity: string
  readonly concretePath: readonly (string | number)[]
  readonly canonicalFieldPath: string
  readonly surfaceScope: Extract<ReferenceSurfaceScope, 'body' | 'group-control'>
  readonly surfaceDiscriminatorId?: string
  readonly originalText: string
  readonly selectionStart: number
  readonly selectionEnd: number
}

export type ReferenceTargetResult = { readonly ok: true } | { readonly ok: false; readonly message: string }

export class LoopGroupReferenceTargetOwner {
  #target: {
    readonly identity: ReferenceTargetIdentity
    readonly control: HTMLInputElement | HTMLTextAreaElement
  } | null = null

  remember(identity: ReferenceTargetIdentity, control: HTMLInputElement | HTMLTextAreaElement): void {
    this.#target = { identity: structuredClone(identity), control }
  }

  clear(): void {
    this.#target = null
  }

  insert(
    token: string,
    namespace: ReferenceInsertionNamespace,
    current: ReferenceTargetIdentity,
    prepared: PreparedReferenceContract,
  ): ReferenceTargetResult {
    const target = this.#target
    if (
      !target ||
      !target.control.isConnected ||
      stableIdentity(target.identity) !== stableIdentity(current) ||
      target.control.value !== target.identity.originalText ||
      target.control.selectionStart !== target.identity.selectionStart ||
      target.control.selectionEnd !== target.identity.selectionEnd ||
      !this.accepts(namespace, current, prepared)
    )
      return { ok: false, message: 'The Inspector field changed. Focus it again before inserting a reference.' }
    target.control.setRangeText(token, current.selectionStart, current.selectionEnd, 'end')
    target.control.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: token }))
    target.control.focus()
    return { ok: true }
  }

  accepts(
    namespace: ReferenceInsertionNamespace,
    current: ReferenceTargetIdentity,
    prepared: PreparedReferenceContract,
  ): boolean {
    const target = this.#target
    if (
      !target ||
      !target.control.isConnected ||
      stableIdentity(target.identity) !== stableIdentity(current) ||
      target.control.value !== target.identity.originalText ||
      target.control.selectionStart !== target.identity.selectionStart ||
      target.control.selectionEnd !== target.identity.selectionEnd
    )
      return false
    const surface = referenceSurfaceForField(
      prepared,
      current.surfaceScope,
      current.canonicalFieldPath,
      current.originalText,
      namespace,
    )
    return Boolean(surface && surface.discriminatorId === current.surfaceDiscriminatorId)
  }

  async copy(token: string, write: (text: string) => Promise<void>): Promise<ReferenceTargetResult> {
    try {
      await write(token)
      return { ok: true }
    } catch {
      return { ok: false, message: 'The reference could not be copied to the clipboard.' }
    }
  }
}

function stableIdentity(identity: ReferenceTargetIdentity): string {
  return JSON.stringify(identity)
}
