import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import { loadBundledBrand } from '$src/lib/branding/load-brand'
import type { RuntimeBrandPack } from '$src/lib/branding/types'
import BrandPreview from './BrandPreview.svelte'

function previewPack(): RuntimeBrandPack {
  const bundled = loadBundledBrand()
  const manifest = {
    ...bundled,
    id: 'preview-only',
    displayName: 'Preview Only Studio',
    themes: { ...bundled.themes, dark: { ...bundled.themes.dark, background: '#010203' } },
  }
  return {
    manifest,
    assetUrls: { logo: 'blob:logo', mark: 'blob:mark', windowIcon: 'blob:icon' },
    issues: [{ code: 'grid', severity: 'warning', message: 'Grid is subtle.', mode: 'dark' }],
    canActivate: true,
    builtIn: false,
  }
}

describe('BrandPreview', () => {
  it('enters native modal presentation and closes the dialog during teardown', () => {
    const existingShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal')
    const existingClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close')
    const showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '')
    })
    const close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open')
    })
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: showModal })
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: close })

    try {
      const { unmount } = render(BrandPreview, {
        pack: previewPack(),
        mode: 'dark',
        onClose: vi.fn(),
        onActivate: vi.fn(),
      })

      expect(showModal).toHaveBeenCalledOnce()
      expect(screen.getByRole('dialog')).toHaveAttribute('open')
      unmount()
      expect(close).toHaveBeenCalledOnce()
    } finally {
      if (existingShowModal) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', existingShowModal)
      else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
      if (existingClose) Object.defineProperty(HTMLDialogElement.prototype, 'close', existingClose)
      else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
    }
  })

  it('makes background siblings inert when native modal presentation is unavailable and restores them', () => {
    const existingShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal')
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
    const background = document.createElement('button')
    background.textContent = 'Background action'
    document.body.append(background)

    try {
      const { unmount } = render(BrandPreview, {
        pack: previewPack(),
        mode: 'dark',
        onClose: vi.fn(),
        onActivate: vi.fn(),
      })

      expect(screen.getByRole('dialog')).toHaveAttribute('open')
      expect(background).toHaveAttribute('inert')
      expect(background).toHaveAttribute('aria-hidden', 'true')
      unmount()
      expect(background).not.toHaveAttribute('inert')
      expect(background).not.toHaveAttribute('aria-hidden')
    } finally {
      background.remove()
      if (existingShowModal) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', existingShowModal)
    }
  })

  it('applies preview tokens only to its isolated root and never mutates global CSS', () => {
    document.documentElement.style.setProperty('--color-background', '#ABCDEF')
    render(BrandPreview, { pack: previewPack(), mode: 'dark', onClose: vi.fn(), onActivate: vi.fn() })

    const root = screen.getByTestId('brand-preview-root')
    expect(root.style.getPropertyValue('--color-background')).toBe('#010203')
    expect(root).toHaveAttribute('data-brand', 'preview-only')
    expect(document.documentElement.style.getPropertyValue('--color-background')).toBe('#ABCDEF')
    expect(screen.getByRole('status')).toHaveTextContent('Grid is subtle')
  })

  it('contains focus, guards pending actions, closes with Escape, and restores the opener', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const onClose = vi.fn()
    const onActivate = vi.fn()
    const { rerender, unmount } = render(BrandPreview, {
      pack: previewPack(),
      mode: 'dark',
      pending: false,
      opener,
      onClose,
      onActivate,
    })
    const dialog = screen.getByRole('dialog', { name: 'Preview Preview Only Studio' })
    const close = screen.getByRole('button', { name: 'Close preview' })
    const activate = screen.getByRole('button', { name: 'Activate Preview Only Studio' })
    expect(close).toHaveFocus()
    activate.focus()
    await fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(screen.getByRole('button', { name: 'Sample focused control' })).toHaveFocus()
    await fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    await fireEvent(dialog, new Event('cancel', { cancelable: true }))
    expect(onClose).toHaveBeenCalledTimes(2)

    await rerender({ pack: previewPack(), mode: 'dark', pending: true, opener, onClose, onActivate })
    expect(screen.getByRole('button', { name: 'Activate Preview Only Studio' })).toBeDisabled()
    await fireEvent(dialog, new Event('cancel', { cancelable: true }))
    expect(onClose).toHaveBeenCalledTimes(2)
    unmount()
    expect(opener).toHaveFocus()
    opener.remove()
  })
})
