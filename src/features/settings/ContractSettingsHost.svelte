<script lang="ts">
  import { onMount } from 'svelte'
  import {
    createContractCache,
    type ContractCacheEntry,
    type ContractCacheNative,
  } from '$src/lib/contract/contract-cache'
  import type { AuthoringContract, WorkflowProfile } from '$src/lib/contract/types'
  import ContractSettings from './ContractSettings.svelte'

  interface Native extends ContractCacheNative {
    chooseContractFile(): Promise<string | null>
    chooseHermesExecutable(): Promise<string | null>
    contractReadFile(path: string): Promise<Uint8Array>
    contractRunHermesCli(request: { readonly executablePath: string; readonly profile: WorkflowProfile }): Promise<Uint8Array>
  }
  interface Props {
    bundled: readonly AuthoringContract[]
    native: Native
    activateContract: (contract: AuthoringContract) => Promise<boolean>
    confirmUnsupported: () => Promise<boolean>
  }
  let { bundled, native, activateContract, confirmUnsupported }: Props = $props()
  let entries = $state<readonly ContractCacheEntry[]>([])
  let error = $state<string | null>(null)
  let cache = $state.raw<ReturnType<typeof createContractCache> | null>(null)
  const refresh = () => { entries = cache?.listCachedContracts() ?? [] }

  onMount(() => {
    cache = createContractCache({ bundled, native, activate: activateContract })
    void cache.hydrate().then(refresh).catch((reason: unknown) => { error = message(reason) })
  })

  async function importBytes(bytes: Uint8Array, source: { kind: 'user' | 'cli'; identifier: string }): Promise<void> {
    try {
      if (!cache) return
      await cache.importBytes(bytes, source)
    } catch (reason) {
      if (!isUnsupported(reason) || !(await confirmUnsupported())) throw reason
      await cache!.importBytes(bytes, source, { cacheUnsupported: true })
    }
    refresh()
  }
  async function importFile(): Promise<void> {
    try {
      const path = await native.chooseContractFile()
      if (!path) return
      await importBytes(await native.contractReadFile(path), { kind: 'user', identifier: path })
    } catch (reason) { error = message(reason) }
  }
  async function refreshCli(): Promise<void> {
    try {
      const path = await native.chooseHermesExecutable()
      if (!path) return
      const profile = entries.find((entry) => entry.active)?.profile ?? 'archon-2026-07'
      await importBytes(await native.contractRunHermesCli({ executablePath: path, profile }), { kind: 'cli', identifier: path })
    } catch (reason) { error = message(reason) }
  }
  async function activate(digest: string): Promise<void> {
    const entry = entries.find((candidate) => candidate.digest === digest)
    if (!entry) return
    if (!cache || !digest.startsWith('sha256:')) return
    const result = await cache.activateContract(digest as `sha256:${string}`, entry.profile)
    if (!result.ok) error = `Could not activate this contract: ${result.code}`
    refresh()
  }
  async function remove(digest: string): Promise<void> {
    try { if (cache && digest.startsWith('sha256:')) await cache.removeContract(digest as `sha256:${string}`); refresh() } catch (reason) { error = message(reason) }
  }
  function isUnsupported(reason: unknown): boolean { return typeof reason === 'object' && reason !== null && 'code' in reason && reason.code === 'contract_reader_unsupported' }
  function message(reason: unknown): string { return reason instanceof Error ? reason.message : 'Contract management failed.' }
</script>

<ContractSettings entries={entries} onImportFile={importFile} onRefreshCli={refreshCli} onActivate={activate} onRemove={remove} />
{#if error}<p role="alert">{error}</p>{/if}
