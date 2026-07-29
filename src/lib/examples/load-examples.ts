import { parse } from 'yaml'
import type { WorkflowPairEntry } from '$src/lib/workspace/types'
import { pairWorkflowFiles } from '$src/lib/workspace/pair-workflows'
import { parseExampleCatalog, type ExampleCopyDependencies, type ExampleDescriptor } from './types'

import catalogText from '../../../examples/catalog.yaml?raw'

const bundledExampleSources = import.meta.glob('../../../examples/*/*.yaml', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Readonly<Record<string, string>>

let catalogPromise: Promise<readonly ExampleDescriptor[]> | undefined

export function loadExampleCatalog(): Promise<readonly ExampleDescriptor[]> {
  catalogPromise ??= Promise.resolve(loadCatalog())
  return catalogPromise
}

function loadCatalog(): readonly ExampleDescriptor[] {
  return Object.freeze(
    parseExampleCatalog(catalogText).map((entry) => {
      const definitionPath = `examples/${entry.path}/workflow.yaml`
      const companionPath = `examples/${entry.path}/workflow.hermes.yaml`
      const definitionText = bundledText(definitionPath)
      const companionText = bundledTextOrNull(companionPath)
      const profile = entry.profiles[0]!
      if (companionText !== null) {
        const companion = parse(companionText) as unknown
        if (!isRecord(companion) || companion.language_compatibility !== profile) {
          throw new Error(`Example "${entry.id}" profile does not match its companion declaration.`)
        }
      } else if (profile !== 'hermes-legacy') {
        throw new Error(`Example "${entry.id}" requires an ${profile} companion declaration.`)
      }
      return Object.freeze({
        id: entry.id,
        title: entry.title,
        summary: entry.summary,
        difficulty: entry.difficulty,
        profiles: entry.profiles,
        profile,
        concepts: entry.concepts,
        highlightedNodeIds: entry.highlighted_nodes,
        highlightedFieldIds: entry.highlighted_fields,
        documentationTopicIds: entry.documentation_topics,
        definitionPath,
        companionPath: companionText === null ? null : companionPath,
        definitionText,
        companionText,
        readOnly: true,
      } satisfies ExampleDescriptor)
    }),
  )
}

function bundledText(path: string): string {
  const source = Object.entries(bundledExampleSources).find(([identifier]) => identifier.endsWith(`/${path}`))?.[1]
  if (source === undefined) throw new Error(`Bundled example resource is missing: ${path}`)
  return source
}

function bundledTextOrNull(path: string): string | null {
  const source = Object.entries(bundledExampleSources).find(([identifier]) => identifier.endsWith(`/${path}`))?.[1]
  return source ?? null
}

export async function createExampleCopy(
  example: ExampleDescriptor,
  dependencies: ExampleCopyDependencies,
): Promise<{ readonly definitionPath: string; readonly companionPath: string | null }> {
  const analysis = await dependencies.analyze({
    definitionText: example.definitionText,
    companionText: example.companionText,
    contract: dependencies.contract,
  })
  if (!analysis.structurallyValid) throw new Error(`Example "${example.title}" is not valid for the active contract.`)

  const occupied = new Set((await dependencies.native.workspaceScan()).map(({ relativePath }) => relativePath))
  const definitionPath = copyPath(example.definitionPath.split('/').at(-1) ?? 'workflow.yaml', occupied)
  const companionPath = example.companionText === null ? null : companionFor(definitionPath)
  const definitionWrite = await dependencies.native.workspaceWrite({
    relativePath: definitionPath,
    text: example.definitionText,
    expectedCurrentHash: null,
  })
  if (companionPath && example.companionText !== null) {
    try {
      await dependencies.native.workspaceWrite({
        relativePath: companionPath,
        text: example.companionText,
        expectedCurrentHash: null,
      })
    } catch (error) {
      const cleanup = await dependencies.native.workspaceTrashPaths([
        { relativePath: definitionPath, expectedCurrentHash: definitionWrite.sha256 },
      ])
      if (cleanup.results.some(({ status }) => status !== 'trashed')) {
        throw new Error('Example companion creation failed and the new definition could not be moved to Trash.')
      }
      throw error
    }
  }
  const entry = pairWorkflowFiles(dependencies.workspaceId, await dependencies.native.workspaceScan()).find(
    (candidate): candidate is WorkflowPairEntry =>
      candidate.kind === 'workflow' &&
      candidate.definitionPath === definitionPath &&
      candidate.companionPath === companionPath,
  )
  if (!entry) throw new Error('The new example copy could not be discovered as a workflow pair.')
  await dependencies.open(entry)
  return { definitionPath, companionPath }
}

function copyPath(source: string, occupied: ReadonlySet<string>): string {
  const extension = source.endsWith('.yaml') ? '.yaml' : '.yml'
  const base = source.slice(0, -extension.length)
  for (let index = 1; ; index += 1) {
    const candidate = index === 1 ? source : `${base}-${index}${extension}`
    const companion = companionFor(candidate)
    if (!occupied.has(candidate) && !occupied.has(companion)) return candidate
  }
}

function companionFor(definitionPath: string): string {
  return definitionPath.replace(/\.(?:yaml|yml)$/, '.hermes.yaml')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
