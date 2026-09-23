import manifestText from '../../../contracts/manifest.json?raw'
import { loadBundledResourceSet, type BundledResourceSet } from './bundled-resource-manifest'
import { loadConformanceCorpus, type ConformanceCorpus } from './conformance'
import type { AuthoringContract } from './types'

const bundledSources = import.meta.glob('/contracts/*.json', {
  import: 'default',
  query: '?raw',
}) as Readonly<Record<string, () => Promise<string>>>

let cached: Promise<BundledResourceSet> | undefined

export function loadBundledContractResourceSet(): Promise<BundledResourceSet> {
  cached ??= loadBundledResourceSet(manifestText, readBundledResource)
  return cached
}

export async function loadBundledAuthoringContracts(): Promise<readonly AuthoringContract[]> {
  return (await loadBundledContractResourceSet()).contracts
}

export async function loadBundledConformanceCorpora(
  contracts: readonly AuthoringContract[],
): Promise<readonly ConformanceCorpus[]> {
  const resources = await loadBundledContractResourceSet()
  return Object.freeze(
    contracts.map((contract) => {
      const resource = resources.corpusResources.find(
        (candidate) =>
          candidate.profile === contract.profile && candidate.contract.contract_digest === contract.contract_digest,
      )
      if (!resource) throw new Error(`Missing bundled workflow conformance corpus for ${contract.profile}.`)
      return loadConformanceCorpus(new TextEncoder().encode(resource.text), contract)
    }),
  )
}

async function readBundledResource(file: string): Promise<string> {
  const matches = Object.entries(bundledSources).filter(([identifier]) => identifier.endsWith(`/contracts/${file}`))
  if (matches.length !== 1) throw new Error(`Missing or ambiguous bundled workflow resource: ${file}.`)
  return matches[0]![1]()
}
