import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import { loadBundledBrand } from '$src/lib/branding/load-brand'
import type { RuntimeBrandPack } from '$src/lib/branding/types'
import BrandSettings from './BrandSettings.svelte'

function pack(id: string, canActivate = true): RuntimeBrandPack {
  const manifest = structuredClone(loadBundledBrand())
  manifest.id = id
  manifest.displayName = id === 'loop24' ? 'LOOP24 Workflow Studio' : `${id} Studio`
  return {
    manifest,
    assetUrls: { logo: `blob:${id}-logo`, mark: `blob:${id}-mark`, windowIcon: `blob:${id}-icon` },
    issues: canActivate
      ? []
      : [{ code: 'contrast', severity: 'error', message: 'Text contrast is too low.', mode: 'dark' }],
    canActivate,
    builtIn: id === 'loop24',
  }
}

describe('BrandSettings', () => {
  it('shows non-renderable invalid-pack diagnostics without exposing preview or activation controls', () => {
    render(BrandSettings, {
      packs: [pack('loop24')],
      reports: [
        {
          reportId: 'rejected-1',
          displayName: 'Rejected brand pack',
          message: 'logo.svg contains active SVG content.',
          canActivate: false,
          safeToRender: false,
        },
      ],
      activeId: 'loop24',
      pending: false,
      warning: null,
      onImport: vi.fn(),
      onPreview: vi.fn(),
      onActivate: vi.fn(),
      onRemove: vi.fn(),
    })

    expect(screen.getByRole('alert')).toHaveTextContent('logo.svg contains active SVG content')
    expect(screen.queryByRole('button', { name: /preview rejected/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /activate rejected/i })).not.toBeInTheDocument()
  })

  it('exposes keyboard-operable import, preview, activation, and protected removal', async () => {
    const onImport = vi.fn()
    const onPreview = vi.fn()
    const onActivate = vi.fn()
    const onRemove = vi.fn()
    render(BrandSettings, {
      packs: [pack('loop24'), pack('acme'), pack('unsafe', false)],
      activeId: 'loop24',
      pending: false,
      warning: null,
      onImport,
      onPreview,
      onActivate,
      onRemove,
    })

    const importPack = screen.getByRole('button', { name: 'Import brand pack' })
    const preview = screen.getByRole('button', { name: 'Preview acme Studio' })
    const activate = screen.getByRole('button', { name: 'Activate acme Studio' })
    expect(importPack).toHaveAttribute('data-variant', 'primary')
    expect(preview).toHaveAttribute('data-variant', 'ghost')
    expect(activate).toHaveAttribute('data-variant', 'secondary')
    await fireEvent.click(importPack)
    await fireEvent.click(preview)
    await fireEvent.click(activate)
    expect(screen.getByRole('button', { name: 'Remove acme Studio' })).toHaveAttribute('data-variant', 'danger')
    await fireEvent.click(screen.getByRole('button', { name: 'Remove acme Studio' }))

    expect(onImport).toHaveBeenCalledOnce()
    expect(onPreview).toHaveBeenCalledWith('acme')
    expect(onActivate).toHaveBeenCalledWith('acme')
    expect(onRemove).toHaveBeenCalledWith('acme', false)
    expect(screen.getByRole('button', { name: 'Remove LOOP24 Workflow Studio' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Activate unsafe Studio' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Text contrast is too low')
  })

  it('guards every mutation while pending and requires an explicit LOOP24 revert for active removal', async () => {
    const onRemove = vi.fn()
    const { rerender } = render(BrandSettings, {
      packs: [pack('loop24'), pack('acme')],
      activeId: 'acme',
      pending: true,
      warning: null,
      onImport: vi.fn(),
      onPreview: vi.fn(),
      onActivate: vi.fn(),
      onRemove,
    })
    expect(screen.getByRole('button', { name: 'Import brand pack' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove acme Studio' })).toBeDisabled()

    await rerender({
      packs: [pack('loop24'), pack('acme')],
      activeId: 'acme',
      pending: false,
      warning: 'Active brand recovery warning',
      onImport: vi.fn(),
      onPreview: vi.fn(),
      onActivate: vi.fn(),
      onRemove,
    })
    expect(screen.getByRole('status')).toHaveTextContent('Active brand recovery warning')
    await fireEvent.click(screen.getByRole('button', { name: 'Remove acme Studio' }))
    expect(screen.getByRole('dialog', { name: 'Revert active brand' })).toBeInTheDocument()
    await fireEvent.click(screen.getByRole('button', { name: 'Revert to LOOP24 and remove' }))
    expect(onRemove).toHaveBeenCalledWith('acme', true)
  })

  it('enters the active-removal modal and traps keyboard focus within its actions', async () => {
    render(BrandSettings, {
      packs: [pack('loop24'), pack('acme')],
      activeId: 'acme',
      pending: false,
      warning: null,
      onImport: vi.fn(),
      onPreview: vi.fn(),
      onActivate: vi.fn(),
      onRemove: vi.fn(),
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Remove acme Studio' }))
    const dialog = screen.getByRole('dialog', { name: 'Revert active brand' })
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    const confirm = screen.getByRole('button', { name: 'Revert to LOOP24 and remove' })

    expect(dialog).toHaveAttribute('open')
    expect(dialog.querySelector('[data-modal-body]')).not.toBeNull()
    expect(dialog.querySelector('[data-modal-actions]')).not.toBeNull()
    expect(confirm).toHaveAttribute('data-variant', 'danger')
    await waitFor(() => expect(cancel).toHaveFocus())
    await fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true })
    expect(confirm).toHaveFocus()
    await fireEvent.keyDown(confirm, { key: 'Tab' })
    expect(cancel).toHaveFocus()
  })

  it('uses native modal presentation when the dialog API is available', async () => {
    const existing = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal')
    const showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '')
    })
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: showModal })

    try {
      render(BrandSettings, {
        packs: [pack('loop24'), pack('acme')],
        activeId: 'acme',
        pending: false,
        warning: null,
        onImport: vi.fn(),
        onPreview: vi.fn(),
        onActivate: vi.fn(),
        onRemove: vi.fn(),
      })

      await fireEvent.click(screen.getByRole('button', { name: 'Remove acme Studio' }))
      expect(showModal).toHaveBeenCalledOnce()
    } finally {
      if (existing) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', existing)
      else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
    }
  })

  it('guards dismissal while pending, then Escape closes and restores focus to the remove control', async () => {
    const props = {
      packs: [pack('loop24'), pack('acme')],
      activeId: 'acme',
      pending: false,
      warning: null,
      onImport: vi.fn(),
      onPreview: vi.fn(),
      onActivate: vi.fn(),
      onRemove: vi.fn(),
    }
    const { rerender } = render(BrandSettings, props)
    const opener = screen.getByRole('button', { name: 'Remove acme Studio' })

    await fireEvent.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'Revert active brand' })
    await rerender({ ...props, pending: true })
    await fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: 'Revert active brand' })).toBeInTheDocument()

    await rerender({ ...props, pending: false })
    await fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Revert active brand' })).not.toBeInTheDocument())
    expect(opener).toHaveFocus()
  })
})
