<script lang="ts">
  import { tick } from 'svelte'
  import type { GitPairSnapshot } from '$src/lib/git/types'
  import type { CreateVersionOutcome } from '$src/lib/git/version-actions'
  import { gitState } from '$src/stores/git'
  import DiffView from './DiffView.svelte'
  import HistoryView from './HistoryView.svelte'
  import CreateVersionDialog from './CreateVersionDialog.svelte'
  import InitializeRepositoryDialog from './InitializeRepositoryDialog.svelte'
  import RepositoryIdentityDialog from './RepositoryIdentityDialog.svelte'

  interface Props {
    onSelectCommit: (oid: string) => Promise<GitPairSnapshot | null>
    currentDefinition?: string | undefined
    currentCompanion?: string | null | undefined
    onRestoreDraft?: ((snapshot: GitPairSnapshot) => void | Promise<void>) | undefined
    workspaceRoot?: string | undefined
    versionReady?: boolean | undefined
    findings?: readonly string[] | undefined
    onInitialize?: (() => void | Promise<void>) | undefined
    onSetIdentity?: ((identity: { userName: string; userEmail: string }) => void | Promise<void>) | undefined
    onCreateVersion?:
      ((message: string) => void | CreateVersionOutcome | Promise<void | CreateVersionOutcome>) | undefined
    embedded?: boolean
    availableWidth?: number
  }
  let {
    onSelectCommit,
    currentDefinition,
    currentCompanion,
    onRestoreDraft,
    workspaceRoot,
    versionReady = false,
    findings = [],
    onInitialize,
    onSetIdentity,
    onCreateVersion,
    embedded = false,
    availableWidth = Number.POSITIVE_INFINITY,
  }: Props = $props()
  let selected = $state<GitPairSnapshot | null>(null)
  let selectedOid = $state<string | undefined>()
  let previewError = $state<string | null>(null)
  let previewGeneration = 0
  let previewIdentity = ''
  let dialog = $state<'initialize' | 'identity' | 'create' | null>(null)
  let dialogOpener: HTMLElement | null = null

  $effect(() => {
    const inspection = $gitState.inspection
    const nextIdentity = `${inspection.repository?.root ?? ''}\0${inspection.pair?.definitionPath ?? ''}\0${inspection.pair?.companionPath ?? ''}`
    if (nextIdentity === previewIdentity) return
    previewIdentity = nextIdentity
    previewGeneration += 1
    selected = null
    selectedOid = undefined
    previewError = null
  })

  async function selectCommit(oid: string): Promise<void> {
    const request = ++previewGeneration
    selectedOid = oid
    previewError = null
    try {
      const snapshot = await onSelectCommit(oid)
      if (request !== previewGeneration || snapshot?.oid !== oid) return
      selected = snapshot
    } catch (error: unknown) {
      if (request !== previewGeneration) return
      selected = null
      previewError = error instanceof Error ? error.message : 'The historical workflow could not be loaded.'
    }
  }

  function restoreCommit(oid: string): void {
    if (selected?.oid !== oid || !onRestoreDraft) return
    void onRestoreDraft(selected)
  }

  async function initialize(): Promise<void> {
    await onInitialize?.()
    await closeDialog()
  }

  async function setIdentity(identity: { userName: string; userEmail: string }): Promise<void> {
    await onSetIdentity?.(identity)
    await closeDialog()
  }

  async function createVersion(message: string): Promise<void | CreateVersionOutcome> {
    const result = await onCreateVersion?.(message)
    if (!result || (result.status === 'committed' && result.warnings.length === 0)) await closeDialog()
    return result
  }

  function openDialog(kind: 'initialize' | 'identity' | 'create', event: MouseEvent): void {
    dialogOpener = event.currentTarget as HTMLElement
    dialog = kind
  }

  async function closeDialog(): Promise<void> {
    const opener = dialogOpener
    dialog = null
    dialogOpener = null
    await tick()
    opener?.focus()
  }
</script>

