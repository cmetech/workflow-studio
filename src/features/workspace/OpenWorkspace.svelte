<script lang="ts">
  import type { RecentWorkspace } from '$src/lib/workspace/recent-workspaces'
  import X from 'lucide-svelte/icons/x'

  interface Props {
    recent?: readonly RecentWorkspace[]
    disabled?: boolean
    onOpen?: (rootPath?: string) => void | Promise<void>
    onDropPath?: (path: string) => void | Promise<void>
    onRemoveRecent?: (rootPath: string) => void | Promise<void>
    onClearUnavailable?: () => void | Promise<void>
  }

  let { recent = [], disabled = false, onOpen, onDropPath, onRemoveRecent, onClearUnavailable }: Props = $props()

  function droppedPath(event: DragEvent): string | null {
    event.preventDefault()
    if (disabled) return null
    const first = event.dataTransfer?.files[0] as (File & { path?: string }) | undefined
    return first?.path ?? null
  }
</script>

<section
  class="open-workspace"
  aria-label="Open workspace drop zone"
  ondragover={(event) => event.preventDefault()}
  ondrop={(event) => {
    const path = droppedPath(event)
    if (path) void onDropPath?.(path)
  }}
>
  <div>
    <p class="eyebrow">LOCAL WORKFLOWS</p>
    <h2 id="open-workspace-heading">Open a workspace folder</h2>
    <p>Choose or drop a folder. Workflow Studio works fully offline and keeps YAML as the only workflow authority.</p>
    <button type="button" data-variant="primary" {disabled} onclick={() => !disabled && void onOpen?.(undefined)}
      >Open Folder</button
    >
  </div>

  {#if recent.length > 0}
    <nav aria-label="Recent folders">
      <div class="recent-heading">
        <h3>Recent folders</h3>
        {#if recent.some((item) => !item.available)}
          <button
            class="clear-unavailable"
            type="button"
            data-variant="ghost"
            {disabled}
            onclick={() => !disabled && void onClearUnavailable?.()}>Clear unavailable folders</button
          >
        {/if}
      </div>
      {#each recent as item (item.rootPath)}
        <div class="recent-row">
          <button
            class="recent-open"
            type="button"
            disabled={disabled || !item.available}
            aria-label={`${item.rootPath}${item.available ? '' : ' unavailable'}`}
            onclick={() => !disabled && void onOpen?.(item.rootPath)}
          >
            <span>{item.rootPath}</span>
            <small>{item.available ? 'Open' : 'Unavailable'}</small>
          </button>
          <button
            class="recent-remove"
            type="button"
            data-variant="ghost"
            {disabled}
            aria-label={`Remove ${item.rootPath} from recent folders`}
            title={`Remove ${item.rootPath} from recent folders`}
            onclick={() => !disabled && void onRemoveRecent?.(item.rootPath)}
          >
            <X size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      {/each}
    </nav>
  {/if}
</section>

<style>
  .open-workspace {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(14rem, 22rem);
    gap: 2rem;
    width: min(56rem, 100%);
    min-width: 0;
    max-width: 100%;
    margin: auto;
    padding: clamp(1rem, 4vw, 2rem);
    border: 1px dashed var(--color-edge);
    border-radius: 0.75rem;
    background: var(--color-surface);
  }

  h2,
  h3,
  p {
    margin: 0 0 0.75rem;
  }

  .eyebrow {
    color: var(--color-accent-strong-on-surface);
    font-size: 0.6875rem;
    font-weight: 800;
    letter-spacing: 0.12em;
  }

  nav {
    display: grid;
    gap: 0.375rem;
    align-content: start;
    min-width: 0;
  }

  .recent-heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .recent-heading h3 {
    min-width: 0;
  }

  .clear-unavailable {
    flex: 0 0 auto;
    padding: 0;
    border: 0;
    color: var(--color-accent-strong-on-surface);
    background: transparent;
    font-size: 0.75rem;
  }

  .recent-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.25rem;
    min-width: 0;
  }

  .recent-open {
    display: flex;
    justify-content: space-between;
    width: 100%;
    min-width: 0;
    color: var(--color-text);
    background: var(--color-node);
  }

  .recent-open span {
    min-width: 0;
    max-width: 100%;
    white-space: normal;
    overflow-wrap: anywhere;
    text-align: left;
  }

  .recent-open small {
    flex: 0 0 auto;
  }

  .recent-remove {
    display: inline-grid;
    place-items: center;
    padding-inline: 0.625rem;
    color: var(--color-text-muted);
  }

  nav button:disabled {
    opacity: 0.62;
    cursor: not-allowed;
  }

  @media (max-width: 44rem) {
    .open-workspace {
      grid-template-columns: 1fr;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .open-workspace,
    button {
      transition: none;
    }
  }
</style>
