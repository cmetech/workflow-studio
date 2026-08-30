<script lang="ts">
  import ModalShell from '$src/app/ModalShell.svelte'
  import type { WorkspaceEntry } from '$src/lib/workspace/types'

  interface Props {
    entries: readonly WorkspaceEntry[]
    onOpen?: (entry: WorkspaceEntry) => void | Promise<void>
    onClose?: () => void
    opener?: HTMLElement | undefined
  }

  let { entries, onOpen, onClose, opener }: Props = $props()
  let query = $state('')
  let activeIndex = $state(0)
  const results = $derived(
    entries
      .filter((entry) => entry.kind === 'workflow')
      .filter((entry) =>
        `${entry.name}\n${entry.relativePath}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
      ),
  )
  const activeOption = $derived(results[activeIndex])
  const activeOptionId = $derived(activeOption ? `quick-open-option-${optionId(activeOption.id)}` : undefined)

  function optionId(id: string): string {
    return id.replace(/[^a-zA-Z0-9_-]/g, '-')
  }

  function close(): void {
    onClose?.()
  }

  async function open(index: number): Promise<void> {
    const entry = results[index]
    if (!entry) return
    const focusTarget = opener
    await onOpen?.(entry)
    focusTarget?.focus()
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      activeIndex = Math.min(activeIndex + 1, results.length - 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      activeIndex = Math.max(activeIndex - 1, 0)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      void open(activeIndex)
    }
  }
</script>

<ModalShell
  titleId="quick-open-title"
  opener={opener ?? null}
  onCancel={close}
  initialFocusSelector="[data-modal-initial-focus]"
>
  <h2 id="quick-open-title" class="visually-hidden">Quick Open</h2>
  <input
    data-modal-initial-focus
    role="combobox"
    aria-label="Quick Open workflows"
    aria-controls="quick-open-results"
    aria-expanded="true"
    aria-autocomplete="list"
    aria-activedescendant={activeOptionId}
    bind:value={query}
    oninput={() => (activeIndex = 0)}
    onkeydown={handleKeydown}
    placeholder="Search workflow name or path"
  />
  <div id="quick-open-results" role="listbox" aria-label="Workflow matches">
    {#each results as entry, index (entry.id)}
      <button
        id={`quick-open-option-${optionId(entry.id)}`}
        type="button"
        role="option"
        aria-selected={index === activeIndex}
        onmouseenter={() => (activeIndex = index)}
        onclick={() => void open(index)}
      >
        <strong>{entry.name}</strong><span>{entry.relativePath}</span>
      </button>
    {/each}
  </div>
  {#snippet actions()}
    <button type="button" data-variant="secondary" aria-label="Close Quick Open" onclick={close}>Close</button>
  {/snippet}
</ModalShell>

<style>
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  input,
  button {
    width: 100%;
  }

  input {
    box-sizing: border-box;
    min-height: 2.5rem;
    padding: 0.5rem 0.625rem;
    border: 1px solid var(--color-border);
    color: var(--color-text);
    background: var(--color-background);
  }

  [role='listbox'] {
    min-width: 0;
  }

  [role='option'] {
    display: grid;
    grid-template-columns: 12rem minmax(0, 1fr);
    gap: 1rem;
    justify-items: start;
    min-height: 2.25rem;
    border: 0;
    color: var(--color-text);
    background: transparent;
    text-align: left;
  }

  [role='option'][aria-selected='true'] {
    background: var(--color-node-selected);
  }

  [role='option'] span {
    min-width: 0;
    color: var(--color-text-muted);
    overflow-wrap: anywhere;
  }

  @media (max-width: 30rem) {
    [role='option'] {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
