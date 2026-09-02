<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte'
  import DocumentationArticle from './DocumentationArticle.svelte'
  import DocumentationOverview from './DocumentationOverview.svelte'
  import DocumentationTopicList from './DocumentationTopicList.svelte'
  import { searchDocumentation } from '$src/lib/docs/build-index'
  import { commandRegistry, type CommandSurface } from '$src/lib/commands/registry'
  import type { DocumentationIndex, DocumentationMode, DocumentationTopic, ReferenceGroupId } from '$src/lib/docs/types'
  import {
    $documentationSession as documentationSessionStore,
    reconcileDocumentationSession,
    updateDocumentationSession,
  } from '$src/stores/documentation'

  interface Props {
    index: DocumentationIndex
    commandSurface?: CommandSurface
    topicId?: string | undefined
    navigationRequestId?: number | undefined
    onTopicConsumed?: ((id: string, requestId?: number) => void) | undefined
    onOpenExternal?: ((url: string) => void) | undefined
  }

  let {
    index,
    commandSurface = commandRegistry,
    topicId,
    navigationRequestId,
    onTopicConsumed,
    onOpenExternal,
  }: Props = $props()
  let session = $state(documentationSessionStore.get())
  let consumedRequestId = $state<number | undefined>()
  let consumedTopicId = $state<string | undefined>()
  let reconciledIndex: DocumentationIndex | undefined
  let layout = $state<HTMLElement>()
  let navigation = $state<HTMLElement>()
  let searchInput = $state<HTMLInputElement>()
  let transientNavigationMode = $state<'guides' | 'reference' | undefined>()
  let selectionOpener: HTMLElement | undefined
  let modeBeforeAll: Exclude<DocumentationMode, 'all'> = 'overview'
  let narrowPresentation = $state(window.matchMedia?.('(max-width: 48rem)').matches ?? false)
  let responsiveFocusOwned = false
  let presentationQuery: MediaQueryList | undefined
  let unsubscribeSession: (() => void) | undefined

  const selected = $derived(session.selectedTopicId ? (index.byId.get(session.selectedTopicId) ?? null) : null)
  const presentationMode = $derived(modeForPresentation(session.mode, selected))
  const navigationMode = $derived<DocumentationMode>(transientNavigationMode ?? session.mode)
  const searchMode = $derived<'guides' | 'reference' | 'all'>(navigationMode === 'overview' ? 'all' : navigationMode)
  const searchResults = $derived(
    session.query.trim() ? searchDocumentation(index, session.query, { mode: searchMode }) : [],
  )
  const activeResultId = $derived(
    searchResults.some(({ id }) => id === session.highlightedTopicId)
      ? `documentation-result-${session.highlightedTopicId}`
      : undefined,
  )

  function modeForPresentation(mode: DocumentationMode, topic: DocumentationTopic | null): DocumentationMode {
    if (!topic || mode === 'all') return mode
    const topicMode: DocumentationMode = topic.kind === 'guide' ? 'guides' : 'reference'
    return mode === topicMode ? mode : topicMode
  }

  function articleElement(): HTMLElement | undefined {
    return layout?.querySelector<HTMLElement>(':scope > article') ?? undefined
  }

  function backButton(): HTMLButtonElement | undefined {
    return articleElement()?.querySelector<HTMLButtonElement>('.back-to-results') ?? undefined
  }

  function selectTopic(topic: DocumentationTopic, opener?: HTMLElement): void {
    const focused = document.activeElement
    selectionOpener = opener
    responsiveFocusOwned = narrowPresentation || (focused instanceof Node && navigation?.contains(focused) === true)
    updateDocumentationSession({
      selectedTopicId: topic.id,
      history: [topic.id, ...session.history.filter((id) => id !== topic.id)].slice(0, 5),
      articleScrollTop: 0,
    })
    void revealSelectedTopic(topic.id, Boolean(opener && articleElement()?.contains(opener)))
  }

  async function revealSelectedTopic(selectedId: string, fromArticle = false): Promise<void> {
    await tick()
    if (session.selectedTopicId !== selectedId) return
    const article = articleElement()
    if (article) article.scrollTop = 0
    if (narrowPresentation) {
      const pageScroll = article?.closest<HTMLElement>('[data-page-scroll]')
      if (pageScroll) pageScroll.scrollTop = 0
      responsiveFocusOwned = true
      backButton()?.focus({ preventScroll: true })
    } else if (fromArticle) {
      article?.focus({ preventScroll: true })
    }
  }

  function returnToResults(): void {
    const article = articleElement()
    const opener = selectionOpener
    const selectedId = session.selectedTopicId
    responsiveFocusOwned = false
    transientNavigationMode = undefined
    updateDocumentationSession({
      selectedTopicId: undefined,
      articleScrollTop: article?.scrollTop ?? session.articleScrollTop,
    })
    void tick().then(() => {
      const exactResult = selectedId ? document.getElementById(`documentation-result-${selectedId}`) : undefined
      const target = opener?.isConnected ? opener : (exactResult ?? searchInput ?? selectedTab())
      target?.focus({ preventScroll: true })
      if (navigation) navigation.scrollTop = session.navigationScrollTop
    })
  }

  function selectedTab(): HTMLElement | undefined {
    const selectedTab = layout?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
    return selectedTab ?? undefined
  }

  function setMode(mode: Exclude<DocumentationMode, 'all'>): void {
    modeBeforeAll = mode
    selectionOpener = undefined
    transientNavigationMode = undefined
    const expandedGroupIds =
      mode === 'reference'
        ? [...session.expandedGroupIds.filter((id) => !id.startsWith('reference:')), 'reference:common-node-settings']
        : session.expandedGroupIds
    updateDocumentationSession({
      mode,
      selectedTopicId: undefined,
      highlightedTopicId: undefined,
      expandedGroupIds,
    })
  }

  function setAllDocumentation(checked: boolean): void {
    if (checked) {
      if (session.mode !== 'all') modeBeforeAll = session.mode
      const highlightedTopicId = searchDocumentation(index, session.query, { mode: 'all' })[0]?.id
      updateDocumentationSession({ mode: 'all', highlightedTopicId })
    } else {
      const mode = modeBeforeAll
      const scope = mode === 'overview' ? 'all' : mode
      const highlightedTopicId = searchDocumentation(index, session.query, { mode: scope })[0]?.id
      updateDocumentationSession({ mode, highlightedTopicId })
    }
  }

  function setQuery(query: string): void {
    let mode = session.mode
    if (query && mode === 'overview') {
      modeBeforeAll = 'overview'
      mode = 'all'
    } else if (!query && mode === 'all') {
      mode = modeBeforeAll
    }
    const scope = mode === 'overview' ? 'all' : mode
    const highlightedTopicId = query ? searchDocumentation(index, query, { mode: scope })[0]?.id : undefined
    updateDocumentationSession({ query, mode, highlightedTopicId })
  }

  function browseReference(group: ReferenceGroupId, opener: HTMLElement): void {
    selectionOpener = opener
    transientNavigationMode = undefined
    modeBeforeAll = 'reference'
    const groupId = `reference:${group}`
    updateDocumentationSession({
      mode: 'reference',
      selectedTopicId: undefined,
      expandedGroupIds: [...session.expandedGroupIds.filter((id) => !id.startsWith('reference:')), groupId],
    })
    void tick().then(() => document.getElementById(`documentation-group-${group}`)?.focus())
  }

  function toggleGroup(groupId: string): void {
    const expandedGroupIds = session.expandedGroupIds.includes(groupId)
      ? session.expandedGroupIds.filter((id) => id !== groupId)
      : [...session.expandedGroupIds, groupId]
    updateDocumentationSession({ expandedGroupIds })
  }

  function searchKeydown(event: KeyboardEvent): void {
    if (!session.query.trim() || searchResults.length === 0) return
    const currentIndex = searchResults.findIndex(({ id }) => id === session.highlightedTopicId)
    if (event.key === 'ArrowDown') {
      const nextIndex = Math.min(currentIndex + 1, searchResults.length - 1)
      updateDocumentationSession({ highlightedTopicId: searchResults[Math.max(0, nextIndex)]?.id })
      event.preventDefault()
    } else if (event.key === 'ArrowUp') {
      const nextIndex = Math.max(currentIndex <= 0 ? 0 : currentIndex - 1, 0)
      updateDocumentationSession({ highlightedTopicId: searchResults[nextIndex]?.id })
      event.preventDefault()
    } else if (event.key === 'Enter') {
      const topic = searchResults.find(({ id }) => id === session.highlightedTopicId)
      if (topic) {
        const opener = document.getElementById(`documentation-result-${topic.id}`) ?? searchInput
        selectTopic(topic, opener)
        event.preventDefault()
      }
    }
  }

  function presentationChanged(event: MediaQueryListEvent): void {
    const wasNarrow = narrowPresentation
    narrowPresentation = event.matches
    if (!selected || wasNarrow === narrowPresentation) return
    const focused = document.activeElement
    if (narrowPresentation && ((focused instanceof Node && navigation?.contains(focused)) || responsiveFocusOwned)) {
      void tick().then(() => {
        responsiveFocusOwned = true
        backButton()?.focus({ preventScroll: true })
      })
    } else if (!narrowPresentation && (focused === backButton() || responsiveFocusOwned)) {
      responsiveFocusOwned = false
      void tick().then(() => {
        const target = selectionOpener?.isConnected ? selectionOpener : selectedTab()
        target?.focus({ preventScroll: true })
      })
    }
  }

  function focusChanged(event: FocusEvent): void {
    if (!responsiveFocusOwned || event.target === backButton()) return
    if (event.target instanceof Node && navigation?.contains(event.target)) return
    responsiveFocusOwned = false
  }

  function selectContextualTopic(topic: DocumentationTopic): void {
    transientNavigationMode = topic.kind === 'guide' ? 'guides' : 'reference'
    const referenceGroupId = topic.referenceGroup ? `reference:${topic.referenceGroup}` : undefined
    if (referenceGroupId) {
      updateDocumentationSession({
        expandedGroupIds: [...session.expandedGroupIds.filter((id) => !id.startsWith('reference:')), referenceGroupId],
      })
    }
    selectTopic(topic)
  }

  onMount(() => {
    unsubscribeSession = documentationSessionStore.subscribe((value) => {
      session = value
    })
    presentationQuery = window.matchMedia?.('(max-width: 48rem)')
    if (presentationQuery) {
      narrowPresentation = presentationQuery.matches
      presentationQuery.addEventListener?.('change', presentationChanged)
    }
    document.addEventListener('focusin', focusChanged)
    void tick().then(() => {
      if (navigation) navigation.scrollTop = session.navigationScrollTop
      const article = articleElement()
      if (article) article.scrollTop = session.articleScrollTop
    })
  })

  onDestroy(() => {
    const article = articleElement()
    updateDocumentationSession({
      navigationScrollTop: navigation?.scrollTop ?? session.navigationScrollTop,
      articleScrollTop: article?.scrollTop ?? session.articleScrollTop,
    })
    unsubscribeSession?.()
    presentationQuery?.removeEventListener?.('change', presentationChanged)
    document.removeEventListener('focusin', focusChanged)
  })

  $effect(() => {
    if (index === reconciledIndex) return
    reconciledIndex = index
    reconcileDocumentationSession(index)
  })

  $effect(() => {
    const topic = topicId ? index.byId.get(topicId) : undefined
    if (topic && navigationRequestId !== undefined && consumedRequestId !== navigationRequestId) {
      selectContextualTopic(topic)
      consumedRequestId = navigationRequestId
      onTopicConsumed?.(topic.id, navigationRequestId)
    } else if (topic && navigationRequestId === undefined && consumedTopicId !== topic.id) {
      selectContextualTopic(topic)
      consumedTopicId = topic.id
      onTopicConsumed?.(topic.id)
    } else if (topicId && !topic && navigationRequestId !== undefined && consumedRequestId !== navigationRequestId) {
      consumedRequestId = navigationRequestId
      onTopicConsumed?.(topicId, navigationRequestId)
    }
  })
