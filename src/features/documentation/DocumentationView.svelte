<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte'
  import DocumentationArticle from './DocumentationArticle.svelte'
  import DocumentationOverview from './DocumentationOverview.svelte'
  import DocumentationTopicList from './DocumentationTopicList.svelte'
  import { searchDocumentation } from '$src/lib/docs/build-index'
  import { commandRegistry, type CommandSurface } from '$src/lib/commands/registry'
  import type {
    DocumentationFocusOrigin,
    DocumentationIndex,
    DocumentationMode,
    DocumentationSearchMode,
    DocumentationTopic,
    ReferenceGroupId,
  } from '$src/lib/docs/types'
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
  let narrowPresentation = $state(window.matchMedia?.('(max-width: 48rem)').matches ?? false)
  let responsiveFocusOwned = false
  let presentationQuery: MediaQueryList | undefined
  let unsubscribeSession: (() => void) | undefined

  const documentationModes = ['overview', 'guides', 'reference'] as const satisfies readonly DocumentationMode[]
  const selected = $derived(session.selectedTopicId ? (index.byId.get(session.selectedTopicId) ?? null) : null)
  const presentationMode = $derived(modeForPresentation(session.mode, selected))
  const navigationMode = $derived<DocumentationMode>(transientNavigationMode ?? session.mode)
  const searchMode = $derived<DocumentationSearchMode>(
    session.searchScope === 'all' || navigationMode === 'overview' ? 'all' : navigationMode,
  )
  const topicListMode = $derived<DocumentationSearchMode>(
    session.query.trim() ? searchMode : navigationMode === 'overview' ? 'all' : navigationMode,
  )

  function modeForPresentation(mode: DocumentationMode, topic: DocumentationTopic | null): DocumentationMode {
    if (!topic) return mode
    const topicMode: DocumentationMode = topic.kind === 'guide' ? 'guides' : 'reference'
    return mode === topicMode ? mode : topicMode
  }

  function articleElement(): HTMLElement | undefined {
    return layout?.querySelector<HTMLElement>(':scope > article') ?? undefined
  }

  function backButton(): HTMLButtonElement | undefined {
    return articleElement()?.querySelector<HTMLButtonElement>('.back-to-results') ?? undefined
  }

  function captureFocusOrigin(opener: HTMLElement | undefined, topicId: string): DocumentationFocusOrigin | null {
    const key = opener?.dataset.documentationFocusOrigin
    return key ? { key, topicId } : null
  }

  function resolveFocusOrigin(origin: DocumentationFocusOrigin | null): HTMLElement | undefined {
    if (!origin || !layout) return undefined
    return [...layout.querySelectorAll<HTMLElement>('[data-documentation-focus-origin]')].find(
      (element) => element.dataset.documentationFocusOrigin === origin.key,
    )
  }

  function selectTopic(topic: DocumentationTopic, opener?: HTMLElement): void {
    const focused = document.activeElement
    const fromArticle = Boolean(opener && articleElement()?.contains(opener))
    responsiveFocusOwned =
      narrowPresentation ||
      (opener instanceof Node && navigation?.contains(opener) === true) ||
      (focused instanceof Node && navigation?.contains(focused) === true)
    updateDocumentationSession({
      selectedTopicId: topic.id,
      history: [topic.id, ...session.history.filter((id) => id !== topic.id)].slice(0, 5),
      articleScrollTop: 0,
      focusOrigin: fromArticle ? session.focusOrigin : captureFocusOrigin(opener, topic.id),
    })
    void revealSelectedTopic(topic.id, fromArticle)
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
    const focusOrigin = session.focusOrigin
    const selectedId = session.selectedTopicId
    responsiveFocusOwned = false
    transientNavigationMode = undefined
    updateDocumentationSession({
      selectedTopicId: undefined,
      articleScrollTop: article?.scrollTop ?? session.articleScrollTop,
      focusOrigin: null,
    })
    void tick().then(() => {
      const exactResult = selectedId ? document.getElementById(`documentation-result-${selectedId}`) : undefined
      const target = resolveFocusOrigin(focusOrigin) ?? exactResult ?? searchInput ?? selectedTab()
      target?.focus({ preventScroll: true })
      if (navigation) navigation.scrollTop = session.navigationScrollTop
    })
  }

  function selectedTab(): HTMLElement | undefined {
    const selectedTab = layout?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
    return selectedTab ?? undefined
  }

  function setMode(mode: DocumentationMode): void {
    transientNavigationMode = undefined
    const expandedGroupIds =
      mode === 'reference'
        ? [...session.expandedGroupIds.filter((id) => !id.startsWith('reference:')), 'reference:common-node-settings']
        : session.expandedGroupIds
    const scope: DocumentationSearchMode = session.searchScope === 'all' || mode === 'overview' ? 'all' : mode
    updateDocumentationSession({
      mode,
      selectedTopicId: undefined,
      highlightedTopicId: session.query.trim()
        ? searchDocumentation(index, session.query, { mode: scope })[0]?.id
        : undefined,
      expandedGroupIds,
      focusOrigin: null,
    })
  }

  function setAllDocumentation(checked: boolean): void {
    const scope: DocumentationSearchMode = checked || session.mode === 'overview' ? 'all' : session.mode
    const highlightedTopicId = session.query.trim()
      ? searchDocumentation(index, session.query, { mode: scope })[0]?.id
      : undefined
    updateDocumentationSession({ searchScope: checked ? 'all' : 'active-mode', highlightedTopicId })
  }

  function setQuery(query: string): void {
    const scope: DocumentationSearchMode =
      session.searchScope === 'all' || session.mode === 'overview' ? 'all' : session.mode
    const highlightedTopicId = query ? searchDocumentation(index, query, { mode: scope })[0]?.id : undefined
    updateDocumentationSession({ query, highlightedTopicId })
  }

  function browseReference(group: ReferenceGroupId): void {
    transientNavigationMode = undefined
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

  function modeTabKeydown(event: KeyboardEvent, currentIndex: number): void {
    let nextIndex: number | undefined
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (currentIndex + 1) % documentationModes.length
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (currentIndex - 1 + documentationModes.length) % documentationModes.length
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = documentationModes.length - 1
    }
    if (nextIndex === undefined) return
    event.preventDefault()
    const mode = documentationModes[nextIndex]
    if (!mode) return
    setMode(mode)
    void tick().then(() =>
      layout?.querySelector<HTMLElement>(`[data-documentation-mode="${mode}"]`)?.focus({ preventScroll: true }),
    )
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
        const target = resolveFocusOrigin(session.focusOrigin) ?? selectedTab()
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
        {#each documentationModes as mode, index (mode)}
          <button
            type="button"
            role="tab"
            aria-selected={presentationMode === mode}
            tabindex={presentationMode === mode ? 0 : -1}
            data-documentation-mode={mode}
            onclick={() => setMode(mode)}
            onkeydown={(event) => modeTabKeydown(event, index)}>{mode[0]?.toUpperCase()}{mode.slice(1)}</button
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
            oninput={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <label class="all-documentation">
          <input
            type="checkbox"
            checked={session.searchScope === 'all'}
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
            mode={topicListMode}
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
              <button
                type="button"
                data-documentation-focus-origin={`history:${topic.id}`}
                onclick={(event) => selectTopic(topic, event.currentTarget)}
              >
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
