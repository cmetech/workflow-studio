<script lang="ts">
  import ModalShell from '$src/app/ModalShell.svelte'
  import TransactionRecoveryDetails from './TransactionRecoveryDetails.svelte'
  import PackageReadiness from './PackageReadiness.svelte'
  import PackageChangeList from './PackageChangeList.svelte'
  import type { PreparePackageView } from './prepare-package-view'
  interface Props {
    packageId: string
    currentVersion: string
    view: PreparePackageView
    onValidate: () => void | Promise<void>
    onAcceptReview: () => void | Promise<void>
    onPrepare: (request: { version: string; message: string }) => void | Promise<void>
    onCommit: (request: { version: string; message: string }) => void | Promise<void>
    onCancel: () => void
    onHelp: (topic: string) => void
    onOpenArtifact?: (path: string, line?: number, column?: number) => void
    opener?: HTMLElement | null
  }
  let {
    packageId,
    currentVersion,
    view,
    onValidate,
    onAcceptReview,
    onPrepare,
    onCommit,
    onCancel,
    onHelp,
    onOpenArtifact,
    opener = null,
  }: Props = $props()
  let pending = $state(false)
  let localError = $state('')
  let version = $state('')
  let message = $state('')
  let draftKey = $state('')
  const busy = $derived(pending || (view.step !== 'complete' && !!view.busy))
  const ready = $derived(view.step !== 'complete' && !!view.analysis?.ready && !view.analysis.blockers.length)
  const previewMatches = $derived(
    view.step === 'version' && view.finalPreview?.version === version && view.finalPreview.message === message,
  )
  $effect(() => {
    if (view.step !== 'review' && view.step !== 'version') return
    const key = `${packageId}:${view.suggestedVersion}`
    if (key === draftKey) return
    draftKey = key
    version = view.suggestedVersion
    message = `Prepare ${packageId} ${view.suggestedVersion}`
  })
  async function act(callback: () => void | Promise<void>): Promise<void> {
    if (busy) return
    pending = true
    localError = ''
    try {
      await callback()
    } catch (cause: unknown) {
      localError = cause instanceof Error ? cause.message : String(cause)
    } finally {
      pending = false
    }
  }
</script>

<ModalShell
  titleId="prepare-package-title"
  {opener}
  {busy}
  dismissible={!busy}
  {onCancel}
  initialFocusSelector="[data-prepare-focus]"
