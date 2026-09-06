import { loadBundledAuthoringContracts } from '$src/lib/contract/bundled-contracts'
import { analyzeWorkflowPair } from '$src/lib/validation/analyze-workflow'
import type { WorkflowProjection } from '$src/lib/projection/types'
import { describe, expect, it, vi } from 'vitest'
import type { NodeKindDescriptor } from '$src/lib/contract/types'
import { createDocumentRevision } from '$src/lib/documents/revisions'
import type { CanvasActionContext } from './canvas-actions'
import { createCanvasAuthoringCoordinator } from './canvas-authoring-coordinator'

describe('canvas authoring coordinator', () => {
  it('returns a typed unavailable result without invoking an action when authoring is blocked', async () => {
    const coordinator = createCanvasAuthoringCoordinator({ getContext: () => ({ unavailable: 'Analysis is stale.' }) })

    await expect(coordinator.connect('a', 'b')).resolves.toEqual({
      status: 'rejected',
      code: 'canvas_action_unavailable',
      message: 'Analysis is stale.',
    })
  })

  it('owns the clipboard and routes one accepted context through copy and paste', async () => {
    const pair = {
      workflowId: 'clipboard',
      generation: 1,
      savedGeneration: 1,
      definition: {
        id: 'definition',
        kind: 'definition' as const,
        path: 'clipboard.yaml',
        text: 'nodes: []',
        revision: 1,
        savedRevision: 1,
        diskHash: null,
      },
      companion: null,
    }
    const revision = createDocumentRevision(pair, 'sha256:clipboard')
    const graph = { scope: { key: 'root' }, nodes: [] }
    const context = {
      pair,
      revision,
      graph,
      scopeKey: 'root',
      getCurrentSnapshot: () => ({ pair, revision, scopeKey: 'root' }),
      projection: { graphs: [graph] },
      contract: { semantic_rules: [] },
      positions: {},
      announce: vi.fn(),
    } as unknown as CanvasActionContext
    const coordinator = createCanvasAuthoringCoordinator({ getContext: () => context })

    expect(coordinator.copy(['missing'])).toMatchObject({ status: 'rejected', code: 'selection_empty' })
    await expect(coordinator.paste()).resolves.toMatchObject({ status: 'rejected', code: 'selection_empty' })
  })

  it('rejects add before action dispatch when the chosen descriptor is no longer available', async () => {
    const coordinator = createCanvasAuthoringCoordinator({
      getContext: () => ({ unavailable: 'Contract unavailable.' }),
    })

    await expect(
      coordinator.add({ id: 'command' } as NodeKindDescriptor, { viewportCenter: { x: 0, y: 0 } }),
    ).resolves.toMatchObject({ status: 'rejected', code: 'canvas_action_unavailable' })
  })
})

