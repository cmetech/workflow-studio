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

    await rerender({ pack: previewPack(), mode: 'dark', pending: true, opener, onClose, onActivate })
    expect(screen.getByRole('button', { name: 'Activate Preview Only Studio' })).toBeDisabled()
    unmount()
    expect(opener).toHaveFocus()
    opener.remove()
  })
})
