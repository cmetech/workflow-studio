import { stringify } from 'yaml'
import type { AuthoringContract } from '$src/lib/contract/types'
import { parseWorkflowYaml } from '$src/lib/yaml/parse-document'
import { selectWorkflowProfile } from '$src/lib/validation/analyze-workflow'
import { pairWorkflowFiles } from '$src/lib/workspace/pair-workflows'
import {
  planPackageCreation,
  type PackageCreationSnapshot,
  type PackageWorkflowOption,
  type PackageWorkflowSource,
  type PackageSourceFile,
} from '$src/lib/packages/creation'
import type { ExampleDescriptor } from '$src/lib/examples/types'
import type { PackageAuthoringContext } from './package-authoring-controller'
import type { CapturedPackageAnalysis } from './package-analysis'
const metadata = {
  id: 'source-validation',
  version: '1.0.0',
  displayName: 'Source validation',
  description: 'Validates the selected source.',
  license: 'UNLICENSED',
  publisher: 'local',
  tags: ['local'],
  externalRequirements: { runtimes: [], tools: [], providers: [], services: [], secrets: [] },
}
export async function buildPackageAuthoringSources(
  context: PackageAuthoringContext,
  snapshot: PackageCreationSnapshot,
  captures: ReadonlyMap<string, CapturedPackageAnalysis>,
  examples: readonly ExampleDescriptor[],
): Promise<readonly PackageWorkflowOption[]> {
  const options: PackageWorkflowOption[] = []
  const entries = new Map(snapshot.entries.map((entry) => [entry.relativePath, entry]))
  async function add(id: string, label: string, source: PackageWorkflowSource, reason?: string) {
    let disabledReason = reason
    if (!disabledReason)
      try {
        const clean = (file: PackageSourceFile) => ({ path: file.path, text: file.text })
        await planPackageCreation(
          {
            root: 'source-validation',
            metadata,
            workflow: {
              ...source,
              kind: 'example',
              definition: clean(source.definition),
              companion: source.companion ? clean(source.companion) : null,
              resources: source.resources.map(clean),
            },
          },
          { ...snapshot, entries: [], packages: [] },
        )
      } catch (cause) {
        disabledReason = cause instanceof Error ? cause.message : String(cause)
      }
    options.push({ id, label, source, ...(disabledReason ? { disabledReason } : {}) })
  }
  for (const authoring of context.authoring) {
    await add('blank:' + authoring.profile, 'Blank workflow (' + authoring.profile + ')', {
      kind: 'blank',
      authoring,
      definition: {
        path: 'workflows/main.yaml',
        text: blankDefinition(authoring),
      },
      companion:
        authoring.profile === 'hermes-legacy'
          ? null
          : { path: 'workflows/main.hermes.yaml', text: 'language_compatibility: ' + authoring.profile + '\n' },
      resources: [],
    })
  }
  for (const example of examples) {
    const authoring = context.authoring.find((item) => item.profile === example.profile)
    if (!authoring) continue
    await add('example:' + example.id, 'Example: ' + example.title, {
      kind: 'example',
      authoring,
      definition: { path: 'workflows/' + example.definitionPath.split('/').at(-1)!, text: example.definitionText },
      companion:
        example.companionText !== null
          ? {
              path: 'workflows/' + (example.companionPath?.split('/').at(-1) ?? example.id + '.hermes.yaml'),
              text: example.companionText,
            }
          : null,
      resources: [],
    })
  }
  const candidates = new Map<string, { definition: string; companion: string | null; root: string | null }>()
  for (const pkg of context.packages)
    for (const member of pkg.workflows) {
      const prefix = pkg.root ? pkg.root + '/' : ''
      candidates.set(prefix + member.definition, {
        definition: prefix + member.definition,
        companion: member.companion ? prefix + member.companion : null,
        root: pkg.root,
      })
    }
  for (const entry of pairWorkflowFiles(context.workspaceId, snapshot.entries)) {
    if (entry.kind !== 'workflow' || candidates.has(entry.definitionPath)) continue
    if (context.packages.some((pkg) => pkg.root === '' || entry.definitionPath.startsWith(pkg.root + '/'))) continue
    candidates.set(entry.definitionPath, {
      definition: entry.definitionPath,
      companion: entry.companionPath,
      root: null,
    })
  }
  for (const candidate of candidates.values()) {
    const definition = entries.get(candidate.definition)
    const companion = candidate.companion ? entries.get(candidate.companion) : undefined
    if (definition?.text === undefined) continue
    let reason: string | undefined
    let value: unknown
    if (candidate.companion) {
      if (companion?.text === undefined) reason = 'The companion source is unavailable.'
      else {
        const parsed = parseWorkflowYaml(companion.text, {
          document: 'companion',
          maxBytes: snapshot.contract.resource_rules.max_file_bytes,
        })
        try {
          value = parsed.parsed?.document.toJS({ maxAliasCount: 1000 })
        } catch {
          reason = 'The companion source cannot be resolved.'
        }
      }
    }
    const profile = selectWorkflowProfile(value)
    const matching = context.authoring.find((item) => item.profile === profile.profile)
    const authoring = matching ?? context.authoring[0]!
    if (!matching || !profile.recognized) reason = 'The source requires an unavailable authoring profile.'
    const prefix = candidate.root ? candidate.root + '/' : ''
    const file = (path: string, text: string): PackageSourceFile => ({
      path: candidate.root === null ? path : path.slice(prefix.length),
      text,
      sourcePath: path,
    })
    const source: PackageWorkflowSource = {
      kind: 'workspace',
      authoring,
      definition: file(candidate.definition, definition.text),
      companion: companion?.text !== undefined ? file(candidate.companion!, companion.text) : null,
      resources: [],
    }
    const resources: PackageSourceFile[] = []
    if (candidate.root !== null) {
      const capture = captures.get(candidate.root)!
      const paths = new Set(
        capture.analysis.references.references
          .filter((ref) => ref.workflowPath === source.definition.path && ref.ownership === 'packaged')
          .map((ref) => ref.artifactPath),
      )
      for (const path of paths) {
        if (!path) {
          reason = 'A resource source could not be resolved.'
          continue
        }
        const text = capture.artifactTexts.get(path)
        if (text === undefined) {
          reason = 'A referenced resource cannot be copied as verified UTF-8 text.'
          continue
        }
        if (path !== source.definition.path && path !== source.companion?.path)
          resources.push(file(prefix + path, text))
      }
    }
    const pair = context.activePair
    if (
      pair &&
      (pair.definition.path === candidate.definition || pair.companion?.path === candidate.companion) &&
      (pair.generation !== pair.savedGeneration ||
        pair.definition.revision !== pair.definition.savedRevision ||
        (pair.companion && pair.companion.revision !== pair.companion.savedRevision))
    )
      reason = 'Save the unsaved source workflow before copying it.'
    if (
      definition.readOnly ||
      definition.symlink !== 'none' ||
      companion?.readOnly ||
      (companion?.symlink && companion.symlink !== 'none')
    )
      reason = 'The source must be an ordinary readable workspace file.'
    await add(
      'workspace:' + candidate.definition,
      'Saved workflow: ' + candidate.definition,
      { ...source, resources },
      reason,
    )
  }
  return options
}

