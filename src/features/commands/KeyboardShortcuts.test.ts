import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import KeyboardShortcuts from './KeyboardShortcuts.svelte'
import { createCommandRegistry } from '$src/lib/commands/registry'

describe('KeyboardShortcuts', () => {
  it('shows platform-correct registry bindings and filters by label', async () => {
    const registry = createCommandRegistry()
    registry.registerCommand({
      id: 'document.save',
      label: 'Save Workflow Pair',
      category: 'File',
      defaultBindings: ['Mod+S'],
      enabled: () => true,
      run: () => undefined,
    })
    render(KeyboardShortcuts, { props: { registry, platform: 'mac' } })
    expect(screen.getByText('⌘S')).toBeVisible()
    await fireEvent.input(screen.getByRole('searchbox', { name: 'Search keyboard shortcuts' }), {
      target: { value: 'save' },
    })
    expect(screen.getByText('Save Workflow Pair')).toBeVisible()
  })
})
