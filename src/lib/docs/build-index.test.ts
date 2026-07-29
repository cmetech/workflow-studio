import { describe, expect, it, vi } from 'vitest'
import { buildDocumentationIndex, searchDocumentation } from './build-index'
import type { AuthoringContract } from '$src/lib/contract/types'
import { loadBundledAuthoringContracts } from '$src/lib/contract/bundled-contracts'
import { collectContractFields } from '$src/lib/forms/widget-registry'
import { analyzeWorkflowPair } from '$src/lib/validation/analyze-workflow'

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

describe('buildDocumentationIndex', () => {
  it('derives node and field topics from the active contract without native or network calls', () => {
    const fetchStub = vi.fn(() => Promise.reject(new Error('network must not be used')))
    vi.stubGlobal('fetch', fetchStub)

    const index = buildDocumentationIndex(contract, [{ id: 'guide', title: 'Workflow pairs', body: 'Use definition YAML.' }])
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
      { id: 'guide', title: 'Guide', body: 'The Prompt field is useful for maxBudgetUsd.' },
    ])

    expect(new Set(searchDocumentation(index, 'Prompt').map(({ id }) => id).slice(0, 2))).toEqual(
      new Set(['node:prompt', 'field:prompt.node.prompt']),
    )
    expect(searchDocumentation(index, 'maxBudgetUsd')[0]?.id).toBe('guide:guide')
  })

  it('covers every production form field from both bundled contracts without a second inventory', async () => {
    for (const activeContract of await loadBundledAuthoringContracts()) {
      const index = buildDocumentationIndex(activeContract)
      for (const field of collectContractFields(activeContract)) {
        expect(index.byId.get(`field:${field.id}`)).toEqual(
          expect.objectContaining({ fieldPaths: [field.fieldPath], examples: field.examples }),
        )
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
})
