import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DocumentationView from './DocumentationView.svelte'
import ContextDocs from './ContextDocs.svelte'
import type { DocumentationIndex } from '$src/lib/docs/types'
import type { FormField } from '$src/lib/forms/types'

const nodePresentation = {
  qualifier: 'Node type',
  useWhen: 'Use this when you need documentation.',
  breadcrumb: ['Reference', 'Node types'],
  renderer: 'markdown' as const,
}
const fieldPresentation = {
  ...nodePresentation,
  qualifier: 'Prompt node',
  breadcrumb: ['Reference', 'Node-specific fields'],
}
const guidePresentation = { ...nodePresentation, qualifier: 'Guide', breadcrumb: ['Guides', 'Build the graph'] }

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
      ...nodePresentation,
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
      ...fieldPresentation,
    },
    {
      id: 'guide:dag',
      kind: 'guide',
      title: 'DAG dependencies',
      description: 'Guide.',
      body: '[Prompt field](#field:prompt.node.prompt) [Missing node](#node:missing) [Malformed](#field:../bad) [External](https://docs.example.test)',
      examples: [],
      status: 'supported',
      profile: 'archon-2026-07',
      fieldPaths: [],
      ...guidePresentation,
    },
  ],
  byId: new Map(),
  searchText: new Map(),
  tokenIndex: new Map(),
  guideGroups: new Map(),
  referenceGroups: new Map(),
  duplicateTitleGroups: new Map(),
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

