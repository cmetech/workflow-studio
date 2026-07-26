<script lang="ts">
  import type { RecentWorkspace } from '$src/lib/workspace/recent-workspaces'

  interface Props {
    recent?: readonly RecentWorkspace[]
    onOpen?: (rootPath?: string) => void | Promise<void>
    onDropPath?: (path: string) => void | Promise<void>
  }

  let { recent = [], onOpen, onDropPath }: Props = $props()

  function droppedPath(event: DragEvent): string | null {
    event.preventDefault()
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
    <p>Choose or drop a folder. Workflow Studio keeps YAML as the only workflow authority.</p>
    <button type="button" onclick={() => void onOpen?.(undefined)}>Open Folder</button>
  </div>

  {#if recent.length > 0}
    <nav aria-label="Recent folders">
      <h3>Recent folders</h3>
      {#each recent as item (item.rootPath)}
        <button
          type="button"
          disabled={!item.available}
          aria-label={`${item.rootPath}${item.available ? '' : ' unavailable'}`}
          onclick={() => void onOpen?.(item.rootPath)}
        >
          <span>{item.rootPath}</span>
          <small>{item.available ? 'Open' : 'Unavailable'}</small>
        </button>
      {/each}
    </nav>
  {/if}
</section>

<style>
  .open-workspace {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(14rem, 22rem);
    gap: 2rem;
    width: min(56rem, calc(100% - 4rem));
    margin: auto;
    padding: 2rem;
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
    color: var(--color-accent-strong);
    font-size: 0.6875rem;
    font-weight: 800;
    letter-spacing: 0.12em;
  }

  nav {
    display: grid;
    gap: 0.375rem;
    align-content: start;
  }

  nav button {
    display: flex;
    justify-content: space-between;
    width: 100%;
    min-width: 0;
    color: var(--color-text);
    background: var(--color-node);
  }

  nav button span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
