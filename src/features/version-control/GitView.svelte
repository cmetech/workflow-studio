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

<section class="git-view" aria-labelledby="git-view-title">
  <h2 id="git-view-title">Git</h2>
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
    <p class="repository">
      {repository.branch ? `Branch: ${repository.branch}` : `Detached: ${repository.detachedHead ?? 'unknown'}`}
    </p>
    <div class="actions">
      {#if onSetIdentity}<button type="button" onclick={(event) => openDialog('identity', event)}
          >Configure identity…</button
        >{/if}
      {#if $gitState.inspection.pair && onCreateVersion}
        <button type="button" onclick={(event) => openDialog('create', event)}>Create version…</button>
      {/if}
    </div>
    <section aria-labelledby="git-status-title">
      <h3 id="git-status-title">{$gitState.inspection.pair ? 'Pair status' : 'Workspace status'}</h3>
      {#if $gitState.inspection.status.entries.length === 0}
        <p>No {$gitState.inspection.pair ? 'pair' : 'workspace'} changes.</p>
      {:else}
        <ul>
          {#each $gitState.inspection.status.entries as entry (`${entry.path}:${entry.originalPath ?? ''}`)}
            <li>{entry.index}{entry.worktree} {entry.originalPath ? `${entry.originalPath} → ` : ''}{entry.path}</li>
          {/each}
        </ul>
      {/if}
    </section>
    {#if $gitState.inspection.pair}
      <DiffView diff={$gitState.inspection.diff} />
      <HistoryView
        history={$gitState.inspection.history}
        {selectedOid}
        onSelect={selectCommit}
        onRestore={onRestoreDraft ? restoreCommit : undefined}
      />
    {:else}
      <p>Open a workflow to inspect its exact diff and history.</p>
    {/if}
    {#if previewError}<p role="alert">{previewError}</p>{/if}
    {#if selected && $gitState.inspection.pair}
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
    height: 100%;
    overflow: auto;
    padding: 0.75rem;
  }
  h2,
  h3 {
    margin-top: 0;
  }
  .repository {
    color: var(--color-focus);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }
  ul {
    padding-left: 1.25rem;
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
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
    min-height: 4rem;
    margin: 0;
    overflow: auto;
    padding: 0.5rem;
    color: var(--color-text);
    background: var(--color-yaml-gutter);
    font-family: ui-monospace, monospace;
    white-space: pre-wrap;
  }
</style>