function useNarrowPresentation(matches: boolean): { setMatches(next: boolean): void } {
  let current = matches
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      get matches() {
        return current && query === '(max-width: 48rem)'
      },
      media: query,
      onchange: null,
      addEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) =>
        listeners.add(listener),
      ),
      removeEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) =>
        listeners.delete(listener),
      ),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  )
  return {
    setMatches(next: boolean) {
      current = next
      for (const listener of listeners) {
        listener({ matches: next, media: '(max-width: 48rem)' } as MediaQueryListEvent)
      }
    },
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('DocumentationView', () => {
  it('keeps results and the selected article as master-detail siblings', async () => {
    render(DocumentationView, { index })

    await fireEvent.click(screen.getByRole('option', { name: /DAG dependencies/i }))

    const article = screen.getByRole('article', { name: 'DAG dependencies' })
    expect(article).toBeVisible()
    expect(screen.getByTestId('documentation-navigation')).not.toContainElement(article)
    expect(article.parentElement).toBe(screen.getByTestId('documentation-navigation').parentElement)
    expect(screen.getByRole('button', { name: 'Back to Results' })).toBeVisible()

    await fireEvent.click(screen.getByRole('button', { name: 'Back to Results' }))
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
  })

  it('announces an empty search result set explicitly', async () => {
    render(DocumentationView, { index })

    await fireEvent.input(screen.getByRole('searchbox', { name: 'Search documentation' }), {
      target: { value: 'nothing-can-match-this-query' },
    })

    expect(screen.getByRole('status')).toHaveTextContent('No documentation matches')
  })

  it('moves keyboard focus into narrow detail and restores the selected result', async () => {
    useNarrowPresentation(true)
    render(DocumentationView, { index })
    const search = screen.getByRole('searchbox', { name: 'Search documentation' })
    await fireEvent.input(search, { target: { value: 'Prompt' } })
    const selectedResult = document.getElementById(search.getAttribute('aria-activedescendant')!)!
    search.focus()

    await fireEvent.keyDown(search, { key: 'Enter' })

    await waitFor(() => expect(screen.getByRole('button', { name: 'Back to Results' })).toHaveFocus())
    await fireEvent.click(screen.getByRole('button', { name: 'Back to Results' }))
    await waitFor(() => expect(selectedResult).toHaveFocus())
  })

  it('resets narrow article scroll and returns to search when an internal topic is filtered out', async () => {
    useNarrowPresentation(true)
    render(DocumentationView, { index })
    await fireEvent.change(screen.getByRole('combobox', { name: 'Topic type' }), { target: { value: 'guide' } })
    await fireEvent.click(screen.getByRole('option', { name: /DAG dependencies/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Back to Results' })).toHaveFocus())
    const article = screen.getByRole('article')
    article.scrollTop = 120

    await fireEvent.click(screen.getByRole('button', { name: 'Open documentation topic: Prompt field' }))

    expect(screen.getByRole('heading', { name: 'Prompt' })).toBeVisible()
    expect(article.scrollTop).toBe(0)
    expect(article).toContainElement(document.activeElement as HTMLElement)
    await fireEvent.click(screen.getByRole('button', { name: 'Back to Results' }))
    await waitFor(() => expect(screen.getByRole('searchbox', { name: 'Search documentation' })).toHaveFocus())
  })

  it('preserves result focus when wide master-detail selection opens', async () => {
    useNarrowPresentation(false)
    render(DocumentationView, { index })
    const result = screen.getByRole('option', { name: /DAG dependencies/i })
    result.focus()

    await fireEvent.click(result)

    expect(result).toHaveFocus()
  })

  it('transfers selected-result focus across both responsive presentation changes', async () => {
    const presentation = useNarrowPresentation(false)
    render(DocumentationView, { index })
    const result = screen.getByRole('option', { name: /DAG dependencies/i })
    result.focus()
    await fireEvent.click(result)

    // Chromium can drop focus when the responsive stylesheet hides the
    // navigation before the MediaQueryList change callback runs.
    result.blur()
    presentation.setMatches(true)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Back to Results' })).toHaveFocus())

    presentation.setMatches(false)
    await waitFor(() => expect(result).toHaveFocus())
  })

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

  it('delegates validated internal guide links to an exact topic and moves focus while malformed links stay inert', async () => {
    render(DocumentationView, { index, topicId: 'guide:dag' })
    const article = screen.getByRole('article')
    const malformed = screen.getByText('Malformed')
    expect(malformed.closest('a')).not.toHaveAttribute('href')

    await fireEvent.click(screen.getByRole('button', { name: 'Open documentation topic: Prompt field' }))

    expect(screen.getByRole('heading', { name: 'Prompt' })).toBeVisible()
    expect(article).toHaveFocus()

    await fireEvent.click(screen.getByRole('button', { name: 'DAG dependencies — guide:dag' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Open documentation topic: Missing node' }))
    expect(screen.getByRole('heading', { name: 'DAG dependencies' })).toBeVisible()
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

  it('acknowledges a requested topic so later user navigation is not reset', async () => {
    const onTopicConsumed = vi.fn()
    const { rerender } = render(DocumentationView, { index, topicId: 'guide:dag', onTopicConsumed })
    expect(onTopicConsumed).toHaveBeenCalledWith('guide:dag')
    await rerender({ index, topicId: undefined, onTopicConsumed })
    const search = screen.getByRole('searchbox', { name: 'Search documentation' })
    await fireEvent.input(search, { target: { value: 'Prompt' } })
    await fireEvent.keyDown(search, { key: 'Enter' })

    expect(screen.getByRole('heading', { name: 'Prompt' })).toBeVisible()
  })

  it('consumes a repeated topic request once even when that topic is already selected', async () => {
    const onTopicConsumed = vi.fn()
    const { rerender } = render(DocumentationView, { index, topicId: 'guide:dag', onTopicConsumed })
    await rerender({ index, topicId: 'guide:dag', navigationRequestId: 2, onTopicConsumed })
    expect(onTopicConsumed).toHaveBeenCalledWith('guide:dag', 2)

    await rerender({ index, topicId: undefined, navigationRequestId: undefined, onTopicConsumed })
    const search = screen.getByRole('searchbox', { name: 'Search documentation' })
    await fireEvent.input(search, { target: { value: 'Prompt' } })
    await fireEvent.keyDown(search, { key: 'Enter' })
    expect(screen.getByRole('heading', { name: 'Prompt' })).toBeVisible()
  })

  it('remaps selected topics and history by ID when the profile index changes, then clears absent IDs', async () => {
    const { rerender } = render(DocumentationView, { index, topicId: 'field:prompt.node.prompt' })
    const replacementTopic = {
      ...index.byId.get('field:prompt.node.prompt')!,
      title: 'Prompt text (legacy)',
      body: 'Legacy field body',
      profile: 'hermes-legacy' as const,
    }
    const replacement: DocumentationIndex = {
      topics: [replacementTopic],
      byId: new Map([[replacementTopic.id, replacementTopic]]),
      searchText: new Map([[replacementTopic.id, 'prompt text legacy']]),
      tokenIndex: new Map([['prompt', new Set([replacementTopic.id])]]),
      guideGroups: new Map(),
      referenceGroups: new Map(),
      duplicateTitleGroups: new Map(),
    }

    await rerender({ index: replacement, topicId: undefined })
    expect(screen.getByRole('heading', { name: 'Prompt text (legacy)' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Prompt text (legacy) — field:prompt.node.prompt' })).toBeVisible()

    const absent: DocumentationIndex = {
      topics: [],
      byId: new Map(),
      searchText: new Map(),
      tokenIndex: new Map(),
      guideGroups: new Map(),
      referenceGroups: new Map(),
      duplicateTitleGroups: new Map(),
    }
    await rerender({ index: absent, topicId: undefined })
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Documentation history' })).not.toBeInTheDocument()
  })

  it('consumes an unresolved requested topic so a later profile index cannot replay it', async () => {
    const onTopicConsumed = vi.fn()
    const absent: DocumentationIndex = {
      topics: [],
      byId: new Map(),
      searchText: new Map(),
      tokenIndex: new Map(),
      guideGroups: new Map(),
      referenceGroups: new Map(),
      duplicateTitleGroups: new Map(),
    }
    const { rerender } = render(DocumentationView, {
      index: absent,
      topicId: 'field:prompt.node.prompt',
      navigationRequestId: 7,
      onTopicConsumed,
    })
    expect(onTopicConsumed).toHaveBeenCalledWith('field:prompt.node.prompt', 7)

    await rerender({ index, topicId: undefined, navigationRequestId: undefined, onTopicConsumed })
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
  })
})
