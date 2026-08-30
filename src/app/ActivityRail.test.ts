import { fireEvent, render, screen } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCommandRegistry, listCommands } from '$src/lib/commands/registry'
import ActivityRail from './ActivityRail.svelte'
import { showActivity } from '$src/stores/shell'

describe('ActivityRail', () => {
  afterEach(() => showActivity('explorer'))

  it('derives activity labels, disabled reasons, and execution from its injected registry', async () => {
    const registry = createCommandRegistry()
    const runDocumentation = vi.fn(() => showActivity('git'))
    for (const command of listCommands()) {
      registry.registerCommand(
        command.id === 'view.activity.documentation'
          ? { ...command, label: 'Registry Knowledge', run: runDocumentation }
          : command.id === 'view.activity.settings'
            ? {
                ...command,
                label: 'Registry Preferences',
                enabled: () => false,
                disabledReason: () => 'Preferences are locked.',
              }
            : command,
      )
    }
    showActivity('explorer')
    const onActivityInvoke = vi.fn()
    render(ActivityRail, { props: { commandSurface: registry, onActivityInvoke } } as never)

    const documentation = screen.getByRole('button', { name: 'Registry Knowledge' })
    const settings = screen.getByRole('button', { name: 'Registry Preferences' })
    const explorer = screen.getByRole('button', { name: 'Explorer' })
    expect(settings).toBeDisabled()
    expect(settings).toHaveAttribute('title', 'Preferences are locked.')
    expect(explorer).toHaveAttribute('data-activity', 'explorer')
    expect(settings.querySelector('svg')).not.toBeNull()
    await fireEvent.click(documentation)

    expect(onActivityInvoke).toHaveBeenCalledWith(documentation, 'documentation')
    expect(runDocumentation).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Git' })).toHaveAttribute('aria-current', 'page')
  })

  it('distinguishes contextual drawer controls from full-workbench page links', async () => {
    showActivity('settings')
    const registry = createCommandRegistry()
    for (const command of listCommands()) registry.registerCommand(command)
    render(ActivityRail, { props: { commandSurface: registry, workspacePanelExpanded: true } } as never)

    const settings = screen.getByRole('button', { name: 'Settings' })
    const explorer = screen.getByRole('button', { name: 'Explorer' })
    expect(settings).toHaveAttribute('aria-current', 'page')
    expect(settings).not.toHaveAttribute('aria-expanded')
    expect(explorer).not.toHaveAttribute('aria-current')
    expect(explorer).toHaveAttribute('aria-expanded', 'false')

    await fireEvent.click(explorer)

    expect(explorer).toHaveAttribute('aria-expanded', 'true')
    expect(settings).not.toHaveAttribute('aria-current')
  })
})
