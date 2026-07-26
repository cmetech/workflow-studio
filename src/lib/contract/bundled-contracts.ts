import { loadAuthoringContract } from './contract-loader'
import type { AuthoringContract } from './types'

const bundledSources = import.meta.glob('/contracts/*.json', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Readonly<Record<string, string>>

let cached: Promise<readonly AuthoringContract[]> | undefined

export function loadBundledAuthoringContracts(): Promise<readonly AuthoringContract[]> {
  cached ??= loadSources(bundledSources)
  return cached
}

async function loadSources(sources: Readonly<Record<string, string>>): Promise<readonly AuthoringContract[]> {
  const contracts: AuthoringContract[] = []
  for (const [identifier, text] of Object.entries(sources).sort(([left], [right]) => left.localeCompare(right))) {
    const loaded = await loadAuthoringContract(new TextEncoder().encode(text), { kind: 'bundled', identifier })
    if (loaded.ok) contracts.push(loaded.contract)
  }
  return Object.freeze(contracts)
}
