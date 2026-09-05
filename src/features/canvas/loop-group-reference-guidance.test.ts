import { describe, expect, it, vi } from 'vitest'
import archonContractJson from '../../../contracts/archon-2026-07-v6.json'
import { loadAuthoringContract } from '$src/lib/contract/contract-loader'
import { prepareReferenceContract } from '$src/lib/references/reference-index'
import type { ProjectedGraph } from '$src/lib/projection/types'
import {
  buildLoopGroupReferenceGuidance,
  LoopGroupReferenceTargetOwner,
  type ReferenceTargetIdentity,
} from './loop-group-reference-guidance'

async function prepared() {
  const loaded = await loadAuthoringContract(new TextEncoder().encode(JSON.stringify(archonContractJson)), {
    kind: 'bundled',
    identifier: 'archon-2026-07-v6.json',
  })
  if (!loaded.ok) throw new Error(loaded.message)
  const prepared = prepareReferenceContract(loaded.contract)
  if (!prepared) throw new Error('Expected prepared references')
  return prepared
}

function graph(scopeKey: 'root' | `loop-group:${string}`, ids: string[], outerInputs: string[] = []): ProjectedGraph {
  const groupId = scopeKey === 'root' ? undefined : scopeKey.slice('loop-group:'.length)
  return {
    scope: {
      key: scopeKey,
      kind: scopeKey === 'root' ? 'root' : 'loop-group',
      ...(groupId ? { groupId } : {}),
      workflow: { name: 'Scoped', profile: 'archon-2026-07' },
    },
    editorNodePrefix: groupId ? `${groupId}/` : '',
    sourcePath: groupId ? ['nodes', 2, 'loop_group', 'nodes'] : ['nodes'],
    sourceRange: { start: 0, end: 1 },
    nodes: ids.map((id, index) => ({
      id,
      kind: 'prompt',
      value: '',
      dependsOn: index === ids.length - 1 ? ids.slice(0, index) : [],
      options: {},
      source: { path: `/nodes/${index}`, start: 0, end: 1 },
    })),
    edges: [],
    definitionOrder: ids,
    outerInputs,
    issues: [],
    capacity: { status: 'visual', nodeCount: ids.length, edgeCount: 0 },
  }
}

