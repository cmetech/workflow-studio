import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DocumentationView from './DocumentationView.svelte'
import { resetDocumentationSession } from '$src/stores/documentation'
import type { DocumentationIndex, DocumentationTopic, GuideGroupId } from '$src/lib/docs/types'
import { createCommandRegistry } from '$src/lib/commands/registry'

const guide = (id: string, title: string, group: GuideGroupId): DocumentationTopic => ({
  id: `guide:${id}`,
  kind: 'guide',
  title,
  description: `${title} guide.`,
  body: id === 'quick-start' ? '[DAG dependencies](#guide:dag-dependencies)' : `${title} body.`,
  qualifier: 'Guide',
  useWhen: `Use this when ${title.toLowerCase()} helps the current task.`,
  breadcrumb: ['Guides', group === 'getting-started' ? 'Getting started' : 'Build the graph'],
  renderer: 'markdown',
  examples: [],
  status: 'supported',
  profile: 'archon-2026-07',
  fieldPaths: [],
  guideGroup: group,
})

const nodeKinds = ['command', 'prompt', 'bash', 'script', 'loop', 'approval', 'cancel'] as const
const contexts: DocumentationTopic[] = nodeKinds.map((kind) => ({
  id: `field:${kind}.node.context`,
  kind: 'field',
  title: 'Context',
  description: `${kind} context.`,
  body: `${kind} context body.`,
  qualifier: `${kind[0]!.toUpperCase()}${kind.slice(1)} node`,
  useWhen: `Use this when ${kind} context must be configured.`,
  breadcrumb: ['Reference', 'Common node settings'],
  renderer: 'markdown',
  examples: [],
  status: 'supported',
  profile: 'archon-2026-07',
  fieldPaths: ['nodes[].context'],
  nodeKinds: [kind],
  referenceGroup: 'common-node-settings',
}))

const guides = [
  guide('quick-start', 'Quick Start', 'getting-started'),
  guide('workflow-pairs', 'Workflow pairs', 'getting-started'),
  guide('dag-dependencies', 'DAG dependencies', 'build-graph'),
  guide('problems-and-validation', 'Problems and validation', 'review-recover'),
  guide('keyboard-shortcuts', 'Keyboard shortcuts', 'use-application'),
]

function makeIndex(topics: readonly DocumentationTopic[] = [...contexts, ...guides]): DocumentationIndex {
  const searchText = new Map(
    topics.map((topic) => [
      topic.id,
      `${topic.title} ${topic.qualifier} ${topic.description} ${topic.nodeKinds?.join(' ') ?? ''}`.toLowerCase(),
    ]),
  )
  const tokenIndex = new Map<string, Set<string>>()
  for (const [id, text] of searchText) {
    for (const token of text.split(/[^a-z0-9]+/).filter(Boolean)) {
      const ids = tokenIndex.get(token) ?? new Set<string>()
      ids.add(id)
      tokenIndex.set(token, ids)
    }
  }
  return {
    topics,
    byId: new Map(topics.map((topic) => [topic.id, topic])),
    searchText,
    tokenIndex,
    guideGroups: new Map([
      ['getting-started', guides.filter((topic) => topic.guideGroup === 'getting-started')],
      ['build-graph', guides.filter((topic) => topic.guideGroup === 'build-graph')],
      ['review-recover', guides.filter((topic) => topic.guideGroup === 'review-recover')],
      ['use-application', guides.filter((topic) => topic.guideGroup === 'use-application')],
    ]),
    referenceGroups: new Map([['common-node-settings', contexts]]),
    duplicateTitleGroups: new Map([['context', contexts]]),
  }
}

const index = makeIndex()

const commandSurface = createCommandRegistry()
commandSurface.registerCommand({
  id: 'document.save',
  label: 'Save Workflow Pair',
  category: 'File',
  defaultBindings: ['Mod+S'],
  enabled: () => true,
  run: () => undefined,
})

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

afterEach(() => {
  resetDocumentationSession()
  vi.unstubAllGlobals()
})

