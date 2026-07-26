import { fireEvent, render, screen } from '@testing-library/svelte'
import { tick } from 'svelte'
import { describe, expect, it, vi } from 'vitest'
import ExternalChangeDialog from './ExternalChangeDialog.svelte'

describe('ExternalChangeDialog', () => {
  it('shows exact relative files and timestamps, offers three choices, and focuses Compare first', async () => {
    const onChoice = vi.fn()
    render(ExternalChangeDialog, {
      files: [
        { relativePath: 'flows/release.yaml', modifiedAt: '2026-07-25T13:00:00.000Z' },
        { relativePath: 'flows/release.hermes.yaml', modifiedAt: '2026-07-25T13:00:01.000Z' },
      ],
      diffViewed: false,
      onChoice,
    })
    await tick()

    expect(screen.getByRole('dialog', { name: 'Workflow changed on disk' })).toBeVisible()
    expect(screen.getByText('flows/release.yaml')).toBeVisible()
    expect(screen.getByText('2026-07-25T13:00:00.000Z')).toHaveAttribute('datetime', '2026-07-25T13:00:00.000Z')
    expect(screen.getByRole('button', { name: 'Compare' })).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Keep Mine' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reload Disk' })).toBeEnabled()

    await fireEvent.click(screen.getByRole('button', { name: 'Compare' }))
    expect(onChoice).toHaveBeenCalledWith('compare')
  })
})