function blankDefinition(contract: AuthoringContract): string {
  const rule = contract.semantic_rules.find(
    (item) =>
      item.status === 'supported' &&
      item.applicability.profiles.includes(contract.profile) &&
      typeof item.parameters.nodes_path === 'string' &&
      typeof item.parameters.id_field === 'string',
  )
  const prompt = contract.node_kinds.find(
    (item) =>
      item.id === 'prompt' && item.status === 'supported' && item.applicability.profiles.includes(contract.profile),
  )
  if (!rule || !prompt) return ''
  const tokens = (path: string) => path.replaceAll('[]', '').replace(/^\//, '').split(/[./]/).filter(Boolean)
  const nodes = tokens(rule.parameters.nodes_path as string)
  const set = (target: Record<string, unknown>, path: readonly string[], value: unknown) => {
    let cursor = target
    for (const part of path.slice(0, -1)) {
      const next: Record<string, unknown> = {}
      cursor[part] = next
      cursor = next
    }
    if (path.length) cursor[path.at(-1)!] = value
  }
  const node: Record<string, unknown> = {}
  set(node, tokens(rule.parameters.id_field as string), 'start')
  const field = tokens(prompt.field_path)
  set(
    node,
    nodes.every((part, index) => field[index] === part) ? field.slice(nodes.length) : field,
    'Describe the task to perform.',
  )
  const definition: Record<string, unknown> = { name: 'New workflow', description: 'A new workflow.' }
  set(definition, nodes, [node])
  return stringify(definition, { lineWidth: 0 })
}