describe('loop-group reference guidance', () => {
  it('publishes exact current, direct outer, previous, and missing-dependency tokens with shadow suppression', async () => {
    const body = graph('loop-group:repeat', ['prepare', 'child', 'consumer'], ['outer'])
    const root = graph('root', ['prepare', 'outer', 'unconnected', 'repeat'])
    const guidance = buildLoopGroupReferenceGuidance({
      bodyGraph: body,
      rootGraph: root,
      prepared: await prepared(),
      activeField: {
        surfaceScope: 'body',
        canonicalFieldPath: 'nodes[].prompt',
        currentValue: '',
        consumerId: 'consumer',
      },
    })
    expect(guidance.filter(({ namespace }) => namespace === 'current').map(({ token }) => token)).toEqual([
      '$prepare.output',
      '$child.output',
    ])
    expect(
      guidance.filter(({ namespace, available }) => namespace === 'outer' && available).map(({ token }) => token),
    ).toEqual(['$outer.output'])
    expect(guidance.filter(({ namespace }) => namespace === 'previous').map(({ token }) => token)).toEqual([
      '$LOOP_PREV.prepare.output',
      '$LOOP_PREV.child.output',
      '$LOOP_PREV.consumer.output',
    ])
    expect(guidance.find(({ producerId }) => producerId === 'unconnected')).toMatchObject({
      available: false,
      canAddDependency: true,
      reason: 'Add unconnected as a dependency of repeat to use this outer output.',
    })
    expect(guidance.some(({ namespace, producerId }) => namespace === 'outer' && producerId === 'prepare')).toBe(false)
  })

  it('derives current producers from the active group field instead of a preserved child selection', async () => {
    const body = graph('loop-group:repeat', ['prepare', 'child', 'consumer'], ['outer'])
    const root = graph('root', ['outer', 'repeat'])
    const contract = await prepared()
    const currentTokens = (canonicalFieldPath: string) =>
      buildLoopGroupReferenceGuidance({
        bodyGraph: body,
        rootGraph: root,
        prepared: contract,
        activeField: {
          surfaceScope: 'group-control',
          canonicalFieldPath,
          currentValue: 'ready',
        },
      })
        .filter(({ namespace }) => namespace === 'current')
        .map(({ token }) => token)

    expect(currentTokens('nodes[].loop_group.until_bash')).toEqual([
      '$prepare.output',
      '$child.output',
      '$consumer.output',
    ])
    expect(currentTokens('nodes[].loop_group.gate_message')).toEqual([])
  })

  it('copies exact bytes and inserts only into an unchanged compatible remembered control', async () => {
    const owner = new LoopGroupReferenceTargetOwner()
    const control = document.createElement('textarea')
    control.value = 'before after'
    document.body.append(control)
    control.setSelectionRange(7, 12)
    const identity: ReferenceTargetIdentity = {
      workflowId: 'workflow',
      pairGeneration: 1,
      definitionRevision: 2,
      companionRevision: 3,
      contractDigest: `sha256:${'a'.repeat(64)}`,
      profile: 'archon-2026-07',
      scopeKey: 'loop-group:repeat',
      bindingIdentity: 'binding',
      concretePath: ['nodes', 2, 'loop_group', 'nodes', 1, 'prompt'],
      canonicalFieldPath: 'nodes[].prompt',
      surfaceScope: 'body',
      originalText: 'before after',
      selectionStart: 7,
      selectionEnd: 12,
    }
    owner.remember(identity, control)
    const input = vi.fn()
    control.addEventListener('input', input)
    expect(owner.insert('$outer.output', 'outer', identity, await prepared())).toEqual({ ok: true })
    expect(control.value).toBe('before $outer.output')
    expect(input).toHaveBeenCalledOnce()
    expect(control).toHaveFocus()
    const write = vi.fn(async () => undefined)
    await expect(owner.copy('$LOOP_PREV.child.output', write)).resolves.toEqual({ ok: true })
    expect(write).toHaveBeenCalledWith('$LOOP_PREV.child.output')
  })

  it('accepts suggestions against the exact remembered group-control surface', async () => {
    const contract = await prepared()
    const owner = new LoopGroupReferenceTargetOwner()
    const control = document.createElement('textarea')
    control.value = 'ready'
    document.body.append(control)
    control.setSelectionRange(5, 5)
    const gate: ReferenceTargetIdentity = {
      workflowId: 'workflow',
      pairGeneration: 1,
      definitionRevision: 2,
      companionRevision: null,
      contractDigest: `sha256:${'a'.repeat(64)}`,
      profile: 'archon-2026-07',
      scopeKey: 'loop-group:repeat',
      bindingIdentity: 'group:repeat',
      concretePath: ['nodes', 2, 'loop_group', 'gate_message'],
      canonicalFieldPath: 'nodes[].loop_group.gate_message',
      surfaceScope: 'group-control',
      originalText: 'ready',
      selectionStart: 5,
      selectionEnd: 5,
    }
    owner.remember(gate, control)
    expect(owner.accepts('outer', gate, contract)).toBe(true)
    expect(owner.accepts('current', gate, contract)).toBe(false)
    expect(owner.accepts('previous', gate, contract)).toBe(false)

    const until = {
      ...gate,
      concretePath: ['nodes', 2, 'loop_group', 'until_bash'],
      canonicalFieldPath: 'nodes[].loop_group.until_bash',
    }
    owner.remember(until, control)
    expect(owner.accepts('current', until, contract)).toBe(true)
    expect(owner.accepts('outer', until, contract)).toBe(true)
    expect(owner.accepts('previous', until, contract)).toBe(true)
  })

  it.each([
    'workflow',
    'generation',
    'definition revision',
    'companion revision',
    'contract digest',
    'profile',
    'scope',
    'renamed binding',
    'concrete path',
    'canonical field',
    'text',
    'selection start',
    'selection end',
    'disconnected control',
  ] as const)('refuses a stale %s lease without mutation', async (change) => {
    const owner = new LoopGroupReferenceTargetOwner()
    const control = document.createElement('input')
    control.value = 'draft'
    document.body.append(control)
    control.setSelectionRange(5, 5)
    const base: ReferenceTargetIdentity = {
      workflowId: 'workflow',
      pairGeneration: 1,
      definitionRevision: 2,
      companionRevision: null,
      contractDigest: `sha256:${'a'.repeat(64)}`,
      profile: 'archon-2026-07',
      scopeKey: 'loop-group:repeat',
      bindingIdentity: 'binding',
      concretePath: ['nodes', 2, 'loop_group', 'nodes', 0, 'prompt'],
      canonicalFieldPath: 'nodes[].prompt',
      surfaceScope: 'body',
      originalText: 'draft',
      selectionStart: 5,
      selectionEnd: 5,
    }
    owner.remember(base, control)
    const current = {
      ...base,
      ...(change === 'workflow' ? { workflowId: 'other' } : {}),
      ...(change === 'generation' ? { pairGeneration: 2 } : {}),
      ...(change === 'definition revision' ? { definitionRevision: 3 } : {}),
      ...(change === 'companion revision' ? { companionRevision: 4 } : {}),
      ...(change === 'contract digest' ? { contractDigest: `sha256:${'b'.repeat(64)}` as const } : {}),
      ...(change === 'scope' ? { scopeKey: 'loop-group:other' as const } : {}),
      ...(change === 'profile' ? { profile: 'hermes-legacy' as const } : {}),
      ...(change === 'renamed binding' ? { bindingIdentity: 'renamed' } : {}),
      ...(change === 'concrete path' ? { concretePath: [...base.concretePath.slice(0, -2), 1, 'prompt'] } : {}),
      ...(change === 'canonical field' ? { canonicalFieldPath: 'nodes[].bash' } : {}),
      ...(change === 'selection start' ? { selectionStart: 4 } : {}),
      ...(change === 'selection end' ? { selectionEnd: 4 } : {}),
    }
    if (change === 'text') control.value = 'changed'
    if (change === 'disconnected control') control.remove()
    expect(owner.insert('$child.output', 'current', current, await prepared())).toMatchObject({ ok: false })
    expect(control.value).toBe(change === 'text' ? 'changed' : 'draft')
  })

  it('reports clipboard failure without changing the requested token', async () => {
    const owner = new LoopGroupReferenceTargetOwner()
    const write = vi.fn(async () => {
      throw new Error('denied')
    })
    await expect(owner.copy('$LOOP_PREV.child.output', write)).resolves.toEqual({
      ok: false,
      message: 'The reference could not be copied to the clipboard.',
    })
    expect(write).toHaveBeenCalledExactlyOnceWith('$LOOP_PREV.child.output')
  })
})
