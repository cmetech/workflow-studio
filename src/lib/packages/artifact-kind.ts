import type { ResourceResolutionContract } from '../package-contract/resource-contract-loader'
import type { PackageWorkflowMember } from './types'

export type PackageArtifactKind =
  'workflow' | 'companion' | 'manifest' | 'generated' | 'command' | 'script' | 'yaml' | 'json' | 'text' | 'binary'

/** Command consumers come from the verified contract, independently of the resource's filename. */
export function commandResourceKinds(contract: ResourceResolutionContract): ReadonlySet<string> {
  const surfaces: readonly unknown[] = Array.isArray(contract.surfaces) ? contract.surfaces : []
  return new Set(
    surfaces.flatMap((surface) =>
      surface !== null &&
      typeof surface === 'object' &&
      'lookup_kind' in surface &&
      surface.lookup_kind === 'command' &&
      'resource_kind' in surface &&
      typeof surface.resource_kind === 'string'
        ? [surface.resource_kind]
        : [],
    ),
  )
}

export function classifyPackageArtifact(input: {
  readonly path: string
  readonly members: readonly PackageWorkflowMember[]
  readonly contract: ResourceResolutionContract
  readonly textAvailable: boolean
}): { readonly kind: PackageArtifactKind; readonly requiresStaticAnalysis: boolean } {
  const { path, members, contract } = input
  let kind: PackageArtifactKind
  const runtime = contract.runtime_validation as Record<string, unknown>
  const suffix = path.slice(path.lastIndexOf('.')).toLowerCase()
  const scriptSuffixes = Array.isArray(runtime.runtimes)
    ? runtime.runtimes.flatMap((name: unknown) => {
        const suffixes = runtime[`${String(name)}_suffixes`]
        return Array.isArray(suffixes) ? suffixes : []
      })
    : []
  const commandDirectories = contract.candidate_rules['compiler-source'].command.map((op) => op.directory)
  if (members.some((m) => m.definition === path)) kind = 'workflow'
  else if (members.some((m) => m.companion === path)) kind = 'companion'
  else if (path === 'workflow-package.json') kind = 'manifest'
  else if (path === 'digests.json') kind = 'generated'
  else if (scriptSuffixes.includes(suffix)) kind = 'script'
  else if (commandDirectories.some((dir) => dir && path.startsWith(`${dir}/`)) && suffix === '.md') kind = 'command'
  else if (suffix === '.yaml' || suffix === '.yml') kind = 'yaml'
  else if (suffix === '.json') kind = 'json'
  else kind = input.textAvailable ? 'text' : 'binary'
  return Object.freeze({ kind, requiresStaticAnalysis: ['script', 'command', 'yaml', 'json'].includes(kind) })
}
