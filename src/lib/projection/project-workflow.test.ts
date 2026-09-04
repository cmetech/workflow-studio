import { describe, expect, it } from 'vitest'
import archonContractText from '../../../contracts/archon-2026-07-v6.json?raw'
import { loadAuthoringContract } from '$src/lib/contract/contract-loader'
import { parseWorkflowYaml } from '$src/lib/yaml/parse-document'
import { projectWorkflow } from './project-workflow'

async function archonContract() {
  const loaded = await loadAuthoringContract(new TextEncoder().encode(archonContractText), {
    kind: 'bundled',
    identifier: 'archon-2026-07-v6.json',
  })
  if (!loaded.ok) throw new Error(loaded.message)
  return loaded.contract
}

function parsedDefinition(source: string) {
  const result = parseWorkflowYaml(source, { document: 'definition', maxBytes: 2 * 1024 * 1024 })
  if (!result.parsed) throw new Error('Expected valid YAML fixture.')
  return result.parsed
}

describe('projectWorkflow', () => {
  it('projects a root-only workflow into the root graph collection', async () => {
    const source = `name: Root\ndescription: Root only\nnodes:\n  - id: collect\n    command: collect\n  - id: review\n    depends_on: [collect]\n    prompt: review\nunknown_top_level: preserve\n`
    const result = projectWorkflow(parsedDefinition(source), null, 'archon-2026-07', await archonContract())

    expect(result.issues).toEqual([])
    expect(result.projection.graphs).toHaveLength(1)
    expect(result.projection.graphs[0]).toMatchObject({
      scope: { key: 'root', kind: 'root' },
      definitionOrder: ['collect', 'review'],
      edges: [{ id: 'dependency:collect->review', source: 'collect', target: 'review' }],
      capacity: { status: 'visual', nodeCount: 2, edgeCount: 1 },
    })
    expect(result.projection.definition).toMatchObject({ unknown_top_level: 'preserve' })
    expect(structuredClone(result.projection)).toEqual(result.projection)
  })

  it('attaches missing child-kind findings only to the body graph', async () => {
    const source = `name: Scoped\ndescription: Scoped issues\nnodes:\n  - id: group\n    loop_group:\n      nodes:\n        - id: incomplete\n      until: done\n      max_iterations: 1\n`
    const result = projectWorkflow(parsedDefinition(source), null, 'archon-2026-07', await archonContract())
    const [root, body] = result.projection.graphs

    expect(root?.issues).toEqual([])
    expect(body?.issues).toEqual([
      expect.objectContaining({ code: 'missing_node_kind', nodeId: 'incomplete', path: '/nodes/0/loop_group/nodes/0' }),
    ])
    expect(result.issues).toEqual(body?.issues)
  })
})