>
  <h2 id="prepare-package-title" tabindex="-1" data-prepare-focus>
    {view.step === 'complete' ? 'Prepared locally' : 'Prepare package locally'}
  </h2>
  <p><strong>{packageId}</strong> · Current version {currentVersion}</p>
  <ol aria-label="Preparation steps">
    <li aria-current={view.step === 'validate' ? 'step' : undefined}>Validate</li>
    <li aria-current={view.step === 'review' ? 'step' : undefined}>Review Changes</li>
    <li aria-current={view.step === 'version' ? 'step' : undefined}>Version &amp; Commit</li>
  </ol>
  {#if view.step === 'complete'}
    <p>Version {view.version} is committed in your local repository.</p>
    <p>Commit <code>{view.commitOid}</code></p>
    <ul aria-label="Committed files">
      {#each view.includedPaths as path, index (`${path}:${index}`)}<li><code>{path}</code></li>{/each}
    </ul>
    {#if view.warnings?.length}<section role="status" aria-label="Preparation warnings">
        <ul>
          {#each view.warnings as warning, index (index)}<li>{warning}</li>{/each}
        </ul>
      </section>{/if}
    <p>Use your Git client to push this commit when you are ready.</p>
    <button type="button" onclick={() => onHelp('guide:publishing-packages-with-git')}>Read Git handoff guidance</button
    >
  {:else}
    {#if view.step === 'validate'}
      <PackageReadiness analysis={view.analysis ?? null} {...onOpenArtifact ? { onOpenArtifact } : {}} {onHelp} />
      <button type="button" onclick={() => onHelp('guide:preparing-packages')}>Read preparation guidance</button>
    {:else}
      <PackageChangeList changes={view.changes} includedPaths={view.includedPaths} trustChanges={view.trustChanges} />
      {#if view.step === 'version'}
        <p>Suggested version: <strong>{view.suggestedVersion}</strong></p>
        <ul>
          {#each view.suggestionReasons as reason, index (index)}<li>{reason}</li>{/each}
        </ul>
        <fieldset disabled={busy}>
          <label>Version<input bind:value={version} /></label>
          <label>Commit message<textarea bind:value={message}></textarea></label>
        </fieldset>
        {#if view.finalPreview}
          <section aria-label="Final local commit diff">
            <h3>Final local commit diff</h3>
            {#if !previewMatches}<p role="status">
                Version or message changed. Prepare a new preview before committing.
              </p>{/if}
            <pre><code>{view.finalPreview.diff}</code></pre>
          </section>
        {:else}<p>Prepare a preview to review the exact local commit diff.</p>{/if}
        <p>Commit local version creates a local Git commit containing the reviewed files.</p>
        <button type="button" onclick={() => onHelp('guide:package-versions-digests-trust')}
          >Read version and trust guidance</button
        >
      {/if}
    {/if}
    {#if view.error || localError}
      <section role="alert">
        <p>{localError || view.error?.message}</p>
        {#if view.error}<ul>
            {#each view.error.recovery as action, index (index)}<li>{action}</li>{/each}
          </ul>{/if}
        {#if view.error}
          <TransactionRecoveryDetails
            receipt={{
              pathResults: view.error.pathResults ?? [],
              omittedPathResults: view.error.omittedPathResults ?? 0,
            }}
          />
        {/if}
        <button type="button" onclick={() => onHelp('guide:package-troubleshooting#preparation-failures')}
          >Read preparation troubleshooting</button
        >
      </section>
    {/if}
  {/if}
  {#if view.recovery}<TransactionRecoveryDetails receipt={view.recovery} title="Retained recovery files" />{/if}
  {#snippet actions()}
    <button type="button" disabled={busy} onclick={onCancel}>{view.step === 'complete' ? 'Done' : 'Cancel'}</button>
    {#if view.step === 'validate'}
      <button type="button" disabled={busy} onclick={() => void act(onValidate)}
        >{busy ? 'Validating...' : 'Validate package'}</button
      >
    {:else if view.step === 'review'}
      <button
        type="button"
        disabled={busy || !ready}
        onclick={() => {
          if (ready) void act(onAcceptReview)
        }}>Review version and commit</button
      >
    {:else if view.step === 'version'}
      <button
        type="button"
        disabled={busy || !ready || !version.trim() || !message.trim()}
        onclick={() => {
          if (ready && version.trim() && message.trim()) void act(() => onPrepare({ version, message }))
        }}>{busy ? 'Working locally...' : 'Prepare preview'}</button
      >
      <button
        type="button"
        disabled={busy || !ready || !previewMatches || !version.trim() || !message.trim()}
        onclick={() => {
          if (ready && previewMatches && version.trim() && message.trim())
            void act(() => onCommit({ version, message }))
        }}>Commit local version</button
      >
    {/if}
  {/snippet}
</ModalShell>

<style>
  h2 {
    margin-top: 0;
  }
  ol {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem 2rem;
    padding-left: 1.25rem;
  }
  [aria-current='step'] {
    font-weight: 700;
  }
  fieldset {
    border: 0;
    padding: 0;
    display: grid;
    gap: 0.75rem;
  }
  label {
    display: grid;
    gap: 0.25rem;
  }
  input,
  textarea {
    box-sizing: border-box;
    width: 100%;
    padding: 0.5rem;
    color: var(--color-text);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 0.25rem;
  }
  input:focus-visible,
  textarea:focus-visible {
    outline: 3px solid var(--color-focus);
    outline-offset: 2px;
  }
  pre {
    overflow: auto;
    max-height: 24rem;
    white-space: pre;
    padding: 0.75rem;
    border: 1px solid var(--color-border);
  }
  code {
    overflow-wrap: anywhere;
  }
  [role='alert'] {
    color: var(--color-error);
  }
</style>
