import { describe, expect, it } from 'vitest'
import { loadBundledAuthoringContracts } from '$src/lib/contract/bundled-contracts'
import { analyzeWorkflowPair } from '$src/lib/validation/analyze-workflow'
import { createBrowserBridge } from '$src/lib/native/browser-bridge'
import type { DocumentAnalysis } from '$src/lib/documents/types'
import type { WorkflowProjection } from '$src/lib/projection/types'
import { createExampleCopy, loadExampleCatalog } from './load-examples'
import { validateExampleIntents } from './validate-example-intents'

describe('bundled workflow examples', () => {
  it('loads unique, contained immutable resources that pass their claimed production contract', async () => {
    const [examples, contracts] = await Promise.all([loadExampleCatalog(), loadBundledAuthoringContracts()])
    const ids = examples.map(({ id }) => id)
    const paths = examples.flatMap((example) => [
      example.definitionPath,
      ...(example.companionPath ? [example.companionPath] : []),
    ])

    expect(ids).toHaveLength(13)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(paths).size).toBe(paths.length)
    expect(paths.every((path) => path.startsWith('examples/') && !path.includes('..') && !path.startsWith('/'))).toBe(
      true,
    )
    expect(examples.every((example) => example.readOnly)).toBe(true)
    expect(examples.every((example) => example.profiles.length === 1 && example.profiles[0] === example.profile)).toBe(
      true,
    )

    for (const example of examples) {
      const contract = contracts.find(({ profile }) => profile === example.profile)
      expect(contract, `${example.id} contract`).toBeDefined()
      expect(example.documentationTopicIds.length, `${example.id} documentation topics`).toBeGreaterThan(0)
      expect(example.highlightedNodeIds.length, `${example.id} highlighted nodes`).toBeGreaterThan(0)
      const analysis = await analyzeWorkflowPair(
        {
          type: 'analyze',
          requestId: `example:${example.id}`,
          workflowId: `example:${example.id}`,
          pairGeneration: 0,
          definition: { path: example.definitionPath, text: example.definitionText, revision: 0 },
          companion: example.companionText
            ? { path: example.companionPath!, text: example.companionText, revision: 0 }
            : null,
          profile: example.profile,
          contractDigest: contract!.contract_digest,
          reason: 'explicit-validate',
        },
        contract!,
      )
      expect(
        analysis.structurallyValid,
        `${example.id}: ${analysis.issues.map(({ message }) => message).join('; ')}`,
      ).toBe(true)
      const projection = analysis.projection as WorkflowProjection | undefined
      const projectedIds = new Set(
        projection?.graphs.flatMap((graph) => graph.nodes.map((node) => `${graph.editorNodePrefix}${node.id}`)) ?? [],
      )
      expect(example.highlightedNodeIds.every((id) => projectedIds.has(id))).toBe(true)
      expect(
        example.highlightedFieldIds.every((id) =>
          contract!.node_kinds.some((kind) => kind.fields.some((field) => field.id === id)),
        ),
      ).toBe(true)
      expect(
        example.documentationTopicIds.every((id) => contract!.documentation.topics.some((topic) => topic.id === id)),
      ).toBe(true)
    }
  })

  it('enforces every exact example graph intent against analyzed projections', async () => {
    const [examples, contracts] = await Promise.all([loadExampleCatalog(), loadBundledAuthoringContracts()])
    const projections = new Map<string, WorkflowProjection>()
    for (const example of examples) {
      const contract = contracts.find(({ profile }) => profile === example.profile)!
      const analysis = await analyzeWorkflowPair(
        {
          type: 'analyze',
          requestId: `intent:${example.id}`,
          workflowId: `intent:${example.id}`,
          pairGeneration: 0,
          definition: { path: example.definitionPath, text: example.definitionText, revision: 0 },
          companion: example.companionText
            ? { path: example.companionPath!, text: example.companionText, revision: 0 }
            : null,
          profile: example.profile,
          contractDigest: contract.contract_digest,
          reason: 'explicit-validate',
        },
        contract,
      )
      projections.set(example.id, analysis.projection as WorkflowProjection)
    }

    expect(validateExampleIntents(projections)).toEqual([])

    const approval = projections.get('approval')!
    const syntheticApprovalOutcome = new Map(projections)
    syntheticApprovalOutcome.set('approval', {
      ...approval,
      graphs: approval.graphs.map((graph, index) =>
        index === 0
          ? {
              ...graph,
              nodes: graph.nodes.map((node) =>
                node.id === 'continue'
                  ? { ...node, options: { ...node.options, when: '$approve.output.accepted == 1' } }
                  : node,
              ),
            }
          : graph,
      ),
    })
    expect(validateExampleIntents(syntheticApprovalOutcome)).toContain(
      'approval: continuation must rely on the approval dependency gate.',
    )

    const currentOutput = projections.get('loop-group-current-output')!
    const wrongCurrentDependency = new Map(projections)
    wrongCurrentDependency.set('loop-group-current-output', {
      ...currentOutput,
      graphs: currentOutput.graphs.map((graph) =>
        graph.scope.key === 'loop-group:refine'
          ? {
              ...graph,
              nodes: graph.nodes.map((node) => (node.id === 'review' ? { ...node, dependsOn: [] } : node)),
            }
          : graph,
      ),
    })
    expect(validateExampleIntents(wrongCurrentDependency)).toContain(
      'loop-group-current-output: review dependencies are incorrect.',
    )

    const iterationContext = projections.get('loop-group-iteration-context')!
    const wrongIterationContext = new Map(projections)
    wrongIterationContext.set('loop-group-iteration-context', {
      ...iterationContext,
      graphs: iterationContext.graphs.map((graph) =>
        graph.scope.key === 'loop-group:refine'
          ? {
              ...graph,
              outerInputs: [],
              nodes: graph.nodes.map((node) =>
                node.id === 'revise' ? { ...node, value: 'Combine $seed.output' } : node,
              ),
            }
          : graph,
      ),
    })
    expect(validateExampleIntents(wrongIterationContext)).toEqual(
      expect.arrayContaining([
        'loop-group-iteration-context: outer inputs are incorrect.',
        'loop-group-iteration-context: revise references are incorrect.',
      ]),
    )

    const primarySink = projections.get('loop-group-primary-sink')!
    const wrongPrimarySink = new Map(projections)
    wrongPrimarySink.set('loop-group-primary-sink', {
      ...primarySink,
      graphs: primarySink.graphs.map((graph) =>
        graph.scope.key === 'loop-group:summarize' ? { ...graph, primarySinkId: 'archive' } : graph,
      ),
    })
    expect(validateExampleIntents(wrongPrimarySink)).toContain(
      'loop-group-primary-sink: publish must be the first terminal primary sink.',
    )
    const wrongCompanion = new Map(projections)
    wrongCompanion.set('loop-group-primary-sink', { ...primarySink, companion: { outward_action_nodes: ['publish'] } })
    expect(validateExampleIntents(wrongCompanion)).toContain(
      'loop-group-primary-sink: scoped companion policy is incorrect.',
    )
  })

  it('creates collision-safe exact YAML copies without mutating the bundled source', async () => {
    const example = (await loadExampleCatalog()).find(({ id }) => id === 'sequential')
    expect(example).toBeDefined()
    const contract = (await loadBundledAuthoringContracts()).find(({ profile }) => profile === example!.profile)!
    const native = createBrowserBridge()
    await native.workspaceSetRoot('/examples-test')
    await native.workspaceWrite({ relativePath: 'workflow.yaml', text: 'occupied\n', expectedCurrentHash: null })
    let opened: DocumentAnalysis | undefined

    const copied = await createExampleCopy(example!, {
      native,
      workspaceId: 'browser-workspace',
      contract,
      analyze: async ({ definitionText, companionText, contract: activeContract }) =>
        analyzeWorkflowPair(
          {
            type: 'analyze',
            requestId: 'copy',
            workflowId: 'copy',
            pairGeneration: 0,
            definition: { path: 'workflow.yaml', text: definitionText, revision: 0 },
            companion:
              companionText === null ? null : { path: 'workflow.hermes.yaml', text: companionText, revision: 0 },
            profile: activeContract.profile,
            contractDigest: activeContract.contract_digest,
            reason: 'explicit-validate',
          },
          activeContract,
        ),
      open: async (entry) => {
        const definition = await native.workspaceRead(entry.definitionPath)
        const companion = entry.companionPath ? await native.workspaceRead(entry.companionPath) : null
        opened = await analyzeWorkflowPair(
          {
            type: 'analyze',
            requestId: 'opened-copy',
            workflowId: entry.id,
            pairGeneration: 0,
            definition: { path: entry.definitionPath, text: definition.text, revision: 0 },
            companion: companion === null ? null : { path: entry.companionPath!, text: companion.text, revision: 0 },
            profile: contract.profile,
            contractDigest: contract.contract_digest,
            reason: 'explicit-validate',
          },
          contract,
        )
      },
    })

    expect(copied.definitionPath).toBe('workflow-2.yaml')
    expect(copied.companionPath).toBe('workflow-2.hermes.yaml')
    expect(await native.workspaceRead('workflow-2.yaml')).toMatchObject({ text: example!.definitionText })
    expect(await native.workspaceRead('workflow-2.hermes.yaml')).toMatchObject({ text: example!.companionText })
    expect(await native.workspaceRead('workflow.yaml')).toMatchObject({ text: 'occupied\n' })
    expect(opened).toMatchObject({
      workflowId: 'workflow:browser-workspace:workflow-2.yaml',
      definitionPath: 'workflow-2.yaml',
      companionPath: 'workflow-2.hermes.yaml',
      structurallyValid: true,
    })
  })

  it('moves a newly written definition to Trash when its companion cannot be created', async () => {
    const example = (await loadExampleCatalog()).find(({ id }) => id === 'sequential')!
    const contract = (await loadBundledAuthoringContracts()).find(({ profile }) => profile === example.profile)!
    const native = createBrowserBridge()
    await native.workspaceSetRoot('/examples-test')
    let opened = false

    await expect(
      createExampleCopy(example, {
        native: {
          workspaceScan: native.workspaceScan,
          workspaceWrite: async (request) => {
            if (request.relativePath.endsWith('.hermes.yaml')) throw new Error('companion write failed')
            return native.workspaceWrite(request)
          },
          workspaceTrashPaths: native.workspaceTrashPaths,
        },
        workspaceId: 'browser-workspace',
        contract,
        analyze: async () => ({ structurallyValid: true }) as DocumentAnalysis,
        open: async () => {
          opened = true
        },
      }),
    ).rejects.toThrow('companion write failed')

    await expect(native.workspaceRead('workflow.yaml')).rejects.toMatchObject({ code: 'path_not_found' })
    expect(opened).toBe(false)
  })
})