describe('DocumentationView', () => {
  it('opens on the task-led Overview without instantiating the exhaustive reference list', () => {
    render(DocumentationView, { index })

    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: 'Start here' })).toBeVisible()
    expect(screen.getByRole('button', { name: /Fix a validation problem/i })).toBeVisible()
    expect(screen.queryByText('Context', { selector: 'strong' })).not.toBeInTheDocument()
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
  })

  it('switches between journey-grouped Guides and grouped Reference without merging duplicate topics', async () => {
    render(DocumentationView, { index })

    await fireEvent.click(screen.getByRole('tab', { name: 'Guides' }))
    expect(screen.getByRole('heading', { name: 'Getting started' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Build the graph' })).toBeVisible()

    await fireEvent.click(screen.getByRole('tab', { name: 'Reference' }))
    expect(screen.getByRole('button', { name: 'Common node settings, reference group' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    const disclosure = screen.getByRole('button', { name: 'Context, used by 7 node types' })
    expect(disclosure).toHaveAttribute('aria-expanded', 'false')
    await fireEvent.click(disclosure)
    expect(screen.getByRole('button', { name: 'Context, Prompt node' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Context, Bash node' })).toBeVisible()
  })

  it('bypasses Overview for an exact contextual request and restores the prior Back target', async () => {
    const onTopicConsumed = vi.fn()
    render(DocumentationView, {
      index,
      topicId: 'field:prompt.node.context',
      navigationRequestId: 9,
      onTopicConsumed,
    })

    expect(screen.getByRole('article', { name: 'Context' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Context' })).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Reference' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('heading', { name: 'Start here' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Common node settings, reference group' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Context, used by 7 node types' })).toBeVisible()
    expect(onTopicConsumed).toHaveBeenCalledWith('field:prompt.node.context', 9)

    await fireEvent.click(screen.getByRole('button', { name: 'Back to Results' }))
    expect(screen.getByRole('heading', { name: 'Start here' })).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
  })

  it('opens and focuses the Overview reference group entry point', async () => {
    render(DocumentationView, { index })

    await fireEvent.click(screen.getByRole('button', { name: /Common node settings/i }))

    expect(screen.getByRole('tab', { name: 'Reference' })).toHaveAttribute('aria-selected', 'true')
    const group = screen.getByRole('button', { name: 'Common node settings, reference group' })
    expect(group).toHaveAttribute('aria-expanded', 'true')
    expect(group).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Context, used by 7 node types' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Start here' })).not.toBeInTheDocument()
  })

  it('restores focus to the exact task card that opened an article', async () => {
    render(DocumentationView, { index })
    const opener = screen.getByRole('button', { name: /Fix a validation problem/i })

    await fireEvent.click(opener)
    expect(screen.getByRole('article', { name: 'Problems and validation' })).toBeVisible()
    await fireEvent.click(screen.getByRole('button', { name: 'Back to Results' }))

    await waitFor(() => expect(opener).toHaveFocus())
  })

  it('restores focus to the exact duplicate child that opened an article', async () => {
    render(DocumentationView, { index })
    await fireEvent.click(screen.getByRole('tab', { name: 'Reference' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Context, used by 7 node types' }))
    const opener = screen.getByRole('button', { name: 'Context, Bash node' })

    await fireEvent.click(opener)
    expect(screen.getByText('Bash node', { selector: '.topic-qualifier' })).toBeVisible()
    await fireEvent.click(screen.getByRole('button', { name: 'Back to Results' }))

    await waitFor(() => expect(opener).toHaveFocus())
  })

  it('searches the selected scope, exposes All documentation, and publishes only rendered highlights', async () => {
    render(DocumentationView, { index })
    await fireEvent.click(screen.getByRole('tab', { name: 'Guides' }))
    const search = screen.getByRole('searchbox', { name: 'Search documentation' })
    await fireEvent.input(search, { target: { value: 'context prompt' } })
    expect(screen.getByRole('status')).toHaveTextContent('No guides match “context prompt”')

    await fireEvent.click(screen.getByRole('checkbox', { name: 'All documentation' }))
    expect(screen.getByRole('button', { name: 'Context, Prompt node' })).toBeVisible()
    expect(search).toHaveAttribute('aria-activedescendant', 'documentation-result-field:prompt.node.context')
  })

  it('moves focus into narrow detail and restores the opener across responsive presentation changes', async () => {
    const presentation = useNarrowPresentation(false)
    render(DocumentationView, { index })
    const opener = screen.getByRole('button', { name: /Fix a validation problem/i })
    opener.focus()
    await fireEvent.click(opener)

    presentation.setMatches(true)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Back to Results' })).toHaveFocus())
    presentation.setMatches(false)
    await waitFor(() => expect(opener).toHaveFocus())
  })

  it('reconciles selected and history topics by stable ID when the active profile changes', async () => {
    const { rerender } = render(DocumentationView, { index, topicId: 'field:prompt.node.context' })
    const replacement: DocumentationTopic = {
      ...contexts[1]!,
      title: 'Context (legacy)',
      profile: 'hermes-legacy',
    }

    await rerender({ index: makeIndex([replacement]), topicId: undefined })
    expect(screen.getByRole('heading', { name: 'Context (legacy)' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Context (legacy) — field:prompt.node.context' })).toBeVisible()

    await rerender({ index: makeIndex([]), topicId: undefined })
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Documentation history' })).not.toBeInTheDocument()
  })

  it('consumes an unresolved request so a later profile index cannot replay it', async () => {
    const onTopicConsumed = vi.fn()
    const { rerender } = render(DocumentationView, {
      index: makeIndex([]),
      topicId: 'field:prompt.node.context',
      navigationRequestId: 7,
      onTopicConsumed,
    })
    expect(onTopicConsumed).toHaveBeenCalledWith('field:prompt.node.context', 7)

    await rerender({ index, topicId: undefined, navigationRequestId: undefined, onTopicConsumed })
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
  })

  it('renders live keyboard help through the selected keyboard guide', async () => {
    const keyboardGuide: DocumentationTopic = {
      ...guides.find(({ id }) => id === 'guide:keyboard-shortcuts')!,
      renderer: 'keyboard-shortcuts',
    }
    render(DocumentationView, {
      index: makeIndex([...contexts, ...guides.filter(({ id }) => id !== keyboardGuide.id), keyboardGuide]),
      commandSurface,
    })

    await fireEvent.click(screen.getByRole('button', { name: /Work faster with keyboard shortcuts/i }))
    expect(screen.getByRole('searchbox', { name: 'Search keyboard shortcuts' })).toBeVisible()
    expect(screen.getByText('Save Workflow Pair')).toBeVisible()
  })
})
