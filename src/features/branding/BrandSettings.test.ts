import { fireEvent, render, screen } from '@testing-library/svelte'
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

    await fireEvent.click(screen.getByRole('button', { name: 'Import brand pack' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Preview acme Studio' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Activate acme Studio' }))
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
})
