import { beforeAll, describe, expect, it } from 'vitest'
import vectors from '../../../contracts/workflow-package-resource-resolution-v1-vectors.json'
import { loadBundledResourceResolution } from '../package-contract/bundled-package-contract'
import type { ResourceResolutionContract } from '../package-contract/resource-contract-loader'
import {
  admitResourceResolution,
  collectMcpCandidates,
  interpretResourceDiscriminator,
  resolveCompilerResource,
  type ResourceFile,
} from './resource-resolution'

let contract: ResourceResolutionContract
beforeAll(async () => {
  contract = (await loadBundledResourceResolution()).contract
})

describe('exported compiler resource rules', () => {
  it.each(vectors.lookup.filter((item) => item.mode === 'compiler-source'))('matches $id', (fixture) => {
    const files = new Map<string, ResourceFile>()
    for (const path of Object.keys(fixture.files)) files.set(path, { kind: 'file' })
    if ('directories' in fixture) for (const path of fixture.directories ?? []) files.set(path, { kind: 'directory' })
    if ('cached' in fixture)
      for (const path of Object.keys(fixture.cached ?? {})) files.set(path, { kind: 'file', cached: true })
    expect(
      resolveCompilerResource({
        contract,
        kind: fixture.kind,
        reference: fixture.reference,
        ...('runtime' in fixture ? { runtime: fixture.runtime } : {}),
        files,
      }),
    ).toEqual(fixture.expected)
  })

  it.each(vectors.filesystem_recipes)('applies the compiler policy to declared $id', (fixture) => {
    const files = new Map<string, ResourceFile>()
    for (const path of Object.keys(fixture.files)) files.set(path, { kind: 'file' })
    for (const path of Object.keys(fixture.symlinks)) files.set(path, { kind: 'symlink' })
    expect(
      resolveCompilerResource({
        contract,
        kind: fixture.kind,
        reference: fixture.reference,
        runtime: fixture.runtime,
        files,
      }),
    ).toEqual(fixture.expected_by_mode['compiler-source'])
  })

  it('rejects unsupported runtimes, unsafe references, and undeclared lookup operations', () => {
    const files = new Map<string, ResourceFile>([['scripts/job.py', { kind: 'file' }]])
    expect(resolveCompilerResource({ contract, kind: 'script', reference: 'job', runtime: 'bash', files })).toEqual({
      code: 'resource_resolution_context_required',
    })
    expect(resolveCompilerResource({ contract, kind: 'script', reference: '../job', runtime: 'uv', files })).toEqual({
      code: 'include_resource_invalid',
    })
    const changed = structuredClone(contract)
    Reflect.set(changed.candidate_rules['compiler-source'].script.uv![0]!, 'operation', 'execute')
    expect(
      resolveCompilerResource({ contract: changed, kind: 'script', reference: 'job', runtime: 'uv', files }),
    ).toEqual({ code: 'unsupported_resource_contract' })
  })
})

describe('exported context and resource-value rules', () => {
  it.each(vectors.admission)('matches context admission %#', (fixture) => {
    expect(admitResourceResolution(contract, fixture.input)).toBe(fixture.code)
  })

  it.each(vectors.discriminator)('classifies the untrimmed value $value', (fixture) => {
    const rules = contract.value_discriminators_v1 as Record<string, unknown>
    expect(interpretResourceDiscriminator(rules['script-inline-v1'], fixture.value)).toBe(fixture.inline)
  })

  it.each(vectors.mcp_candidates)('walks exported MCP closure candidates %#', (fixture) => {
    expect(collectMcpCandidates(contract, fixture.document)).toEqual({ candidates: fixture.expected })
  })

  it('fails closed on cyclic or excessive MCP documents without executing content', () => {
    const cycle: Record<string, unknown> = {}
    cycle.child = cycle
    expect(collectMcpCandidates(contract, cycle)).toEqual({ code: 'resource_resolution_limit' })
    expect(
      collectMcpCandidates(
        contract,
        Array.from({ length: 5 }, () => 'resource'),
        { maxEntries: 4 },
      ),
    ).toEqual({ code: 'resource_resolution_limit' })
  })
})
