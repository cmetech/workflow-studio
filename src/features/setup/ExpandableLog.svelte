<script lang="ts">
  import { tick } from 'svelte'

  interface Props {
    expanded: boolean
    lines: readonly string[]
    label?: string
    dataAttribute?: 'setup' | 'update'
  }

  let { expanded, lines, label = 'Setup output', dataAttribute = 'setup' }: Props = $props()
  let logElement = $state<HTMLElement>()
  let nearBottom = true

  function rememberPosition(): void {
    if (!logElement) return
    nearBottom = logElement.scrollHeight - logElement.scrollTop - logElement.clientHeight <= 24
  }

  $effect(() => {
    if (!expanded || !nearBottom || lines.length === 0) return
    void tick().then(() => {
      if (!logElement || !nearBottom) return
      if (typeof logElement.scrollTo === 'function') {
        logElement.scrollTo({ top: logElement.scrollHeight, behavior: 'auto' })
      } else logElement.scrollTop = logElement.scrollHeight
    })
  })
</script>

{#if expanded}
  <textarea
    bind:this={logElement}
    data-setup-log={dataAttribute === 'setup' ? '' : undefined}
    data-update-log={dataAttribute === 'update' ? '' : undefined}
    readonly
    aria-label={label}
    value={lines.join('\n')}
    onscroll={rememberPosition}></textarea>
{/if}

<style>
  textarea {
    box-sizing: border-box;
    width: 100%;
    min-height: 9rem;
    max-height: 13rem;
    padding: 0.75rem;
    resize: vertical;
    overflow: auto;
    border: 1px solid var(--color-border);
    border-radius: 0.375rem;
    color: var(--color-text);
    background: var(--color-yaml-gutter);
    font-family: var(--font-mono);
    font-size: 0.75rem;
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
