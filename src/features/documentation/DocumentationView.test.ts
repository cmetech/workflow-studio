import { fireEvent, render, screen, within } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import DocumentationView from './DocumentationView.svelte'
import ContextDocs from './ContextDocs.svelte'
import type { DocumentationIndex } from '$src/lib/docs/types'
import type { FormField } from '$src/lib/forms/types'

const index: DocumentationIndex = {
  topics: [
    {
      id: 'node:prompt',
      kind: 'node',
      title: 'Prompt',
      description: 'Prompt node.',
      body: 'Node body',
      examples: [],
      status: 'supported',
      profile: 'archon-2026-07',
      fieldPaths: [],
    },
    {
      id: 'field:prompt.node.prompt',
      kind: 'field',
      title: 'Prompt',
      description: 'Prompt field.',
      body: 'Field body',
      examples: [],
      status: 'supported',
      profile: 'archon-2026-07',
      fieldPaths: ['nodes[].prompt'],
    },
    {
      id: 'guide:dag',
      kind: 'guide',
      title: 'DAG dependencies',
      description: 'Guide.',
      body: '[External](https://docs.example.test)',
      examples: [],
      status: 'supported',
      profile: 'archon-2026-07',
      fieldPaths: [],
    },
  ],
  byId: new Map(),
  searchText: new Map(),
  tokenIndex: new Map(),
}
index.byId = new Map(index.topics.map((topic) => [topic.id, topic]))
index.searchText = new Map(
  index.topics.map((topic) => [topic.id, `${topic.title} ${topic.id} ${topic.body}`.toLowerCase()]),
)
index.tokenIndex = new Map([
  ['prompt', new Set(['node:prompt', 'field:prompt.node.prompt'])],
  ['field', new Set(['field:prompt.node.prompt'])],
  ['dag', new Set(['guide:dag'])],
  ['dependencies', new Set(['guide:dag'])],
])

describe('DocumentationView', () => {
  it('filters and keyboard-navigates offline search results without using fetch, and records history', async () => {
    const onOpenExternal = vi.fn()
    const fetchStub = vi.fn()
    vi.stubGlobal('fetch', fetchStub)
    render(DocumentationView, { index, onOpenExternal })

    const search = screen.getByRole('searchbox', { name: 'Search documentation' })
    await fireEvent.input(search, { target: { value: 'Prompt' } })
    expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(2)
    await fireEvent.keyDown(search, { key: 'ArrowDown' })
    await fireEvent.keyDown(search, { key: 'Enter' })
    expect(screen.getByRole('heading', { name: 'Prompt' })).toBeVisible()
    expect(screen.getByRole('navigation', { name: 'Documentation history' })).toBeVisible()
    expect(fetchStub).not.toHaveBeenCalled()

    await fireEvent.change(screen.getByRole('combobox', { name: 'Topic type' }), { target: { value: 'guide' } })
    await fireEvent.input(search, { target: { value: 'DAG' } })
    await fireEvent.click(screen.getByRole('option', { name: /DAG dependencies/i }))
    await fireEvent.click(screen.getByRole('button', { name: 'Open external link' }))
    expect(onOpenExternal).toHaveBeenCalledWith('https://docs.example.test/')
  })

  it('renders the exact contract field topic for the inspector Docs tab', () => {
    const field: FormField = {
      id: 'prompt.node.prompt',
      label: 'Prompt',
      description: 'Fallback description.',
      fieldPath: 'nodes[].prompt',
      pathTemplate: ['nodes', '$node', 'prompt'],
      document: 'definition',
      widget: 'code',
      section: 'General',
      order: 1,
      status: 'supported',
      examples: [],
      schema: { type: 'string' },
      required: true,
      hasDefault: false,
      constraints: {},
    }
    render(ContextDocs, { field, index })

    expect(screen.getByLabelText('Prompt documentation')).toHaveAttribute('data-topic-id', 'field:prompt.node.prompt')
    expect(screen.getByText('Prompt field.')).toBeVisible()
  })

  it('keeps keyboard result navigation and history addressable by topic ID', async () => {
    render(DocumentationView, { index })
    const search = screen.getByRole('searchbox', { name: 'Search documentation' })

    await fireEvent.input(search, { target: { value: 'Prompt' } })
    await fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(search).toHaveAttribute('aria-activedescendant', 'documentation-result-field:prompt.node.prompt')
    expect(document.getElementById('documentation-result-field:prompt.node.prompt')).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await fireEvent.keyDown(search, { key: 'Enter' })
    await fireEvent.keyDown(search, { key: 'ArrowUp' })
    await fireEvent.keyDown(search, { key: 'Enter' })

    expect(screen.getByRole('button', { name: 'Prompt — field:prompt.node.prompt' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Prompt — node:prompt' })).toBeVisible()
  })

  it('opens a topic requested by contextual navigation', () => {
    render(DocumentationView, { index, topicId: 'guide:dag' })
    expect(screen.getByRole('heading', { name: 'DAG dependencies' })).toBeVisible()
  })
})
