import { parse } from 'yaml'
import type { AuthoringContract, WorkflowProfile } from '$src/lib/contract/types'
import type { DocumentAnalysis } from '$src/lib/documents/types'
import type { WorkspaceActionsNative } from '$src/features/workspace/workspace-actions'
import type { WorkflowPairEntry } from '$src/lib/workspace/types'

export type ExampleDifficulty = 'starter' | 'intermediate' | 'advanced'

export interface ExampleDescriptor {
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly difficulty: ExampleDifficulty
  readonly profiles: readonly WorkflowProfile[]
  readonly profile: WorkflowProfile
  readonly concepts: readonly string[]
  readonly highlightedNodeIds: readonly string[]
  readonly highlightedFieldIds: readonly string[]
  readonly documentationTopicIds: readonly string[]
  readonly definitionPath: string
  readonly companionPath: string | null
  readonly definitionText: string
  readonly companionText: string | null
  readonly readOnly: true
}

interface CatalogExample {
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly difficulty: ExampleDifficulty
  readonly profiles: readonly WorkflowProfile[]
  readonly concepts: readonly string[]
  readonly highlighted_nodes: readonly string[]
  readonly highlighted_fields: readonly string[]
  readonly documentation_topics: readonly string[]
  readonly path: string
}

export interface ExampleCopyDependencies {
  readonly native: Pick<WorkspaceActionsNative, 'workspaceScan' | 'workspaceWrite' | 'workspaceTrashPaths'>
  readonly workspaceId: string
  readonly contract: AuthoringContract
  readonly analyze: (input: {
    readonly definitionText: string
    readonly companionText: string | null
    readonly contract: AuthoringContract
  }) => Promise<DocumentAnalysis>
  readonly open: (entry: WorkflowPairEntry) => Promise<void>
}

export function parseExampleCatalog(text: string): readonly CatalogExample[] {
  const parsed = parse(text) as unknown
  if (!isRecord(parsed) || !Array.isArray(parsed.examples))
    throw new Error('Example catalog must contain an examples list.')
  const examples = parsed.examples.map((value, index) => parseCatalogExample(value, index))
  const ids = new Set<string>()
  const paths = new Set<string>()
  for (const example of examples) {
    if (ids.has(example.id)) throw new Error(`Example catalog ID "${example.id}" is duplicated.`)
    if (paths.has(example.path)) throw new Error(`Example catalog path "${example.path}" is duplicated.`)
    ids.add(example.id)
    paths.add(example.path)
  }
  return Object.freeze(examples)
}

function parseCatalogExample(value: unknown, index: number): CatalogExample {
  if (!isRecord(value)) throw new Error(`Example catalog entry ${index + 1} must be a mapping.`)
  const id = requiredString(value, 'id')
  const path = requiredString(value, 'path')
  if (!isSafeRelativeDirectory(path))
    throw new Error(`Example catalog path "${path}" must be a contained relative directory.`)
  const profiles = requiredProfiles(value, id)
  if (profiles.length !== 1) throw new Error(`Example "${id}" must claim exactly one profile.`)
  const difficulty = requiredString(value, 'difficulty')
  if (difficulty !== 'starter' && difficulty !== 'intermediate' && difficulty !== 'advanced') {
    throw new Error(`Example "${id}" has an unsupported difficulty "${difficulty}".`)
  }
  return Object.freeze({
    id,
    title: requiredString(value, 'title'),
    summary: requiredString(value, 'summary'),
    difficulty,
    profiles,
    concepts: requiredStrings(value, 'concepts'),
    highlighted_nodes: requiredStrings(value, 'highlighted_nodes'),
    highlighted_fields: requiredStrings(value, 'highlighted_fields'),
    documentation_topics: requiredStrings(value, 'documentation_topics'),
    path,
  })
}

function requiredString(value: Record<string, unknown>, key: string): string {
  const candidate = value[key]
  if (typeof candidate !== 'string' || candidate.trim().length === 0)
    throw new Error(`Example catalog requires ${key}.`)
  return candidate
}

function requiredStrings(value: Record<string, unknown>, key: string): readonly string[] {
  const candidate = value[key]
  if (
    !Array.isArray(candidate) ||
    candidate.length === 0 ||
    candidate.some((item) => typeof item !== 'string' || !item)
  ) {
    throw new Error(`Example catalog requires a non-empty ${key} string list.`)
  }
  return Object.freeze([...candidate] as string[])
}

function requiredProfiles(value: Record<string, unknown>, id: string): readonly WorkflowProfile[] {
  const profiles = requiredStrings(value, 'profiles')
  if (profiles.some((profile) => profile !== 'hermes-legacy' && profile !== 'archon-2026-07')) {
    throw new Error(`Example "${id}" has an unsupported profile.`)
  }
  return profiles as readonly WorkflowProfile[]
}

function isSafeRelativeDirectory(path: string): boolean {
  return (
    !path.startsWith('/') &&
    !path.includes('\\') &&
    !path.includes('\0') &&
    path.split('/').every((part) => part && part !== '.' && part !== '..')
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
