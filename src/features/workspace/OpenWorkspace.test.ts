import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import OpenWorkspace from './OpenWorkspace.svelte'

describe('OpenWorkspace', () => {
  it('offers keyboard-operable opening, unavailable recent roots, and safe folder drop forwarding', async () => {
    const onOpen = vi.fn()
    const onDropPath = vi.fn()
    render(OpenWorkspace, {
      recent: [
        { rootPath: '/available', lastOpenedAt: '2026-07-25T12:00:00.000Z', available: true },
        { rootPath: '/missing', lastOpenedAt: '2026-07-24T12:00:00.000Z', available: false },
      ],
      onOpen,
      onDropPath,
    })

    const primaryAction = screen.getByRole('button', { name: 'Open Folder' })
    expect(primaryAction).toHaveAttribute('data-variant', 'primary')
    await fireEvent.click(primaryAction)
    expect(onOpen).toHaveBeenCalledWith(undefined)
    expect(screen.getByRole('navigation', { name: 'Recent folders' })).toBeVisible()
    await fireEvent.click(screen.getByRole('button', { name: '/available' }))
    expect(onOpen).toHaveBeenCalledWith('/available')
    expect(screen.getByRole('button', { name: '/missing unavailable' })).toBeDisabled()

    const drop = screen.getByRole('region', { name: 'Open workspace drop zone' })
    await fireEvent.drop(drop, { dataTransfer: { files: [{ path: '/dropped' }] } })
    expect(onDropPath).toHaveBeenCalledWith('/dropped')
    expect(drop.querySelector('.editor-tabs')).toBeNull()
    expect(drop.querySelector('[aria-label="Inspector"]')).toBeNull()
  })
})
