import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { tick, type Component } from 'svelte'
import { describe, expect, it, vi } from 'vitest'
import DeferredSurface from './DeferredSurface.svelte'
import DeferredPropsHostFixture from './DeferredPropsHostFixture.svelte'

describe('DeferredSurface', () => {
  it('forwards synchronous parent changes to derived values read later in the same callback', async () => {
    const observed: number[] = []
    render(DeferredPropsHostFixture, {
      onReadRevision: (value: number) => {
        observed.push(value)
      },
    })
    const advance = await screen.findByRole('button', { name: 'Advance parent then read revision' })
    expect(screen.getByText('Derived revision 2')).toBeVisible()
    await fireEvent.click(advance)
    expect(observed).toEqual([4])
  })

  it('updates an initially absent property first read inside a conditional consumer', async () => {
    const loaded = (await import('./DeferredPropsFixture.svelte')) as unknown as { default: Component }
    const common = { model: Object.freeze({}), revision: 1, onObserve: () => {} }
    const view = render(DeferredSurface, {
      load: async () => loaded,
      label: 'Props',
      componentProps: common,
    })
    await fireEvent.click(await screen.findByRole('button', { name: 'Toggle detail' }))
    await view.rerender({ componentProps: { ...common, detail: 'added later' } })
    expect(screen.getByText('Detail added later')).toBeVisible()
    await view.rerender({ componentProps: common })
    expect(screen.queryByText('Detail added later')).not.toBeInTheDocument()
  })

  it('keeps a lazily read property current after its first consumer is removed', async () => {
    const loaded = (await import('./DeferredPropsFixture.svelte')) as unknown as { default: Component }
    const common = { model: Object.freeze({}), revision: 1, onObserve: () => {} }
    const view = render(DeferredSurface, {
      load: async () => loaded,
      label: 'Props',
      componentProps: { ...common, detail: 'first' },
    })
    const toggle = await screen.findByRole('button', { name: 'Toggle detail' })
    await fireEvent.click(toggle)
    expect(screen.getByText('Detail first')).toBeVisible()
    await fireEvent.click(toggle)
    await view.rerender({ componentProps: { ...common, detail: 'second' } })
    await fireEvent.click(toggle)
    expect(screen.getByText('Detail second')).toBeVisible()
  })

  it('does not rerun unchanged prop consumers when another forwarded prop changes', async () => {
    const loaded = (await import('./DeferredPropsFixture.svelte')) as unknown as { default: Component }
    const load = async () => loaded
    const model = Object.freeze({ id: 'stable-model' })
    const observed: object[] = []
    const onObserve = (value: object) => {
      observed.push(value)
    }
    const view = render(DeferredSurface, {
      load,
      label: 'Props',
      componentProps: { model, revision: 1, onObserve },
    })
    await screen.findByText('Revision 1')
    expect(observed).toEqual([model])
    expect(observed[0]).toBe(model)

    await view.rerender({ componentProps: { model, revision: 2, onObserve } })
    expect(screen.getByText('Revision 2')).toBeVisible()
    expect(observed).toEqual([model])

    const replacement = Object.freeze({ id: 'replacement' })
    await view.rerender({ componentProps: { model: replacement, revision: 3, onObserve } })
    expect(observed).toEqual([model, replacement])
    expect(observed[1]).toBe(replacement)
    view.unmount()
  })

  it('forwards replaced callbacks and added or removed optional props without remounting', async () => {
    const loaded = (await import('./DeferredPropsFixture.svelte')) as unknown as { default: Component }
    const load = async () => loaded
    const activations: string[] = []
    const common = { model: Object.freeze({}), revision: 1, onObserve: () => {} }
    const view = render(DeferredSurface, {
      load,
      label: 'Props',
      componentProps: {
        ...common,
        onActivate: () => {
          activations.push('first')
        },
      },
    })
    const button = await screen.findByRole('button', { name: 'Activate' })
    await fireEvent.click(button)
    await view.rerender({
      componentProps: {
        ...common,
        optional: 'present',
        onActivate: () => {
          activations.push('second')
        },
      },
    })
    expect(screen.getByText('Optional present')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Activate' })).toBe(button)
    await fireEvent.click(button)
    await view.rerender({ componentProps: common })
    expect(screen.getByText('Optional absent')).toBeVisible()
    await fireEvent.click(button)
    expect(activations).toEqual(['first', 'second'])
  })

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

  it('forwards parent prop updates after the deferred component mounts', async () => {
    const loaded = (await import('./DeferredSurfaceFixture.svelte')) as unknown as { default: Component }
    const load = vi.fn(async () => loaded)
    const view = render(DeferredSurface, {
      load,
      label: 'Inspector',
      componentProps: { message: 'Initial fields' },
    })

    expect(await screen.findByText('Initial fields')).toBeVisible()
    await view.rerender({
      load,
      label: 'Inspector',
      componentProps: { message: 'Updated fields' },
    })

    expect(await screen.findByText('Updated fields')).toBeVisible()
    expect(screen.queryByText('Initial fields')).not.toBeInTheDocument()
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