<section class="git-view" aria-labelledby={embedded ? undefined : 'git-view-title'}>
  {#if !embedded}<h2 id="git-view-title">Git</h2>{/if}
  {#if $gitState.phase === 'loading'}
    <p role="status">Refreshing local Git…</p>
  {:else if $gitState.phase === 'error'}
    <p role="alert">{$gitState.error}</p>
  {:else if $gitState.phase === 'idle'}
    <p>Open a workflow to inspect its local history.</p>
  {:else if !$gitState.inspection.repository}
    <p>This workspace is not a Git repository.</p>
    {#if workspaceRoot && onInitialize}
      <button type="button" onclick={(event) => openDialog('initialize', event)}>Initialize Git repository</button>
    {/if}
  {:else}
    {@const repository = $gitState.inspection.repository}
    <div class="git-page-grid">
      <section class="repository-card" aria-label="Local repository summary">
        <p class="repository">
          <span
            >{repository.branch
              ? `Branch: ${repository.branch}`
              : `Detached: ${repository.detachedHead ?? 'unknown'}`}</span
          >
          <span class="repository-root">{repository.root}</span>
        </p>
        <div class="actions">
          {#if onSetIdentity}<button type="button" onclick={(event) => openDialog('identity', event)}
              >Configure identity…</button
            >{/if}
          {#if $gitState.inspection.pair && onCreateVersion}
            <button type="button" onclick={(event) => openDialog('create', event)}>Create version…</button>
          {/if}
        </div>
        <section class="status-card" aria-labelledby="git-status-title">
          <h3 id="git-status-title">{$gitState.inspection.pair ? 'Pair status' : 'Workspace status'}</h3>
          {#if $gitState.inspection.status.entries.length === 0}
            <p>No {$gitState.inspection.pair ? 'pair' : 'workspace'} changes.</p>
          {:else}
            <ul>
              {#each $gitState.inspection.status.entries as entry (`${entry.path}:${entry.originalPath ?? ''}`)}
                <li>
                  <span class="status-path"
                    >{entry.index}{entry.worktree}
                    {entry.originalPath ? `${entry.originalPath} → ` : ''}{entry.path}</span
                  >
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      </section>
      {#if $gitState.inspection.pair}
        <div class="diff-column">
          <DiffView diff={$gitState.inspection.diff} {availableWidth} />
          {#if previewError}<p role="alert">{previewError}</p>{/if}
          {#if selected}
            <section class="preview" aria-labelledby="historical-preview-title">
              <h3 id="historical-preview-title">Historical preview</h3>
              {#if currentDefinition !== undefined}
                <h4>Current definition</h4>
                <pre aria-label="Current definition">{currentDefinition}</pre>
              {/if}
              <h4>Historical definition</h4>
              <pre aria-label="Historical definition">{selected.definition ?? 'Not present in this commit'}</pre>
              {#if currentCompanion !== undefined}
                <h4>Current companion</h4>
                <pre aria-label="Current companion">{currentCompanion ?? 'Not present in the current draft'}</pre>
              {/if}
              <h4>Historical companion</h4>
              <pre aria-label="Historical companion">{selected.companion ?? 'Not present in this commit'}</pre>
            </section>
          {/if}
        </div>
        <div class="history-column">
          <HistoryView
            history={$gitState.inspection.history}
            {selectedOid}
            onSelect={selectCommit}
            onRestore={onRestoreDraft ? restoreCommit : undefined}
          />
        </div>
      {:else}
        <p class="pair-empty">Open a workflow to inspect its exact diff and history.</p>
      {/if}
    </div>
  {/if}
</section>

{#if dialog === 'initialize' && workspaceRoot}
  <InitializeRepositoryDialog root={workspaceRoot} onConfirm={initialize} onCancel={() => void closeDialog()} />
{:else if dialog === 'identity' && $gitState.inspection.repository}
  <RepositoryIdentityDialog
    root={$gitState.inspection.repository.root}
    onSave={setIdentity}
    onCancel={() => void closeDialog()}
  />
{:else if dialog === 'create' && $gitState.inspection.pair}
  <CreateVersionDialog
    files={[
      $gitState.inspection.pair.definitionPath,
      ...($gitState.inspection.pair.companionPath ? [$gitState.inspection.pair.companionPath] : []),
    ]}
    diff={`${$gitState.inspection.diff.working}${$gitState.inspection.diff.working && $gitState.inspection.diff.index ? '\n' : ''}${$gitState.inspection.diff.index}`}
    {findings}
    ready={versionReady}
    onCreate={createVersion}
    onCancel={() => void closeDialog()}
  />
{/if}

<style>
  .git-view {
    width: 100%;
    min-width: 0;
    max-width: 100%;
    padding: 0.75rem;
  }
  h2,
  h3 {
    margin-top: 0;
  }
  .repository {
    display: grid;
    gap: 0.25rem;
    min-width: 0;
    margin-top: 0;
    color: var(--color-focus);
  }
  .repository-root,
  .status-path {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .repository-root {
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    font-size: 0.75rem;
  }
  .git-page-grid {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(16rem, 1fr);
    gap: var(--space-4);
    min-width: 0;
  }
  .pair-empty {
    grid-column: 1 / -1;
  }
  .repository-card,
  .diff-column,
  .history-column,
  .status-card,
  .preview {
    min-width: 0;
  }
  .repository-card {
    grid-column: 1;
    grid-row: 1;
  }
  .history-column {
    grid-column: 2;
    grid-row: 1;
  }
  .diff-column {
    grid-column: 1 / -1;
    grid-row: 2;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }
  ul {
    display: grid;
    gap: var(--space-1);
    padding-left: 1.25rem;
    font-family: var(--font-mono);
    font-size: 0.75rem;
  }
  li {
    min-width: 0;
  }
  .preview {
    display: grid;
    gap: 0.375rem;
  }
  .preview {
    gap: 0.75rem;
    margin-top: 0.75rem;
  }
  .preview pre {
    max-width: 100%;
    min-height: 4rem;
    margin: 0;
    overflow: auto;
    padding: 0.5rem;
    color: var(--color-text);
    background: var(--color-yaml-gutter);
    font-family: var(--font-mono);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  @media (max-width: 48rem) {
    .git-page-grid {
      grid-template-columns: minmax(0, 1fr);
    }
    .repository-card,
    .diff-column,
    .history-column,
    .pair-empty {
      grid-column: 1;
      grid-row: auto;
    }
  }
</style>
