import { canonicalizeJsonValue } from './canonical-json'
import { sha256Sync } from './sha256-sync'
import type { AuthoringContract } from './types'
// Independently pinned to the reviewed a960d5e7 Hermes publication. Changing a
// bundle alone cannot activate new scanner behavior; this reader must be reviewed.
const scannerDigest = 'aec4abffedc1437e3e733fc0af28029cb89c7c669227ee2062d7b9ff736509b4'
const normalizedSemanticDigest = '146fa087b8953ee59f01256a6588812d819a30a39509b23667f5a5215c01572b'
const semanticDigest = 'a56f32abba7ccec0dbeed4273fc56876b1d09fd5f95ecd6d058a8378a1f61a22'
export function supportsScannerPublication(raw: Readonly<Record<string, unknown>>): boolean {
  if (raw.profile !== 'archon-2026-07' || raw.normalizer_version !== 6 || raw.contract_reader_version !== 3)
    return false
  if (!Array.isArray(raw.node_kinds) || !Array.isArray(raw.semantic_rules)) return false
  const group = raw.node_kinds.find((node: Record<string, unknown>) => node.id === 'loop_group') as
    Record<string, unknown> | undefined
  try {
    return (
      sha256Sync(canonicalizeJsonValue(raw.reference_scanner_v1)) === scannerDigest &&
      sha256Sync(canonicalizeJsonValue({ node: group?.semantic_definitions, rules: raw.semantic_rules })) ===
        semanticDigest
    )
  } catch {
    return false
  }
}
export function requireScannerCapability(contract: AuthoringContract): void {
  let supported = false
  try {
    supported =
      contract.contract_reader_version === 3 &&
      contract.profile === 'archon-2026-07' &&
      contract.normalizer_version === 6 &&
      sha256Sync(canonicalizeJsonValue(contract.extensions.reference_scanner_v1)) === scannerDigest &&
      sha256Sync(
        canonicalizeJsonValue({
          node: contract.node_kinds.find((node) => node.id === 'loop_group')?.extensions?.semantic_definitions,
          rules: contract.semantic_rules,
        }),
      ) === normalizedSemanticDigest
  } catch {
    /* Missing metadata is unsupported. */
  }
  if (!supported) throw new Error('The reference scanner capability is unsupported by this Studio reader.')
}
