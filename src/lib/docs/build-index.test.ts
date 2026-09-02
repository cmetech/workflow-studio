import { describe, expect, it, vi } from 'vitest'
import { buildDocumentationIndex, searchDocumentation } from './build-index'
import type { AuthoringContract } from '$src/lib/contract/types'
import { loadBundledAuthoringContracts } from '$src/lib/contract/bundled-contracts'
import { collectContractFields } from '$src/lib/forms/widget-registry'
import { analyzeWorkflowPair } from '$src/lib/validation/analyze-workflow'
import { createDocumentationGuides } from './guide-sources'

const guideSources = import.meta.glob('../../../docs/app-guides/*.md', { eager: true, import: 'default', query: '?raw' }) as Readonly<Record<string, string>>

const contract = {
  profile: 'archon-2026-07',
  definition_schema: {
    type: 'object',
    properties: {
      nodes: {
        type: 'array',
        items: {
          type: 'object',
          properties: { id: { type: 'string' }, prompt: { type: 'string', default: 'Review the change.' } },
          required: ['id', 'prompt'],
        },
      },
    },
  },
  sidecar_schema: { type: 'object' },
  node_kinds: [
    {
      id: 'prompt', label: 'Prompt', description: 'Ask an authoring prompt.', field_path: 'nodes[].prompt',
      applicability: { profiles: ['archon-2026-07'], documents: ['definition'], node_kinds: ['prompt'] },
      widget: 'code', section: 'General', order: 1, status: 'supported', examples: [{ id: 'review', prompt: 'Review.' }],
      fields: [
        {
          id: 'prompt.node.prompt', label: 'Prompt', description: 'Prompt text.', field_path: 'nodes[].prompt',
          applicability: { profiles: ['archon-2026-07'], documents: ['definition'], node_kinds: ['prompt'] },
          widget: 'code', section: 'General', order: 2, status: 'supported', examples: ['Review.'],
        },
      ],
    },
  ],
  semantic_rules: [],
  compatibility_codes: {
    prompt_migration: { status: 'deprecated', description: 'Prompt behavior changed.', migration: 'Use a reviewed prompt.', fields: ['nodes[].prompt'] },
  },
  documentation: { topics: [], examples: [] },
} as unknown as AuthoringContract

const repeatedContextContract = {
  ...contract,
  definition_schema: {
    type: 'object',
    properties: {
      nodes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            context: { type: 'string' },
          },
        },
      },
    },
  },
  node_kinds: ['bash', 'prompt'].map((id) => ({
    id,
    label: id === 'bash' ? 'Bash' : 'Prompt',
    description: `${id} node.`,
    field_path: `nodes[].${id}`,
    applicability: { profiles: ['archon-2026-07'], documents: ['definition'], node_kinds: [id] },
    widget: 'code',
    section: 'General',
    order: 1,
    status: 'supported',
    examples: [],
    fields: [
      {
        id: `${id}.node.context`,
        label: 'Context',
        description: `${id} context.`,
        field_path: 'nodes[].context',
        applicability: { profiles: ['archon-2026-07'], documents: ['definition'], node_kinds: [id] },
        widget: 'text',
        section: 'General',
        order: 2,
        status: 'supported',
        examples: ['fresh'],
      },
    ],
  })),
} as unknown as AuthoringContract

const contextCollisionContract = {
  ...repeatedContextContract,
  documentation: {
    topics: [
      {
        id: 'context-policy',
        title: 'Context',
        description: 'Language-level context policy.',
        body: 'Contract context policy.',
        field_paths: ['nodes[].context'],
        applicability: { profiles: ['archon-2026-07'], documents: ['definition'] },
        examples: [],
      },
    ],
    examples: [],
  },
} as unknown as AuthoringContract

function bundledGuideFixtures() {
  return createDocumentationGuides(guideSources)
}

