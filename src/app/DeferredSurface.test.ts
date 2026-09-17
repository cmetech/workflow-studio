import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { tick, type Component } from 'svelte'
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

  it('owns modal focus and Escape synchronously while a requested overlay is still loading', async () => {
    let resolve!: (module: { default: Component }) => void
    const load = vi.fn(() => new Promise<{ default: Component }>((done) => (resolve = done)))
    const onCancel = vi.fn()
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const view = render(DeferredSurface, {
      load,
      label: 'quick open',
      modal: { titleId: 'quick-open-loading-title', title: 'Quick open', opener, onCancel },
    } as never)

    const dialog = screen.getByRole('dialog', { name: 'Loading Quick open' })
    await waitFor(() => expect(dialog).toHaveFocus())
    await fireEvent.keyDown(dialog, { key: 'Escape' })
    await tick()

    expect(onCancel).toHaveBeenCalledOnce()
    expect(opener).toHaveFocus()
    resolve((await import('./DeferredSurfaceFixture.svelte')) as unknown as { default: Component })
    view.unmount()
    opener.remove()
  })

  it('keeps a rejected modal import contained and focuses Retry across another rejected attempt', async () => {
    const load = vi.fn<() => Promise<{ default: Component }>>().mockRejectedValue(new Error('module unavailable'))
    render(DeferredSurface, {
      load,
      label: 'workflow import',
      modal: {
        titleId: 'workflow-import-loading-title',
        title: 'Workflow import',
        onCancel: vi.fn(),
      },
    } as never)

    const dialog = await screen.findByRole('dialog', { name: 'Workflow import unavailable' })
    const retry = screen.getByRole('button', { name: 'Retry loading workflow import' })
    await waitFor(() => expect(retry).toHaveFocus())
    await fireEvent.click(retry)

    await waitFor(() => expect(load).toHaveBeenCalledTimes(2))
    expect(dialog).toHaveAttribute('open')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry loading workflow import' })).toHaveFocus())
  })
})
