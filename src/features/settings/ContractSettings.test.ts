import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import type { ContractCacheEntry } from '$src/lib/contract/contract-cache'
import ContractSettings from './ContractSettings.svelte'

const entries: readonly ContractCacheEntry[] = [
  {
    digest: `sha256:${'a'.repeat(64)}`,
    profile: 'archon-2026-07',
    schemaVersion: 1,
    normalizerVersion: 1,
    readerVersion: 1,
    status: 'bundled' as const,
    active: true,
    canActivate: true,
    provenance: { kind: 'bundled', identifier: '/contracts/archon.json' },
  },
  {
    digest: `sha256:${'b'.repeat(64)}`,
    profile: 'archon-2026-07',
    schemaVersion: 1,
    normalizerVersion: 2,
    readerVersion: 1,
    status: 'cached' as const,
    active: false,
    canActivate: true,
    provenance: { kind: 'user', identifier: '/chosen/archon.json' },
  },
  {
    digest: `sha256:${'c'.repeat(64)}`,
    profile: 'hermes-legacy',
    schemaVersion: 1,
    normalizerVersion: 1,
    readerVersion: 2,
    status: 'cached' as const,
    active: false,
    canActivate: false,
    provenance: { kind: 'cli', identifier: '/Applications/Hermes' },
  },
]

describe('ContractSettings', () => {
  it('exposes offline provenance and only offers activation for supported cached contracts', async () => {
    const onImportFile = vi.fn()
    const onRefreshCli = vi.fn()
    const onActivate = vi.fn()
    const onRemove = vi.fn()
    render(ContractSettings, { entries, onImportFile, onRefreshCli, onActivate, onRemove })

    expect(screen.getByText('Bundled')).toBeInTheDocument()
    expect(screen.getAllByText('Cached')).toHaveLength(2)
    expect(screen.getByText('Selected file: /chosen/archon.json')).toHaveClass('technical-value')
    expect(screen.getByText('Selected file: /chosen/archon.json').tagName).toBe('CODE')
    expect(screen.getByText('Hermes CLI: /Applications/Hermes')).toHaveClass('technical-value')
    expect(screen.getByText('Reader 2')).toHaveClass('technical-value')
    expect(screen.getAllByText('Archon 2026-07')).toHaveLength(3)
    expect(screen.getByRole('button', { name: `Activate ${entries[1]!.digest}` })).toBeEnabled()
    expect(screen.getByRole('button', { name: `Activate ${entries[2]!.digest}` })).toBeDisabled()
    expect(screen.getByRole('button', { name: `Remove ${entries[0]!.digest}` })).toBeDisabled()

    await fireEvent.click(screen.getByRole('button', { name: 'Import Contract File' }))
    await fireEvent.change(screen.getByRole('combobox', { name: 'CLI profile' }), {
      target: { value: 'hermes-legacy' },
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Refresh From Hermes CLI' }))
    await fireEvent.click(screen.getByRole('button', { name: `Activate ${entries[1]!.digest}` }))
    await fireEvent.click(screen.getByRole('button', { name: `Remove ${entries[1]!.digest}` }))

    expect(onImportFile).toHaveBeenCalledOnce()
    expect(onRefreshCli).toHaveBeenCalledWith('hermes-legacy')
    expect(onActivate).toHaveBeenCalledWith(entries[1]!.digest)
    expect(onRemove).toHaveBeenCalledWith(entries[1]!.digest)
  })
})
