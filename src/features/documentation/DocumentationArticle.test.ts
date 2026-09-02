import { fireEvent, render, screen, within } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import DocumentationArticle from './DocumentationArticle.svelte'
import type { DocumentationIndex, DocumentationTopic } from '$src/lib/docs/types'

const related: DocumentationTopic = {
  id: 'guide:dag-dependencies',
  kind: 'guide',
  title: 'DAG dependencies',
  description: 'Dependency guide.',
  body: 'Guide body',
  qualifier: 'Guide',
  useWhen: 'Use this when connecting steps.',
  breadcrumb: ['Guides', 'Build the graph'],
  renderer: 'markdown',
  examples: [],
  status: 'supported',
  profile: 'archon-2026-07',
  fieldPaths: [],
  guideGroup: 'build-graph',
}

const topic: DocumentationTopic = {
  id: 'field:prompt.node.context',
  kind: 'field',
  title: 'Context',
  description: 'Controls prompt context behavior.',
  body: '[DAG guide](#guide:dag-dependencies) [External](https://docs.example.test)',
  qualifier: 'Prompt node',
  useWhen: 'Use this when the Prompt node needs fresh or shared context.',
  breadcrumb: ['Reference', 'Common node settings'],
  renderer: 'markdown',
  examples: ['fresh'],
  status: 'supported',
  profile: 'archon-2026-07',
  fieldPaths: ['nodes[].context'],
  nodeKinds: ['prompt'],
  constraints: { enum: ['fresh', 'shared'] },
  relatedTopicIds: [related.id],
  required: false,
  defaultValue: 'fresh',
  referenceGroup: 'common-node-settings',
}

const index: DocumentationIndex = {
  topics: [topic, related],
  byId: new Map([
    [topic.id, topic],
    [related.id, related],
  ]),
  searchText: new Map(),
  tokenIndex: new Map(),
  guideGroups: new Map(),
  referenceGroups: new Map(),
  duplicateTitleGroups: new Map(),
}

describe('DocumentationArticle', () => {
  it('renders exact topic context, breadcrumbs, contract metadata, examples, and related topics', () => {
    render(DocumentationArticle, {
      topic,
      index,
      onBack: vi.fn(),
      onSelectTopic: vi.fn(),
    })

    const article = screen.getByRole('article', { name: 'Context' })
    expect(within(article).getByRole('navigation', { name: 'Documentation breadcrumb' })).toHaveTextContent(
      'ReferenceCommon node settings',
    )
    expect(within(article).getByRole('heading', { name: 'Context' })).toBeVisible()
    expect(within(article).getByText(topic.useWhen)).toBeVisible()
    expect(within(article).getByText('Prompt')).toBeVisible()
    expect(within(article).getByText('nodes[].context')).toBeVisible()
    expect(within(article).getByText('Optional')).toBeVisible()
    expect(within(article).getByText('fresh', { selector: 'code' })).toBeVisible()
    expect(within(article).getByText(/"enum"/)).toBeVisible()
    expect(within(article).getByRole('region', { name: 'Examples' })).toHaveTextContent('fresh')
    expect(within(article).getByRole('button', { name: 'DAG dependencies, Guide' })).toBeVisible()
  })

  it('routes sanitized internal and external Markdown actions without broadening topic anchors', async () => {
    const onSelectTopic = vi.fn()
    const onOpenExternal = vi.fn()
    render(DocumentationArticle, { topic, index, onBack: vi.fn(), onSelectTopic, onOpenExternal })

    await fireEvent.click(screen.getByRole('button', { name: 'Open documentation topic: DAG guide' }))
    expect(onSelectTopic).toHaveBeenCalledWith(related, expect.any(HTMLElement))
    await fireEvent.click(screen.getByRole('button', { name: 'Open external link' }))
    expect(onOpenExternal).toHaveBeenCalledWith('https://docs.example.test/')
  })

  it('publishes Back to Results as the article return control', async () => {
    const onBack = vi.fn()
    render(DocumentationArticle, { topic, index, onBack, onSelectTopic: vi.fn() })

    await fireEvent.click(screen.getByRole('button', { name: 'Back to Results' }))
    expect(onBack).toHaveBeenCalledOnce()
  })
})