it('uses the current repair context only for preview and deletion, retaining scope leases', async () => {
  const contract = (await loadBundledAuthoringContracts()).find(({ profile }) => profile === 'archon-2026-07')!
  const definition = {
    id: 'definition',
    kind: 'definition' as const,
    path: 'repair.yaml',
    text: 'name: Repair\ndescription: Repair\nnodes:\n  - id: draft\n    prompt: ""\n',
    revision: 1,
    savedRevision: 1,
    diskHash: null,
  }
  const pair = {
    workflowId: 'repair',
    generation: 1,
    savedGeneration: 1,
    definition,
    companion: {
      ...definition,
      id: 'companion',
      kind: 'companion' as const,
      path: 'repair.hermes.yaml',
      text: 'language_compatibility: archon-2026-07\n',
    },
  }
  const analysis = await analyzeWorkflowPair(
    {
      type: 'analyze',
      requestId: 'repair',
      workflowId: pair.workflowId,
      pairGeneration: 1,
      definition,
      companion: pair.companion,
      profile: contract.profile,
      contractDigest: contract.contract_digest,
      reason: 'open',
    },
    contract,
  )
  const projection = analysis.projection as WorkflowProjection
  const revision = createDocumentRevision(pair, contract.contract_digest)
  let scopeKey: 'root' | 'loop-group:changed' = 'root'
  const context: CanvasActionContext = {
    pair,
    revision,
    projection,
    graph: projection.graphs[0]!,
    scopeKey: 'root',
    currentAnalysis: analysis,
    referenceIndex: analysis.referenceIndex,
    contract,
    positions: {},
    getCurrentSnapshot: () => ({ pair, revision, scopeKey }),
    commit: vi.fn(),
    commitPositions: vi.fn(),
    announce: vi.fn(),
  }
  const coordinator = createCanvasAuthoringCoordinator({
    getContext: () => ({ unavailable: 'Repair only.' }),
    getDeleteContext: () => context,
  })
  const preview = coordinator.previewDelete(['draft'])
  expect(preview.status).toBe('ready')
  if (preview.status !== 'ready') return
  expect(await coordinator.connect('draft', 'other')).toMatchObject({
    status: 'rejected',
    code: 'canvas_action_unavailable',
  })
  expect(await coordinator.disconnect('draft', 'other')).toMatchObject({
    status: 'rejected',
    code: 'canvas_action_unavailable',
  })
  expect(await coordinator.add(contract.node_kinds[0]!, { viewportCenter: { x: 0, y: 0 } })).toMatchObject({
    status: 'rejected',
    code: 'canvas_action_unavailable',
  })
  expect(await coordinator.duplicate(['draft'])).toMatchObject({
    status: 'rejected',
    code: 'canvas_action_unavailable',
  })
  expect(await coordinator.paste()).toMatchObject({ status: 'rejected', code: 'canvas_action_unavailable' })
  expect(await coordinator.delete(preview.impact)).toMatchObject({ status: 'committed' })
  expect(context.commit).toHaveBeenCalledOnce()
  scopeKey = 'loop-group:changed'
  expect(await coordinator.delete(preview.impact)).toMatchObject({ status: 'rejected', code: 'stale_document' })
  expect(context.commit).toHaveBeenCalledOnce()
})

it('does not permit paste, duplicate, copy, or edge mutation from a blank root context', async () => {
  const pair = {
    workflowId: 'blank',
    generation: 1,
    savedGeneration: 1,
    definition: {
      id: 'definition',
      kind: 'definition' as const,
      path: 'blank.yaml',
      text: 'name: Blank\ndescription: Blank\nnodes: []\n',
      revision: 1,
      savedRevision: 1,
      diskHash: null,
    },
    companion: null,
  }
  const revision = createDocumentRevision(pair, 'sha256:blank')
  const graph = { scope: { key: 'root' }, nodes: [] }
  const context = {
    pair,
    revision,
    currentAnalysis: { structurallyValid: false, visuallyAuthorable: true },
    scopeKey: 'root',
    graph,
    projection: { graphs: [graph] },
    contract: { semantic_rules: [] },
    getCurrentSnapshot: () => ({ pair, revision, scopeKey: 'root' }),
    announce: vi.fn(),
  } as unknown as CanvasActionContext
  const coordinator = createCanvasAuthoringCoordinator({ getContext: () => context })
  expect(await coordinator.paste()).toMatchObject({ status: 'rejected', code: 'canvas_action_unavailable' })
  expect(await coordinator.duplicate([])).toMatchObject({ status: 'rejected', code: 'canvas_action_unavailable' })
  expect(coordinator.copy([])).toMatchObject({ status: 'rejected', code: 'canvas_action_unavailable' })
  expect(await coordinator.connect('a', 'b')).toMatchObject({ status: 'rejected', code: 'canvas_action_unavailable' })
  expect(await coordinator.disconnect('a', 'b')).toMatchObject({
    status: 'rejected',
    code: 'canvas_action_unavailable',
  })
})
