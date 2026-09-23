import type { WorkflowPackageContract } from '../package-contract/types'
import type { WorkspacePackageSnapshot, WorkspaceReplaceGeneratedRequest } from '../native/types'
import type { PackageAnalysis } from './readiness'
import { generatePackageDigests, composePackageDigest } from './digest'
import { parsePackageManifest } from './manifest'
import { packagePathError, packagePathIdentity } from './paths'
import type { WorkflowPackageManifest } from './types'
import {
  generateMarketplaceIndex,
  marketplaceEntry,
  parseMarketplaceIndex,
  MARKETPLACE_INDEX_PATH,
  type MarketplaceEntry,
} from './marketplace-index'

export interface PackageIndexContext {
  /** Read from the captured local Git HEAD, never an unrelated working package. */
  readonly committedIndexText: string | null
  readonly workingIndexText: string | null
  readonly workingIndexHash: string | null
}
export interface PackagePreparationInput extends PackageIndexContext {
  readonly contract: WorkflowPackageContract
  readonly manifestText: string
  readonly snapshot: WorkspacePackageSnapshot
  readonly analysis: PackageAnalysis
  /** Hashes captured by the analysis coordinator for this complete package inventory. */
  readonly analyzedHashes: ReadonlyMap<string, string>
}
export interface PreparedPackageFiles {
  readonly packageDigest: string
  readonly digestsText: string
  readonly indexText: string
  readonly request: WorkspaceReplaceGeneratedRequest
}
export function projectedPackageTraversalError(
  snapshot: WorkspacePackageSnapshot,
  contract: WorkflowPackageContract,
): string | null {
  const paths = new Set(snapshot.entries.map((entry) => entry.relativePath))
  paths.add(snapshot.packageRoot + '/digests.json')
  return paths.size > contract.resource_rules.max_traversal_entries ? 'package_traversal_limit' : null
}
async function hashText(text: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
}
function entries(text: string | null, contract: WorkflowPackageContract): readonly MarketplaceEntry[] {
  if (text === null) return []
  const result = parseMarketplaceIndex(text, contract)
  if (!result.ok) throw new Error(result.code)
  return result.index.packages
}

export async function reconcilePackageIndex(
  input: PackageIndexContext,
  manifest: WorkflowPackageManifest,
  root: string,
  packageDigest: string,
  contract: WorkflowPackageContract,
): Promise<string> {
  if (packagePathError(root) || MARKETPLACE_INDEX_PATH.startsWith(root + '/')) throw new Error('package_path_invalid')
  if ((input.workingIndexText === null ? null : await hashText(input.workingIndexText)) !== input.workingIndexHash)
    throw new Error('package_index_conflict')
  const committed = entries(input.committedIndexText, contract)
  const working = entries(input.workingIndexText, contract)
  const selectedIdentity = packagePathIdentity(root)
  const unselected = (list: readonly MarketplaceEntry[]) =>
    list.filter((entry) => packagePathIdentity(entry.packagePath) !== selectedIdentity)
  const committedOthers = unselected(committed),
    workingOthers = unselected(working)
  // Stable serialization checks metadata and payload digests, ignoring harmless JSON whitespace/order.
  if (generateMarketplaceIndex(committedOthers, contract) !== generateMarketplaceIndex(workingOthers, contract))
    throw new Error('package_index_conflict')
  if (committedOthers.some((entry) => entry.id === manifest.id)) throw new Error('package_index_conflict')
  return generateMarketplaceIndex([...committedOthers, marketplaceEntry(manifest, root, packageDigest)], contract)
}

/** Pure preparation. Native replacement rechecks the opaque snapshot before any write. */
export async function prepareGeneratedPackageFiles(input: PackagePreparationInput): Promise<PreparedPackageFiles> {
  const { snapshot, contract } = input
  const traversalError = projectedPackageTraversalError(snapshot, contract)
  if (traversalError) throw new Error(traversalError)
  const root = snapshot.packageRoot
  if (packagePathError(root) || MARKETPLACE_INDEX_PATH.startsWith(root + '/')) throw new Error('package_path_invalid')
  if (!snapshot.workspaceId || !snapshot.sourceSnapshotToken || !input.analysis.ready || input.analysis.blockers.length)
    throw new Error('package_analysis_required')
  if (
    input.analyzedHashes.size !== snapshot.files.length ||
    snapshot.files.some((file) => input.analyzedHashes.get(file.relativePath) !== file.sha256)
  )
    throw new Error('package_analysis_stale')
  const manifestFile = snapshot.files.find((file) => file.relativePath === 'workflow-package.json')
  if (!manifestFile || manifestFile.sha256 !== (await hashText(input.manifestText)))
    throw new Error('package_analysis_stale')
  const parsed = parsePackageManifest(input.manifestText, root + '/workflow-package.json', contract)
  if (!parsed.ok) throw new Error(parsed.findings[0]?.code ?? 'package_manifest_invalid')
  const digestsText = await generatePackageDigests(snapshot.files, contract)
  const packageDigest = await composePackageDigest(snapshot.files, contract.digest_rules)
  const indexText = await reconcilePackageIndex(input, parsed.manifest, root, packageDigest, contract)
  return {
    packageDigest,
    digestsText,
    indexText,
    request: {
      sourceSnapshotToken: snapshot.sourceSnapshotToken,
      writes: [
        { relativePath: root + '/digests.json', text: digestsText, expectedCurrentHash: snapshot.generatedDigestHash },
        { relativePath: MARKETPLACE_INDEX_PATH, text: indexText, expectedCurrentHash: input.workingIndexHash },
      ],
    },
  }
}