</script>

<section class="documentation" aria-label="Offline documentation" data-profile={index.topics[0]?.profile}>
  <div bind:this={layout} class="documentation-layout" class:detail-active={selected !== null}>
    <section
      bind:this={navigation}
      class="documentation-navigation"
      data-testid="documentation-navigation"
      aria-label="Documentation navigation"
      onscroll={() => updateDocumentationSession({ navigationScrollTop: navigation?.scrollTop ?? 0 })}
    >
      <div class="mode-tabs" role="tablist" aria-label="Documentation mode">
        {#each ['overview', 'guides', 'reference'] as mode (mode)}
          <button
            type="button"
            role="tab"
            aria-selected={presentationMode === mode}
            onclick={() => setMode(mode as 'overview' | 'guides' | 'reference')}
            >{mode[0]?.toUpperCase()}{mode.slice(1)}</button
          >
        {/each}
      </div>

      <div class="search-controls">
        <label>
          Search documentation
          <input
            bind:this={searchInput}
            type="search"
            value={session.query}
            aria-controls="documentation-results"
            aria-activedescendant={activeResultId}
            oninput={(event) => setQuery(event.currentTarget.value)}
            onkeydown={searchKeydown}
          />
        </label>
        <label class="all-documentation">
          <input
            type="checkbox"
            checked={session.mode === 'all'}
            onchange={(event) => setAllDocumentation(event.currentTarget.checked)}
          />
          All documentation
        </label>
      </div>

      <div id="documentation-results" class="navigation-content">
        {#if navigationMode === 'overview' && !session.query.trim()}
          <DocumentationOverview
            onSelectTopic={(id, opener) => {
              const topic = index.byId.get(id)
              if (topic) selectTopic(topic, opener)
            }}
            onBrowseReference={browseReference}
          />
        {:else}
          <DocumentationTopicList
            {...session.highlightedTopicId ? { highlightedTopicId: session.highlightedTopicId } : {}}
            {index}
            mode={searchMode}
            query={session.query}
            expandedGroupIds={session.expandedGroupIds}
            onSelect={selectTopic}
            onHighlight={(highlightedTopicId) => updateDocumentationSession({ highlightedTopicId })}
            onToggleGroup={toggleGroup}
          />
        {/if}
      </div>

      {#if session.history.length > 0}
        <nav aria-label="Documentation history">
          {#each session.history as id (id)}
            {@const topic = index.byId.get(id)}
            {#if topic}
              <button type="button" onclick={(event) => selectTopic(topic, event.currentTarget)}>
                {topic.title} — {topic.id}
              </button>
            {/if}
          {/each}
        </nav>
      {/if}
    </section>

    {#if selected}
      <DocumentationArticle
        topic={selected}
        {index}
        {commandSurface}
        onBack={returnToResults}
        onSelectTopic={selectTopic}
        {onOpenExternal}
      />
    {/if}
  </div>
</section>

<style>
  .documentation {
    height: 100%;
    min-width: 0;
    min-height: 0;
    max-width: 100%;
  }
  .documentation-layout {
    display: grid;
    grid-template-columns: minmax(18rem, 25rem) minmax(0, 1fr);
    gap: var(--space-3);
    height: 100%;
    min-width: 0;
    min-height: 0;
    padding: var(--space-3);
    overflow: hidden;
  }
  .documentation-layout:not(.detail-active) {
    grid-template-columns: minmax(0, 1fr);
  }
  .documentation-navigation {
    display: grid;
    align-content: start;
    gap: var(--space-3);
    min-width: 0;
    min-height: 0;
    overflow: auto;
  }
  .mode-tabs {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.25rem;
  }
  [role='tab'] {
    min-height: 2.25rem;
    color: var(--color-text);
    background: transparent;
    border: 1px solid var(--color-border);
  }
  [role='tab'][aria-selected='true'] {
    color: var(--color-accent-contrast);
    background: var(--color-accent);
  }
  .search-controls {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: end;
    gap: var(--space-2);
  }
  label {
    display: grid;
    gap: 0.25rem;
    color: var(--color-text-muted);
    font-size: 0.75rem;
  }
  input[type='search'] {
    min-width: 0;
    min-height: 2rem;
    color: var(--color-text);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
  }
  .all-documentation {
    display: flex;
    align-items: center;
    min-height: 2rem;
    white-space: nowrap;
  }
  .navigation-content {
    min-width: 0;
  }
  nav[aria-label='Documentation history'] {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }
  nav[aria-label='Documentation history'] button {
    min-width: 0;
    color: var(--color-text);
    background: transparent;
    border: 1px solid var(--color-border);
    overflow-wrap: anywhere;
  }
  button:focus-visible,
  input:focus-visible {
    outline: 3px solid var(--color-focus);
    outline-offset: 2px;
  }
  @media (max-width: 48rem) {
    .documentation {
      height: auto;
    }
    .documentation-layout {
      display: block;
      height: auto;
      overflow: visible;
    }
    .documentation-navigation,
    .documentation-layout :global(article) {
      overflow: visible;
    }
    .documentation-layout.detail-active .documentation-navigation {
      display: none;
    }
    .search-controls {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  @media (forced-colors: active) {
    [role='tab'][aria-selected='true'] {
      color: HighlightText;
      background: Highlight;
      border-color: Highlight;
    }
  }
</style>
