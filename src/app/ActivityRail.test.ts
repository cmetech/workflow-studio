import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import { createCommandRegistry, listCommands } from '$src/lib/commands/registry'
import ActivityRail from './ActivityRail.svelte'
import { showActivity } from '$src/stores/shell'

describe('ActivityRail', () => {
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
    render(ActivityRail, { props: { commandSurface: registry } } as never)

    const documentation = screen.getByRole('button', { name: 'Registry Knowledge' })
    const settings = screen.getByRole('button', { name: 'Registry Preferences' })
    expect(settings).toBeDisabled()
    expect(settings).toHaveAttribute('title', 'Preferences are locked.')
    await fireEvent.click(documentation)

    expect(runDocumentation).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Git' })).toHaveAttribute('aria-pressed', 'true')
  })
})
