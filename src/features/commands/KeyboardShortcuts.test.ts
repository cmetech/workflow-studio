import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import KeyboardShortcuts from './KeyboardShortcuts.svelte'
import { createCommandRegistry } from '$src/lib/commands/registry'

describe('KeyboardShortcuts', () => {
  it('groups live registry commands and canvas interactions with semantic platform keys', () => {
    const registry = createCommandRegistry()
    registry.registerCommand({
      id: 'document.save',
      label: 'Save Workflow Pair',
      category: 'File',
      defaultBindings: ['Mod+S'],
      enabled: () => true,
      run: () => undefined,
    })
    registry.registerCommand({
      id: 'document.find',
      label: 'Find',
      category: 'Edit',
      defaultBindings: ['Mod+F'],
      enabled: (context) => context.surface === 'yaml',
      run: () => undefined,
    })

    render(KeyboardShortcuts, { props: { registry, platform: 'mac', variant: 'documentation' } })

    expect(screen.getByRole('heading', { name: 'File' })).toBeVisible()
    expect(screen.getByText('⌘S', { selector: 'kbd' })).toBeVisible()
    expect(screen.getByText('Global')).toBeVisible()
    expect(screen.getByText('Space + drag', { selector: 'kbd' })).toBeVisible()
    expect(screen.getByText('N C', { selector: 'kbd' })).toBeVisible()
    expect(screen.getByText('Run Save Workflow Pair.')).toBeVisible()
  })

  it('searches labels, categories, contexts, and displayed bindings in both variants', async () => {
    const registry = createCommandRegistry()
    registry.registerCommand({
      id: 'document.find',
      label: 'Find',
      category: 'Edit',
      defaultBindings: ['Mod+F'],
      enabled: (context) => context.surface === 'yaml',
      run: () => undefined,
    })
    render(KeyboardShortcuts, { props: { registry, platform: 'mac', variant: 'compact' } })

    const search = screen.getByRole('searchbox', { name: 'Search keyboard shortcuts' })
    await fireEvent.input(search, { target: { value: 'canvas space' } })
    expect(screen.getByText('Pan canvas')).toBeVisible()

    await fireEvent.input(search, { target: { value: 'yaml find' } })
    expect(screen.getByText('Find')).toBeVisible()
    expect(screen.getByText('Run Find.', { selector: '.visually-hidden' })).toBeVisible()

    await fireEvent.input(search, { target: { value: '⌘F' } })
    expect(screen.getByText('Find')).toBeVisible()

    await fireEvent.input(search, { target: { value: 'missing' } })
    expect(screen.getByRole('status')).toHaveTextContent('No keyboard shortcuts match “missing”.')
  })
})
