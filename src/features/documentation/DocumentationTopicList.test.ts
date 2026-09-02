import { fireEvent, render, screen, within } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import DocumentationTopicList from './DocumentationTopicList.svelte'
import { loadBundledAuthoringContracts } from '$src/lib/contract/bundled-contracts'
import { buildDocumentationIndex } from '$src/lib/docs/build-index'
import type { DocumentationIndex, DocumentationTopic } from '$src/lib/docs/types'

const nodeKinds = ['command', 'prompt', 'bash', 'script', 'loop', 'approval', 'cancel'] as const

const contextTopics: DocumentationTopic[] = nodeKinds.map((kind) => ({
  id: `field:${kind}.node.context`,
  kind: 'field',
  title: 'Context',
  description: `${kind} context behavior.`,
  body: `${kind} body`,
  qualifier: `${kind[0]!.toUpperCase()}${kind.slice(1)} node`,
  useWhen: 'Use this when node context must be configured.',
  breadcrumb: ['Reference', 'Common node settings'],
  renderer: 'markdown',
  examples: [],
  status: 'supported',
  profile: 'archon-2026-07',
  fieldPaths: ['nodes[].context'],
  nodeKinds: [kind],
  referenceGroup: 'common-node-settings',
}))

const guide: DocumentationTopic = {
  id: 'guide:dag-dependencies',
  kind: 'guide',
  title: 'DAG dependencies',
  description: 'Connect workflow steps.',
  body: 'Guide body',
  qualifier: 'Guide',
  useWhen: 'Use this when you are connecting steps or resolving dependency order.',
  breadcrumb: ['Guides', 'Build the graph'],
  renderer: 'markdown',
  examples: [],
  status: 'supported',
  profile: 'archon-2026-07',
  fieldPaths: [],
  guideGroup: 'build-graph',
}

const index: DocumentationIndex = {
  topics: [...contextTopics, guide],
  byId: new Map([...contextTopics, guide].map((topic) => [topic.id, topic])),
  searchText: new Map(
    [...contextTopics, guide].map((topic) => [
      topic.id,
      `${topic.title} ${topic.qualifier} ${topic.kind} ${topic.description} ${topic.nodeKinds?.join(' ') ?? ''}`.toLowerCase(),
    ]),
  ),
  tokenIndex: (() => {
    const tokens = new Map<string, Set<string>>()
    for (const topic of [...contextTopics, guide]) {
      const text =
        `${topic.title} ${topic.qualifier} ${topic.kind} ${topic.description} ${topic.nodeKinds?.join(' ') ?? ''}`.toLowerCase()
      for (const token of text.split(/[^a-z0-9]+/).filter(Boolean)) {
        const ids = tokens.get(token) ?? new Set<string>()
        ids.add(topic.id)
        tokens.set(token, ids)
      }
    }
    return tokens
  })(),
  guideGroups: new Map([['build-graph', [guide]]]),
  referenceGroups: new Map([['common-node-settings', contextTopics]]),
  duplicateTitleGroups: new Map([['context', contextTopics]]),
}

const defaultProps = {
  index,
  query: '',
  expandedGroupIds: [] as readonly string[],
  onSelect: vi.fn(),
  onHighlight: vi.fn(),
  onToggleGroup: vi.fn(),
}

