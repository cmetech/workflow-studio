import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { createRawSnippet, tick } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ModalShell from './ModalShell.svelte'

const children = createRawSnippet(() => ({
  render: () => `
    <div>
      <h2 id="modal-title">Modal title</h2>
      <p id="modal-description">Modal description</p>
      <button type="button" data-modal-initial-focus>First action</button>
    </div>
  `,
}))

const actions = createRawSnippet(() => ({
  render: () => '<button type="button">Last action</button>',
}))

describe('ModalShell', () => {
  const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal')
  const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close')
  let showModal: ReturnType<typeof vi.fn>
  let close: ReturnType<typeof vi.fn>

  beforeEach(() => {
    showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '')
    })
    close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open')
    })
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: showModal })
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: close })
  })

  afterEach(() => {
    if (originalShowModal) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShowModal)
    else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
    if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, 'close', originalClose)
    else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
  })

  it('opens a labelled native modal with bounded body/actions regions and safest requested focus', async () => {
    render(ModalShell, {
      titleId: 'modal-title',
      describedBy: 'modal-description',
      busy: true,
      initialFocusSelector: '[data-modal-initial-focus]',
      onCancel: vi.fn(),
      children,
      actions,
    })

    const dialog = screen.getByRole('dialog', { name: 'Modal title' })
    await waitFor(() => expect(showModal).toHaveBeenCalledOnce())
    expect(dialog.tagName).toBe('DIALOG')
    expect(dialog).toHaveAttribute('aria-describedby', 'modal-description')
    expect(dialog).toHaveAttribute('aria-busy', 'true')
    expect(dialog.querySelector('[data-modal-body]')).not.toBeNull()
    expect(dialog.querySelector('[data-modal-actions]')).not.toBeNull()
    await waitFor(() => expect(screen.getByRole('button', { name: 'First action' })).toHaveFocus())
  })

  it('wraps forward and reverse Tab focus inside the modal', async () => {
    render(ModalShell, {
      titleId: 'modal-title',
      onCancel: vi.fn(),
      children,
      actions,
    })
    await waitFor(() => expect(showModal).toHaveBeenCalledOnce())
    const dialog = screen.getByRole('dialog', { name: 'Modal title' })
    const first = screen.getByRole('button', { name: 'First action' })
    const last = screen.getByRole('button', { name: 'Last action' })
    await waitFor(() => expect(first).toHaveFocus())

    last.focus()
    await fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(first).toHaveFocus()
    first.focus()
    await fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()
  })

  it('closes before dismissing, stops Escape propagation, and restores its opener after a tick', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const order: string[] = []
    close.mockImplementation(function (this: HTMLDialogElement) {
      order.push('close')
      this.removeAttribute('open')
    })
    const onCancel = vi.fn(() => {
      order.push('cancel')
    })
    render(ModalShell, {
      titleId: 'modal-title',
      opener,
      onCancel,
      children,
      actions,
    })
    await waitFor(() => expect(showModal).toHaveBeenCalledOnce())
    const dialog = screen.getByRole('dialog', { name: 'Modal title' })
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    const outer = vi.fn()
    document.body.addEventListener('keydown', outer)

    dialog.dispatchEvent(event)
    await tick()
    await tick()

    expect(event.defaultPrevented).toBe(true)
    expect(outer).not.toHaveBeenCalled()
    expect(order).toEqual(['close', 'cancel'])
    expect(opener).toHaveFocus()
    document.body.removeEventListener('keydown', outer)
    opener.remove()
  })

  it('keeps a non-dismissible modal open on Escape and restores the opener after destruction', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const onCancel = vi.fn()
    const view = render(ModalShell, {
      titleId: 'modal-title',
      dismissible: false,
      opener,
      onCancel,
      children,
      actions,
    })
    await waitFor(() => expect(showModal).toHaveBeenCalledOnce())
    const dialog = screen.getByRole('dialog', { name: 'Modal title' })

    await fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onCancel).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()

    view.unmount()
    await waitFor(() => expect(opener).toHaveFocus())
    expect(close).toHaveBeenCalledOnce()
    opener.remove()
  })

  it('allows only the topmost open modal to handle Escape', async () => {
    const lowerCancel = vi.fn()
    const upperCancel = vi.fn()
    const lowerChildren = createRawSnippet(() => ({
      render: () => '<h2 id="lower-title">Lower modal</h2>',
    }))
    const upperChildren = createRawSnippet(() => ({
      render: () => '<h2 id="upper-title">Upper modal</h2>',
    }))
    render(ModalShell, { titleId: 'lower-title', onCancel: lowerCancel, children: lowerChildren })
    render(ModalShell, { titleId: 'upper-title', onCancel: upperCancel, children: upperChildren })
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(2))
    const lower = screen.getByRole('dialog', { name: 'Lower modal' })
    const upper = screen.getByRole('dialog', { name: 'Upper modal' })

    await fireEvent.keyDown(lower, { key: 'Escape' })
    expect(lowerCancel).not.toHaveBeenCalled()
    expect(upperCancel).not.toHaveBeenCalled()

    await fireEvent.keyDown(upper, { key: 'Escape' })
    expect(upperCancel).toHaveBeenCalledOnce()
  })

  it('uses showModal opening order for Escape when DOM order differs', async () => {
    const lowerCancel = vi.fn()
    const upperCancel = vi.fn()
    const lowerChildren = createRawSnippet(() => ({
      render: () => '<h2 id="opening-lower-title">Opening lower modal</h2>',
    }))
    const upperChildren = createRawSnippet(() => ({
      render: () => '<h2 id="opening-upper-title">Opening upper modal</h2>',
    }))
    const lowerView = render(ModalShell, {
      titleId: 'opening-lower-title',
      onCancel: lowerCancel,
      children: lowerChildren,
    })
    const upperView = render(ModalShell, {
      titleId: 'opening-upper-title',
      onCancel: upperCancel,
      children: upperChildren,
    })
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(2))
    lowerView.container.before(upperView.container)
    const lower = screen.getByRole('dialog', { name: 'Opening lower modal' })
    const upper = screen.getByRole('dialog', { name: 'Opening upper modal' })
    expect([...document.querySelectorAll('dialog[open]')]).toEqual([upper, lower])

    await fireEvent.keyDown(upper, { key: 'Escape' })

    expect(upperCancel).toHaveBeenCalledOnce()
    expect(lowerCancel).not.toHaveBeenCalled()
  })

  it('does not let a closing lower modal steal focus from a newer top-layer modal', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const lowerChildren = createRawSnippet(() => ({
      render: () => '<h2 id="lower-title">Lower modal</h2>',
    }))
    const upperChildren = createRawSnippet(() => ({
      render: () => '<div><h2 id="upper-title">Upper modal</h2><button type="button">Upper action</button></div>',
    }))
    const lower = render(ModalShell, { titleId: 'lower-title', opener, onCancel: vi.fn(), children: lowerChildren })
    render(ModalShell, { titleId: 'upper-title', onCancel: vi.fn(), children: upperChildren })
    const upperAction = screen.getByRole('button', { name: 'Upper action' })
    await waitFor(() => expect(upperAction).toHaveFocus())

    lower.unmount()
    await tick()
    await tick()

    expect(upperAction).toHaveFocus()
    opener.remove()
  })

  it('uses opening order when deciding whether lower-modal restoration would steal focus', async () => {
    const retainedOpener = document.createElement('button')
    retainedOpener.textContent = 'Retained opener'
    document.body.append(retainedOpener)
    retainedOpener.focus()
    const lowerChildren = createRawSnippet(() => ({
      render: () => '<h2 id="restore-lower-title">Restore lower modal</h2>',
    }))
    const middleChildren = createRawSnippet(() => ({
      render: () => '<div><h2 id="restore-middle-title">Restore middle modal</h2></div>',
    }))
    const upperChildren = createRawSnippet(() => ({
      render: () =>
        '<div><h2 id="restore-upper-title">Restore upper modal</h2><button type="button">Upper focus</button></div>',
    }))
    const lowerView = render(ModalShell, {
      titleId: 'restore-lower-title',
      opener: retainedOpener,
      onCancel: vi.fn(),
      children: lowerChildren,
    })
    const middleView = render(ModalShell, {
      titleId: 'restore-middle-title',
      onCancel: vi.fn(),
      children: middleChildren,
    })
    const upperView = render(ModalShell, {
      titleId: 'restore-upper-title',
      onCancel: vi.fn(),
      children: upperChildren,
    })
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(3))
    lowerView.container.before(upperView.container)
    middleView.container.querySelector('[data-modal-body]')?.append(retainedOpener)
    const upperAction = screen.getByRole('button', { name: 'Upper focus' })
    upperAction.focus()
    expect([...document.querySelectorAll('dialog[open]')].at(-1)).toBe(
      screen.getByRole('dialog', { name: 'Restore middle modal' }),
    )

    lowerView.unmount()
    await tick()
    await tick()

    expect(upperAction).toHaveFocus()
    retainedOpener.remove()
  })
})
