import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import archonFixtureText from '../../../tests/fixtures/contracts/minimal-archon-v1.json?raw'
import legacyFixtureText from '../../../tests/fixtures/contracts/minimal-legacy-v1.json?raw'
import { createContractCache } from '$src/lib/contract/contract-cache'
import ContractSettingsHost from './ContractSettingsHost.svelte'

describe('ContractSettingsHost', () => {
  it('imports a contract through the selected native grant and renders the cached source', async () => {
    const native = {
      chooseContractFile: vi.fn(async () => '/selected/archon.json'),
      chooseHermesExecutable: vi.fn(async () => null),
      contractReadFile: vi.fn(async () => new TextEncoder().encode(archonFixtureText)),
      contractRunHermesCli: vi.fn(),
      contractCacheLoad: vi.fn(async () => []),
      contractCacheWrite: vi.fn(async () => undefined),
    }
    const cache = createContractCache({ bundled: [], native, activate: async () => true })
    await cache.hydrate()
    render(ContractSettingsHost, {
      cache,
      native,
      confirmUnsupported: vi.fn(async () => false),
      onContractsChanged: vi.fn(),
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Import Contract File' }))

    await waitFor(() => expect(native.chooseContractFile).toHaveBeenCalledOnce())
    expect(native.contractReadFile).toHaveBeenCalledWith('/selected/archon.json')
    expect(await screen.findByText('Cached')).toBeInTheDocument()
    expect(native.contractCacheWrite).toHaveBeenCalledOnce()
  })

  it('refreshes the explicitly selected legacy profile instead of inferring from active entry order', async () => {
    const native = {
      chooseContractFile: vi.fn(async () => null),
      chooseHermesExecutable: vi.fn(async () => '/Applications/Hermes'),
      contractReadFile: vi.fn(),
      contractRunHermesCli: vi.fn(async () => new TextEncoder().encode(legacyFixtureText)),
      contractCacheLoad: vi.fn(async () => []),
      contractCacheWrite: vi.fn(async () => undefined),
    }
    const cache = createContractCache({ bundled: [], native, activate: async () => true })
    render(ContractSettingsHost, {
      cache,
      native,
      confirmUnsupported: vi.fn(async () => false),
      onContractsChanged: vi.fn(),
    })

    await fireEvent.change(screen.getByRole('combobox', { name: 'CLI profile' }), {
      target: { value: 'hermes-legacy' },
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Refresh From Hermes CLI' }))

    await waitFor(() =>
      expect(native.contractRunHermesCli).toHaveBeenCalledWith({
        executablePath: '/Applications/Hermes',
        profile: 'hermes-legacy',
      }),
    )
    expect(await screen.findByText('Hermes CLI: /Applications/Hermes')).toBeInTheDocument()
  })
})
