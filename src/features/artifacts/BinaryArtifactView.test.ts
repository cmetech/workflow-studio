import { fireEvent, render, screen } from '@testing-library/svelte'
import { expect, it, vi } from 'vitest'
import BinaryArtifactView from './BinaryArtifactView.svelte'

it('shows exact metadata and dispatches explicit resource actions', async () => {
  const onReplace = vi.fn(),
    onReveal = vi.fn(),
    onOpen = vi.fn()
  render(BinaryArtifactView, {
    metadata: {
      relativePath: 'images/logo.png',
      mediaType: 'image/png',
      size: 64,
      sha256: 'a'.repeat(64),
      readOnly: false,
      modifiedAt: '2026-09-22',
    },
    onReplace,
    onReveal,
    onOpen,
  })
  expect(screen.getByText('images/logo.png')).toBeVisible()
  expect(screen.getByText('64 bytes')).toBeVisible()
  expect(screen.getByText('a'.repeat(64))).toBeVisible()
  await fireEvent.click(screen.getByRole('button', { name: 'Replace' }))
  expect(onReplace).toHaveBeenCalledOnce()
  await fireEvent.click(screen.getByRole('button', { name: 'Reveal' }))
  expect(onReveal).toHaveBeenCalledOnce()
  await fireEvent.click(screen.getByRole('button', { name: 'Open Externally' }))
  expect(onOpen).toHaveBeenCalledOnce()
})
it('disables unsupported external opening and read-only replacement', () => {
  render(BinaryArtifactView, {
    metadata: {
      relativePath: 'script.bin',
      mediaType: 'application/octet-stream',
      size: 4,
      sha256: 'b'.repeat(64),
      readOnly: true,
      modifiedAt: '',
    },
    onReplace: vi.fn(),
    onReveal: vi.fn(),
    onOpen: vi.fn(),
  })
  expect(screen.getByRole('button', { name: 'Replace' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Open Externally' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Reveal' })).toBeEnabled()
})