describe('DocumentationTopicList', () => {
  it('groups duplicate reference titles while retaining every exact topic as a qualified child', async () => {
    const onToggleGroup = vi.fn()
    const { rerender } = render(DocumentationTopicList, {
      ...defaultProps,
      mode: 'reference',
      onToggleGroup,
    })

    const referenceGroup = screen.getByRole('button', { name: 'Common node settings, reference group' })
    expect(referenceGroup).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'Context, used by 7 node types' })).not.toBeInTheDocument()

    await fireEvent.click(referenceGroup)
    expect(onToggleGroup).toHaveBeenCalledWith('reference:common-node-settings')
    await rerender({
      ...defaultProps,
      mode: 'reference',
      expandedGroupIds: ['reference:common-node-settings'],
      onToggleGroup,
    })

    const disclosure = screen.getByRole('button', { name: 'Context, used by 7 node types' })
    expect(disclosure).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'Context, Prompt node' })).not.toBeInTheDocument()

    await fireEvent.click(disclosure)
    expect(onToggleGroup).toHaveBeenCalledWith('duplicate:context')
    await rerender({
      ...defaultProps,
      mode: 'reference',
      expandedGroupIds: ['reference:common-node-settings', 'duplicate:context'],
      onToggleGroup,
    })

    expect(screen.getByRole('button', { name: 'Context, Prompt node' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Context, Bash node' })).toBeVisible()
    expect(screen.getAllByRole('button', { name: /^Context, .* node$/ })).toHaveLength(7)
  })

  it('renders guide journey headings and scenario copy without a search query', () => {
    render(DocumentationTopicList, { ...defaultProps, mode: 'guides' })

    const group = screen.getByRole('region', { name: 'Build the graph' })
    expect(within(group).getByRole('button', { name: 'DAG dependencies, Guide' })).toBeVisible()
    expect(within(group).getByText(/Use this when you are connecting steps/i)).toBeVisible()
  })

  it('qualifies repeated search results with kind, description, and applicable nodes', () => {
    render(DocumentationTopicList, { ...defaultProps, mode: 'reference', query: 'context prompt' })

    const result = screen.getByRole('button', { name: 'Context, Prompt node' })
    expect(result).toBeVisible()
    expect(result).toHaveTextContent('field')
    expect(result).toHaveTextContent('prompt context behavior')
    expect(result).toHaveTextContent('prompt')
    expect(screen.queryByRole('button', { name: 'Context, Bash node' })).not.toBeInTheDocument()
  })

  it('marks only a highlighted rendered search result as current', async () => {
    const { rerender } = render(DocumentationTopicList, {
      ...defaultProps,
      mode: 'reference',
      query: 'context prompt',
      highlightedTopicId: 'field:prompt.node.context',
    })

    expect(screen.getByRole('button', { name: 'Context, Prompt node' })).toHaveAttribute('aria-current', 'true')

    await rerender({
      ...defaultProps,
      mode: 'reference',
      query: 'context prompt',
      highlightedTopicId: 'field:bash.node.context',
    })
    expect(screen.getByRole('button', { name: 'Context, Prompt node' })).not.toHaveAttribute('aria-current')
  })

  it('adds YAML locations when real bundled topics collide on title and node qualifier', async () => {
    const contract = (await loadBundledAuthoringContracts()).find(({ profile }) => profile === 'archon-2026-07')!
    const productionIndex = buildDocumentationIndex(contract)
    render(DocumentationTopicList, {
      index: productionIndex,
      mode: 'reference',
      query: '',
      expandedGroupIds: [
        'reference:common-node-settings',
        'reference:node-specific-fields',
        'duplicate:model',
        'duplicate:max attempts',
      ],
      onSelect: vi.fn(),
      onHighlight: vi.fn(),
      onToggleGroup: vi.fn(),
    })

    expect(screen.getByRole('button', { name: 'Model, Prompt node, nodes[].model' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Model, Prompt node, nodes[].agents.*.model' })).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Max attempts, Approval node, nodes[].retry.max_attempts' }),
    ).toBeVisible()
    expect(
      screen.getByRole('button', {
        name: 'Max attempts, Approval node, nodes[].approval.on_reject.max_attempts',
      }),
    ).toBeVisible()
  })

  it('groups node-specific fields beneath their applicable node kind', async () => {
    const contract = (await loadBundledAuthoringContracts()).find(({ profile }) => profile === 'archon-2026-07')!
    const productionIndex = buildDocumentationIndex(contract)
    render(DocumentationTopicList, {
      ...defaultProps,
      index: productionIndex,
      mode: 'reference',
      expandedGroupIds: ['reference:node-specific-fields'],
    })

    expect(screen.getByRole('region', { name: 'Prompt node fields' })).toBeVisible()
    expect(screen.getByRole('region', { name: 'Bash node fields' })).toBeVisible()
  })
})
