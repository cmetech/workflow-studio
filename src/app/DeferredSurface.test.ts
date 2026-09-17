import { fireEvent, render, screen } from '@testing-library/svelte'
import type { Component } from 'svelte'
import { describe, expect, it, vi } from 'vitest'
import DeferredSurface from './DeferredSurface.svelte'

describe('DeferredSurface', () => {
  it('announces loading and renders a dynamically imported component once it resolves', async () => {
    let resolve!: (module: { default: Component }) => void
    const load = vi.fn(() => new Promise<{ default: Component }>((done) => (resolve = done)))
    render(DeferredSurface, { load, label: 'Documentation', componentProps: { message: 'Offline guide' } })

    expect(screen.getByRole('status')).toHaveTextContent('Loading Documentation…')
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
    resolve((await import('./DeferredSurfaceFixture.svelte')) as unknown as { default: Component })

    expect(await screen.findByText('Offline guide')).toBeVisible()
    expect(load).toHaveBeenCalledOnce()
  })

  it('surfaces a bounded accessible failure and retries the same importer on request', async () => {
    const load = vi
      .fn<() => Promise<{ default: Component }>>()
      .mockRejectedValueOnce(new Error('module unavailable'))
      .mockResolvedValueOnce((await import('./DeferredSurfaceFixture.svelte')) as unknown as { default: Component })
    render(DeferredSurface, { load, label: 'Examples', componentProps: { message: 'Examples ready' } })

    expect(await screen.findByRole('alert')).toHaveTextContent('Examples could not be loaded.')
    expect(screen.queryByText('module unavailable')).not.toBeInTheDocument()
    await fireEvent.click(screen.getByRole('button', { name: 'Retry loading Examples' }))

    expect(await screen.findByText('Examples ready')).toBeVisible()
    expect(load).toHaveBeenCalledTimes(2)
  })
})
