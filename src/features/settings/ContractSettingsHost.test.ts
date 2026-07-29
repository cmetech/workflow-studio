import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import archonFixtureText from '../../../tests/fixtures/contracts/minimal-archon-v1.json?raw'
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
    render(ContractSettingsHost, {
      bundled: [],
      native,
      activateContract: vi.fn(async () => true),
      confirmUnsupported: vi.fn(async () => false),
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Import Contract File' }))

    await waitFor(() => expect(native.chooseContractFile).toHaveBeenCalledOnce())
    expect(native.contractReadFile).toHaveBeenCalledWith('/selected/archon.json')
    expect(await screen.findByText('Cached')).toBeInTheDocument()
    expect(native.contractCacheWrite).toHaveBeenCalledOnce()
  })
})
