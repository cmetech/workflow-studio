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
}
index.byId = new Map(index.topics.map((topic) => [topic.id, topic]))

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
    expect(screen.getByText(/History: Prompt/)).toBeVisible()
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
})
