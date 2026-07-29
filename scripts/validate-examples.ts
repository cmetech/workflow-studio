import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'
import { loadAuthoringContract } from '../src/lib/contract/contract-loader'
import type { WorkflowProfile } from '../src/lib/contract/types'
import { parseExampleCatalog } from '../src/lib/examples/types'
import { validateExampleIntents } from '../src/lib/examples/validate-example-intents'
import { analyzeWorkflowPair } from '../src/lib/validation/analyze-workflow'
import type { WorkflowProjection } from '../src/lib/projection/types'

export async function validateExampleResources(
  root = resolve('examples'),
  contractsDirectory = resolve('contracts'),
): Promise<readonly string[]> {
  const errors: string[] = []
  const projections = new Map<string, WorkflowProjection>()
  let catalog
  try {
    catalog = parseExampleCatalog(await readFile(join(root, 'catalog.yaml'), 'utf8'))
  } catch (error) {
    return [`catalog.yaml: ${error instanceof Error ? error.message : String(error)}`]
  }
  const contracts = new Map<WorkflowProfile, Awaited<ReturnType<typeof loadAuthoringContract>>>()
  for (const profile of ['hermes-legacy', 'archon-2026-07'] as const) {
    try {
      contracts.set(
        profile,
        await loadAuthoringContract(await readFile(join(contractsDirectory, `${profile}-v1.json`)), {
          kind: 'bundled',
          identifier: profile,
        }),
      )
    } catch (error) {
      errors.push(`${profile}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  for (const example of catalog) {
    const profile = example.profiles[0]!
    const contractResult = contracts.get(profile)
    if (!contractResult?.ok) {
      errors.push(`${example.id}: production ${profile} contract is unavailable.`)
      continue
    }
    const definitionPath = join(root, example.path, 'workflow.yaml')
    const companionPath = join(root, example.path, 'workflow.hermes.yaml')
    try {
      const definitionText = await readFile(definitionPath, 'utf8')
      const companionText = await readOptional(companionPath)
      if (companionText === null && profile !== 'hermes-legacy')
        errors.push(`${example.id}: missing profile companion.`)
      if (companionText !== null) {
        const companion = parse(companionText) as unknown
        if (!isRecord(companion) || companion.language_compatibility !== profile) {
          errors.push(`${example.id}: profile tag does not match companion declaration.`)
        }
      }
      const contract = contractResult.contract
      const analysis = await analyzeWorkflowPair(
        {
          type: 'analyze',
          requestId: `example:${example.id}`,
          workflowId: `example:${example.id}`,
          pairGeneration: 0,
          definition: { path: `examples/${example.path}/workflow.yaml`, text: definitionText, revision: 0 },
          companion:
            companionText === null
              ? null
              : { path: `examples/${example.path}/workflow.hermes.yaml`, text: companionText, revision: 0 },
          profile,
          contractDigest: contract.contract_digest,
          reason: 'explicit-validate',
        },
        contract,
      )
      if (!analysis.structurallyValid)
        errors.push(
          `${example.id}: ${analysis.issues
            .filter((issue) => issue.blocking)
            .map(({ message }) => message)
            .join('; ')}`,
        )
      if (analysis.projection) projections.set(example.id, analysis.projection as WorkflowProjection)
      const nodeIds = new Set(analysis.projection?.nodes.map(({ id }) => id) ?? [])
      if (example.highlighted_nodes.some((id) => !nodeIds.has(id)))
        errors.push(`${example.id}: highlighted node is missing.`)
      const fields = new Set(contract.node_kinds.flatMap((kind) => kind.fields.map(({ id }) => id)))
      if (example.highlighted_fields.some((id) => !fields.has(id)))
        errors.push(`${example.id}: highlighted field is missing.`)
      const topics = new Set(contract.documentation.topics.map(({ id }) => id))
      if (example.documentation_topics.some((id) => !topics.has(id)))
        errors.push(`${example.id}: documentation topic is missing.`)
    } catch (error) {
      errors.push(`${example.id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  errors.push(...validateExampleIntents(projections))
  return errors
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (error: unknown) {
    if (isRecord(error) && error.code === 'ENOENT') return null
    throw error
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function main(): Promise<void> {
  const errors = await validateExampleResources()
  if (errors.length) throw new Error(errors.join('\n'))
  process.stdout.write('Validated bundled workflow examples.\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
