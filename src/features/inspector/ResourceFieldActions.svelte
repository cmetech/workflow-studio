<script lang="ts">
  import { resolveResourceFieldSurface } from '$src/lib/packages/resource-actions'
  import type { ResourceResolutionContract } from '$src/lib/package-contract/resource-contract-loader'
  type Action = (opener: HTMLButtonElement) => void | Promise<void>
  interface Props {
    contract: ResourceResolutionContract
    fieldPath: string
    nodeKind: string
    scope: 'root' | 'body'
    inPackage: boolean
    artifactPath?: string
    inline?: boolean
    disabledReason?: string
    onSelect?: Action
    onCreate?: Action
    onExtract?: Action
    onOpen?: Action
    onReveal?: Action
    onHelp?: (topicId: string) => void
  }
  let {
    contract,
    fieldPath,
    nodeKind,
    scope,
    inPackage,
    artifactPath,
    inline = false,
    disabledReason,
    onSelect,
    onCreate,
    onExtract,
    onOpen,
    onReveal,
    onHelp,
  }: Props = $props()
  let busy = $state(false)
  let error = $state('')
  const surface = $derived(resolveResourceFieldSurface(contract, fieldPath, nodeKind, scope))
  const supported = $derived(Boolean(surface))
  const topicId = $derived(
    surface?.lookup_kind === 'script'
      ? 'guide:script-resources#runtime-resolution'
      : surface?.lookup_kind === 'command'
        ? 'guide:command-resources#frontmatter-and-preview'
        : 'guide:mcp-and-supporting-resources',
  )
  const mutationDisabled = $derived(busy || !inPackage || Boolean(disabledReason))
  async function invoke(action: Action | undefined, opener: HTMLButtonElement): Promise<void> {
    if (!action || busy) return
    busy = true
    error = ''
    try {
      await action(opener)
    } catch (cause: unknown) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      busy = false
    }
  }
</script>

{#if supported}
  <div role="group" aria-label="Package resource actions">
    <button
      type="button"
      disabled={mutationDisabled || inline || !onSelect}
      onclick={(event) => void invoke(onSelect, event.currentTarget)}>Select</button
    >
    <button
      type="button"
      disabled={mutationDisabled || inline || !onCreate}
      onclick={(event) => void invoke(onCreate, event.currentTarget)}>Create</button
    >
    <button
      type="button"
      disabled={busy || !artifactPath || !onOpen}
      onclick={(event) => void invoke(onOpen, event.currentTarget)}>Open</button
    >
    <button
      type="button"
      disabled={busy || !artifactPath || !onReveal}
      onclick={(event) => void invoke(onReveal, event.currentTarget)}>Reveal in Package</button
    >
    {#if inline}<button
        type="button"
        disabled={mutationDisabled || !onExtract}
        onclick={(event) => void invoke(onExtract, event.currentTarget)}>Extract to Resource</button
      >{/if}
    {#if onHelp}<button type="button" onclick={() => onHelp?.(topicId)}>Resource help</button>{/if}
  </div>
  {#if disabledReason}<p>{disabledReason}</p>{:else if !inPackage}<p>
      Add the workflow to a package to create or select resources.
    </p>{/if}
  {#if error}<p role="alert">{error}</p>{/if}
{/if}

<style>
  div {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
    margin-top: 0.5rem;
  }
  button {
    min-height: 2rem;
    border: 1px solid var(--color-border);
    border-radius: 0.25rem;
    padding: 0.25rem 0.5rem;
    color: var(--color-text);
    background: transparent;
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  button:focus-visible {
    outline: 3px solid var(--color-focus);
    outline-offset: 2px;
  }
  p {
    font-size: 0.75rem;
    color: var(--color-text-muted);
  }
  [role='alert'] {
    color: var(--color-error);
  }
</style>
