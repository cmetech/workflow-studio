<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { normalizeAccent, toNativeColorValue } from '$src/lib/branding/appearance'

  interface Props {
    accent: string | null
    fallbackAccent: string
    onAccent: (accent: string) => void
    onReset: () => void
  }

  let { accent, fallbackAccent, onAccent, onReset }: Props = $props()
  let picker: HTMLDivElement | undefined = $state()
  let trigger: HTMLButtonElement | undefined = $state()
  let textInput: HTMLInputElement | undefined = $state()
  let open = $state(false)
  let draft = $state('')
  let previousFallbackAccent = $state('')
  const normalizedDraft = $derived(normalizeAccent(draft))
  const displayedAccent = $derived(accent ?? fallbackAccent)
  const nativeColorValue = $derived(toNativeColorValue(normalizedDraft ?? fallbackAccent))

  $effect(() => {
    const nextFallbackAccent = fallbackAccent
    if (open && accent === null && draft === previousFallbackAccent) draft = nextFallbackAccent
    previousFallbackAccent = nextFallbackAccent
  })

  async function openPicker(): Promise<void> {
    draft = accent ?? fallbackAccent
    open = true
    await tick()
    textInput?.focus()
    textInput?.select()
  }

  async function closePicker(restoreFocus = false): Promise<void> {
    open = false
    if (!restoreFocus) return
    await tick()
    trigger?.focus()
  }

  function applyAccent(): void {
    if (!normalizedDraft) return
    onAccent(normalizedDraft)
    void closePicker(true)
  }

  function resetAccent(): void {
    onReset()
    void closePicker(true)
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    void closePicker(true)
  }

  onMount(() => {
    const handlePointerDown = (event: PointerEvent): void => {
      if (open && event.target instanceof Node && !picker?.contains(event.target)) void closePicker()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  })
</script>

<div class="accent-picker" bind:this={picker}>
  <button
    bind:this={trigger}
    type="button"
    class="accent-trigger"
    aria-label="Choose custom accent"
    aria-haspopup="dialog"
    aria-expanded={open}
    onclick={openPicker}
  >
    <span aria-hidden="true" style:background-color={displayedAccent}></span>
  </button>

  {#if open}
    <div class="accent-popover" role="dialog" aria-label="Custom accent" tabindex="-1" onkeydown={handleKeydown}>
      <label>
        <span>Hex accent</span>
        <input bind:this={textInput} type="text" inputmode="text" maxlength="7" spellcheck="false" bind:value={draft} />
      </label>
      <label class="native-picker">
        <span>Accent color</span>
        <input
          type="color"
          value={nativeColorValue}
          oninput={(event) => (draft = event.currentTarget.value.toUpperCase())}
        />
      </label>
      <div class="accent-actions">
        <button type="button" data-variant="ghost" onclick={resetAccent}>Reset to selected palette</button>
        <button type="button" data-variant="primary" disabled={normalizedDraft === null} onclick={applyAccent}
          >Apply accent</button
        >
      </div>
    </div>
  {/if}
</div>

<style>
  .accent-picker {
    position: relative;
    flex: 0 0 auto;
  }

  .accent-trigger {
    display: grid;
    width: 1.5rem;
    height: 1.5rem;
    padding: 0.2rem;
    border: 1px solid var(--color-border);
    border-radius: 999px;
    background: var(--color-surface);
    place-items: center;
  }

  .accent-trigger span {
    width: 100%;
    height: 100%;
    border-radius: inherit;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, currentColor 22%, transparent);
  }

  .accent-popover {
    position: absolute;
    z-index: 60;
    right: 0;
    bottom: calc(100% + 0.5rem);
    display: grid;
    gap: 0.625rem;
    width: 17rem;
    max-width: calc(100vw - 1rem);
    padding: 0.75rem;
    border: 1px solid var(--color-border);
    border-radius: 0.5rem;
    color: var(--color-text);
    background: var(--color-surface-elevated);
    box-shadow: 0 0.5rem 1.5rem var(--color-shadow);
    font-family: var(--font-sans);
    font-size: 0.8125rem;
  }

  label {
    display: grid;
    gap: 0.3rem;
    min-width: 0;
  }

  label > span {
    font-weight: 650;
  }

  input[type='text'] {
    min-width: 0;
    width: 100%;
    padding: 0.45rem 0.55rem;
    border: 1px solid var(--color-border);
    border-radius: 0.35rem;
    color: var(--color-text);
    background: var(--color-surface);
    font: inherit;
    font-family: var(--font-mono);
    text-transform: uppercase;
  }

  .native-picker {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
  }

  input[type='color'] {
    width: 3rem;
    height: 2rem;
    padding: 0.15rem;
    border: 1px solid var(--color-border);
    border-radius: 0.35rem;
    background: var(--color-surface);
  }

  .accent-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.5rem;
  }

  button:focus-visible,
  input:focus-visible {
    outline: 3px solid var(--color-focus);
    outline-offset: 2px;
  }

  @media (max-width: 24rem) {
    .accent-popover {
      right: -0.25rem;
    }

    .accent-actions {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
    }
  }

  @media (forced-colors: active) {
    .accent-trigger,
    .accent-popover,
    input {
      border-color: CanvasText;
    }
  }
</style>
