<script lang="ts">
  import { COLOR_THEMES, type ColorThemeId } from '$src/lib/branding/appearance'
  import type { ThemePreference } from '$src/lib/branding/types'

  interface Props {
    mode: ThemePreference
    colorTheme: ColorThemeId
    onMode: (mode: ThemePreference) => void
    onColorTheme: (theme: ColorThemeId) => void
  }

  const modes: readonly { readonly id: ThemePreference; readonly label: string; readonly description: string }[] = [
    { id: 'system', label: 'System', description: 'Follow your operating system appearance.' },
    { id: 'light', label: 'Light', description: 'Use a light workspace at all times.' },
    { id: 'dark', label: 'Dark', description: 'Use a dark workspace at all times.' },
  ]

  let { mode, colorTheme, onMode, onColorTheme }: Props = $props()

  function navigate<T extends string>(
    event: KeyboardEvent,
    choices: readonly { readonly id: T }[],
    current: T,
    select: (value: T) => void,
  ): void {
    const currentIndex = choices.findIndex(({ id }) => id === current)
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % choices.length
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
      nextIndex = (currentIndex - 1 + choices.length) % choices.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = choices.length - 1
    if (nextIndex === null) return

    event.preventDefault()
    const next = choices[nextIndex]
    if (!next) return
    select(next.id)
    const group = (event.currentTarget as HTMLElement).closest('[role="radiogroup"]')
    group?.querySelectorAll<HTMLElement>('[role="radio"]')[nextIndex]?.focus()
  }
</script>

<section class="appearance-settings" aria-labelledby="appearance-settings-title">
  <header>
    <h2 id="appearance-settings-title">Appearance</h2>
    <p>Choose the colors and brightness used throughout Workflow Studio.</p>
  </header>

  <fieldset>
    <legend>Color theme</legend>
    <div class="theme-grid" role="radiogroup" aria-label="Color theme">
      {#each COLOR_THEMES as theme (theme.id)}
        <button
          type="button"
          class="theme-card"
          role="radio"
          aria-label={theme.label}
          aria-checked={colorTheme === theme.id}
          tabindex={colorTheme === theme.id ? 0 : -1}
          onclick={() => onColorTheme(theme.id)}
          onkeydown={(event) => navigate(event, COLOR_THEMES, theme.id, onColorTheme)}
        >
          <span class="theme-preview" aria-hidden="true" style={`--preview-accent: ${theme.accents.light}`}>
            <span></span><span></span><span></span>
          </span>
          <strong>{theme.label}</strong>
          <span>{theme.description}</span>
        </button>
      {/each}
    </div>
  </fieldset>

  <fieldset>
    <legend>Brightness</legend>
    <div class="mode-grid" role="radiogroup" aria-label="Brightness">
      {#each modes as choice (choice.id)}
        <button
          type="button"
          class="mode-card"
          role="radio"
          aria-label={choice.label}
          aria-checked={mode === choice.id}
          tabindex={mode === choice.id ? 0 : -1}
          onclick={() => onMode(choice.id)}
          onkeydown={(event) => navigate(event, modes, choice.id, onMode)}
        >
          <strong>{choice.label}</strong>
          <span>{choice.description}</span>
        </button>
      {/each}
    </div>
  </fieldset>
</section>

<style>
  .appearance-settings,
  header,
  fieldset {
    display: grid;
    gap: 0.75rem;
    min-width: 0;
  }

  header h2,
  header p {
    margin: 0;
  }

  header p,
  button > span:last-child {
    color: var(--color-text-muted);
  }

  fieldset {
    padding: 0;
    border: 0;
    margin: 0;
  }

  legend {
    padding: 0;
    margin-bottom: 0.625rem;
    font-weight: 650;
  }

  .theme-grid,
  .mode-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.625rem;
  }

  .theme-card,
  .mode-card {
    display: grid;
    align-content: start;
    gap: 0.45rem;
    min-width: 0;
    min-height: 7rem;
    padding: 0.75rem;
    border: 1px solid var(--color-border);
    border-radius: 0.5rem;
    color: var(--color-text);
    background: var(--color-surface);
    text-align: left;
  }

  .mode-card {
    min-height: 5.5rem;
  }

  button[aria-checked='true'] {
    border-color: var(--color-accent);
    box-shadow: inset 0 0 0 1px var(--color-accent);
    background: var(--color-node-selected);
  }

  button:focus-visible {
    outline: 3px solid var(--color-focus);
    outline-offset: 2px;
  }

  button > span:last-child {
    overflow-wrap: anywhere;
    font-size: 0.8125rem;
    line-height: 1.35;
  }

  .theme-preview {
    display: grid;
    grid-template-columns: 0.7fr 1fr;
    grid-template-rows: repeat(2, 1fr);
    gap: 0.2rem;
    width: 100%;
    height: 2.75rem;
    padding: 0.3rem;
    border: 1px solid var(--color-border);
    border-radius: 0.35rem;
    background: var(--color-canvas);
    overflow: hidden;
  }

  .theme-preview span {
    display: block;
    border-radius: 0.15rem;
    background: color-mix(in srgb, var(--preview-accent) 22%, var(--color-surface));
  }

  .theme-preview span:first-child {
    grid-row: 1 / -1;
    background: var(--preview-accent);
  }

  @media (max-width: 48rem) {
    .theme-grid,
    .mode-grid {
      grid-template-columns: minmax(0, 1fr);
    }

    .theme-card,
    .mode-card {
      min-height: 0;
    }
  }

  @media (forced-colors: active) {
    button[aria-checked='true'] {
      border-color: Highlight;
      box-shadow: inset 0 0 0 1px Highlight;
    }
  }
</style>