describe('buildDocumentationIndex', () => {
  it('derives node and field topics from the active contract without native or network calls', () => {
    const fetchStub = vi.fn(() => Promise.reject(new Error('network must not be used')))
    vi.stubGlobal('fetch', fetchStub)

    const index = buildDocumentationIndex(contract, [{
      id: 'guide', title: 'Workflow pairs', body: 'Use definition YAML.', description: 'Understand workflow pairs.',
      group: 'getting-started', order: 1, useWhen: 'Use this when editing workflow pairs.',
    }])
    const field = index.byId.get('field:prompt.node.prompt')

    expect(index.byId.get('node:prompt')).toMatchObject({ title: 'Prompt', kind: 'node' })
    expect(field).toMatchObject({ kind: 'field', required: true, defaultValue: 'Review the change.', status: 'supported' })
    expect(field?.body).toContain('Type: `string`')
    expect(field?.body).toContain('Required: yes')
    expect(field?.body).toContain('Profile: `archon-2026-07`')
    expect(field?.body).toContain('Use a reviewed prompt.')
    expect(field?.examples).toEqual(['Review.'])
    expect(index.byId.get('guide:guide')).toMatchObject({ kind: 'guide', title: 'Workflow pairs' })
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it('ranks exact labels and identifiers before body-only matches while preserving code identifiers', () => {
    const index = buildDocumentationIndex(contract, [
      { id: 'guide', title: 'Guide', body: 'The Prompt field is useful for maxBudgetUsd.', description: 'Review a guide.',
        group: 'getting-started', order: 1, useWhen: 'Use this when reviewing a guide.' },
    ])

    expect(new Set(searchDocumentation(index, 'Prompt', { mode: 'all' }).map(({ id }) => id).slice(0, 2))).toEqual(
      new Set(['node:prompt', 'field:prompt.node.prompt']),
    )
    expect(searchDocumentation(index, 'maxBudgetUsd', { mode: 'all' })[0]?.id).toBe('guide:guide')
  })

  it('gives punctuation-bearing exact topic IDs the exact-ID ranking bonus', () => {
    const index = buildDocumentationIndex(contract, [
      {
        id: 'punctuation-bearing',
        title: 'Zebra topic',
        body: 'Exact identifier target.',
        description: 'Exact identifier target.',
        group: 'getting-started',
        order: 1,
        useWhen: 'Use this exact identifier target.',
      },
      {
        id: 'competitor',
        title: 'Guide punctuation bearing',
        body: 'A title collision.',
        description: 'A title collision.',
        group: 'getting-started',
        order: 2,
        useWhen: 'Use this title collision.',
      },
    ])

    expect(searchDocumentation(index, 'guide:punctuation-bearing', { mode: 'all' })[0]?.id).toBe(
      'guide:punctuation-bearing',
    )
  })

  it('orders real bundled guide journeys by explicit presentation metadata', () => {
    const index = buildDocumentationIndex(contract, bundledGuideFixtures())

    expect([...index.guideGroups].map(([group, topics]) => [group, topics.map(({ id }) => id)])).toEqual([
      ['getting-started', ['guide:quick-start', 'guide:workflow-pairs']],
      [
        'build-graph',
        ['guide:dag-dependencies', 'guide:conditions-and-outputs', 'guide:loops-and-approvals'],
      ],
      [
        'configure-behavior',
        ['guide:retry-and-triggers', 'guide:companion-policies', 'guide:profiles-and-compatibility'],
      ],
      [
        'review-recover',
        ['guide:problems-and-validation', 'guide:git-versions', 'guide:troubleshooting'],
      ],
      ['use-application', ['guide:keyboard-shortcuts']],
    ])
  })

  it('prepends exact reverse guide relationships on real field indexes for both profiles', async () => {
    const guides = bundledGuideFixtures()
    for (const activeContract of await loadBundledAuthoringContracts()) {
      const index = buildDocumentationIndex(activeContract, guides)

      expect(index.byId.get('field:prompt.node.depends_on')?.relatedTopicIds?.[0]).toBe(
        'guide:dag-dependencies',
      )
      expect(index.byId.get('field:prompt.node.when')?.relatedTopicIds?.[0]).toBe(
        'guide:conditions-and-outputs',
      )
      expect(index.byId.get('field:prompt.node.retry')?.relatedTopicIds?.[0]).toBe('guide:retry-and-triggers')
    }
  })

  it('keeps repeated contract fields exact while grouping their reference navigation', () => {
    const index = buildDocumentationIndex(repeatedContextContract)
    const contextTopics = index.duplicateTitleGroups.get('context')!

    expect(contextTopics.map(({ id, qualifier }) => ({ id, qualifier }))).toEqual([
      { id: 'field:bash.node.context', qualifier: 'Bash node' },
      { id: 'field:prompt.node.context', qualifier: 'Prompt node' },
    ])
    expect(index.referenceGroups.get('common-node-settings')).toEqual(
      expect.arrayContaining([expect.objectContaining({ title: 'Context' })]),
    )
    expect(searchDocumentation(index, 'context prompt', { mode: 'reference' })[0]).toMatchObject({
      id: 'field:prompt.node.context',
      qualifier: 'Prompt node',
    })
  })

  it('keeps matching language-contract topics out of repeated field groups', () => {
    const index = buildDocumentationIndex(contextCollisionContract)

    expect(index.byId.get('contract:context-policy')).toMatchObject({
      kind: 'contract',
      referenceGroup: 'language-contract',
      breadcrumb: ['Reference', 'Language contract'],
    })
  })

  it('keeps all-mode search unrestricted when a reference filter is present', () => {
    const index = buildDocumentationIndex(contract)

    expect(searchDocumentation(index, 'Prompt', { mode: 'all', referenceGroup: 'workflow-fields' }).map(({ id }) => id)).toEqual(
      expect.arrayContaining(['node:prompt', 'field:prompt.node.prompt']),
    )
  })

  it('covers every production form field from both bundled contracts without a second inventory', async () => {
    for (const activeContract of await loadBundledAuthoringContracts()) {
      const index = buildDocumentationIndex(activeContract)
      for (const field of collectContractFields(activeContract)) {
        expect(index.byId.get(`field:${field.id}`)).toEqual(
          expect.objectContaining({ fieldPaths: [field.fieldPath], examples: field.examples }),
        )
        const occurrences = [...index.referenceGroups.values()].flat().filter(({ id }) => id === `field:${field.id}`)
        expect(occurrences).toHaveLength(1)
      }
    }
  })

  it('derives complete node topics from each bundled contract descriptor and schema', async () => {
    for (const activeContract of await loadBundledAuthoringContracts()) {
      const index = buildDocumentationIndex(activeContract)
      for (const node of activeContract.node_kinds) {
        const topic = index.byId.get(`node:${node.id}`)
        expect(topic).toEqual(expect.objectContaining({ kind: 'node', status: node.status, examples: node.examples }))
        expect(topic?.body).toContain('Purpose:')
        expect(topic?.body).toContain('Type:')
        expect(topic?.body).toContain('Required:')
        expect(topic?.body).toContain('Default:')
        expect(topic?.body).toContain(`Profile: \`${activeContract.profile}\``)
      }
    }
  })

  it('validates every bundled definition guide fence through the production contract and DAG analyzer', async () => {
    const contract = (await loadBundledAuthoringContracts()).find(({ profile }) => profile === 'archon-2026-07')!
    for (const [path, guide] of Object.entries(guideSources)) {
      for (const [, definition] of guide.matchAll(/```yaml\n([\s\S]*?)```/g)) {
        if (!definition?.includes('nodes:')) continue
        const analysis = await analyzeWorkflowPair(
          {
            type: 'analyze', requestId: path, workflowId: path, pairGeneration: 0, profile: contract.profile,
            reason: 'explicit-validate', contractDigest: contract.contract_digest,
            definition: { path: `${path}.yaml`, text: definition, revision: 0 },
            companion: { path: `${path}.hermes.yaml`, text: 'language_compatibility: archon-2026-07\n', revision: 0 },
          },
          contract,
        )
        expect(analysis.structurallyValid, path).toBe(true)
      }
    }
  })

  it('validates the Quick Start definition fence as structurally valid under Archon', async () => {
    const contract = (await loadBundledAuthoringContracts()).find(({ profile }) => profile === 'archon-2026-07')!
    const quickStartPath = Object.keys(guideSources).find((path) => path.endsWith('/quick-start.md'))
    expect(quickStartPath).toBeDefined()
    const quickStart = quickStartPath ? guideSources[quickStartPath] : undefined
    if (!quickStart) throw new Error('Quick Start guide resource is missing')
    const fence = [...quickStart.matchAll(/```yaml\n([\s\S]*?)```/g)].find((match) => match[1]?.includes('nodes:'))
    const definition = fence?.[1]
    expect(definition).toBeDefined()
    if (!definition) throw new Error('Quick Start definition fence is missing')

    const analysis = await analyzeWorkflowPair(
      {
        type: 'analyze', requestId: 'quick-start', workflowId: 'quick-start', pairGeneration: 0, profile: contract.profile,
        reason: 'explicit-validate', contractDigest: contract.contract_digest,
        definition: { path: 'quick-start.yaml', text: definition!, revision: 0 },
        companion: { path: 'quick-start.hermes.yaml', text: 'language_compatibility: archon-2026-07\n', revision: 0 },
      },
      contract,
    )

    expect(analysis.structurallyValid).toBe(true)
  })
})
