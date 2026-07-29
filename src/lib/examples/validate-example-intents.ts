import type { ProjectedNode, WorkflowProjection } from '$src/lib/projection/types'

const EXPECTED_IDS = [
  'minimal',
  'sequential',
  'parallel-fan-in',
  'conditional',
  'approval',
  'bash-script',
  'ai-tools',
  'retry-trigger',
  'bounded-loop',
  'advanced-reference',
] as const

export function validateExampleIntents(projections: ReadonlyMap<string, WorkflowProjection>): readonly string[] {
  const errors: string[] = []
  const actualIds = [...projections.keys()].sort()
  if (actualIds.join('\0') !== [...EXPECTED_IDS].sort().join('\0')) {
    errors.push(`catalog IDs must be exactly ${EXPECTED_IDS.join(', ')}.`)
  }
  for (const id of EXPECTED_IDS) {
    const projection = projections.get(id)
    if (!projection) continue
    validateIntent(id, projection, errors)
  }
  return errors
}

function validateIntent(id: (typeof EXPECTED_IDS)[number], projection: WorkflowProjection, errors: string[]): void {
  const node = (nodeId: string): ProjectedNode | undefined => projection.nodes.find(({ id }) => id === nodeId)
  const exactNodeKinds = (expected: readonly string[]) => {
    const actual = projection.nodes.map(({ kind }) => kind).sort()
    if (actual.join('\0') !== [...expected].sort().join('\0'))
      errors.push(`${id}: expected node kinds ${expected.join(', ')}.`)
  }
  const dependsOn = (nodeId: string, expected: readonly string[]) => {
    const actual = node(nodeId)?.dependsOn ?? []
    if (actual.join('\0') !== expected.join('\0')) errors.push(`${id}: ${nodeId} dependencies are incorrect.`)
  }
  const hasStringOption = (nodeId: string, key: string) => typeof node(nodeId)?.options[key] === 'string'

  switch (id) {
    case 'minimal':
      if (projection.nodes.length !== 1 || node('prompt')?.kind !== 'prompt')
        errors.push('minimal: expected one prompt node.')
      break
    case 'sequential':
      if (projection.nodes.length !== 3) errors.push('sequential: expected three nodes.')
      exactNodeKinds(['command', 'prompt', 'command'])
      dependsOn('prepare', [])
      dependsOn('review', ['prepare'])
      dependsOn('finish', ['review'])
      break
    case 'parallel-fan-in':
      if (projection.nodes.length !== 4) errors.push('parallel-fan-in: expected four nodes.')
      exactNodeKinds(['command', 'prompt', 'prompt', 'prompt'])
      dependsOn('root', [])
      dependsOn('left', ['root'])
      dependsOn('right', ['root'])
      dependsOn('join', ['left', 'right'])
      break
    case 'conditional':
      exactNodeKinds(['prompt', 'command', 'prompt'])
      dependsOn('prepare', [])
      for (const id of ['ready_path', 'fallback_path']) {
        dependsOn(id, ['prepare'])
        if (!hasStringOption(id, 'when')) errors.push(`conditional: ${id} needs a when condition.`)
      }
      break
    case 'approval':
      exactNodeKinds(['prompt', 'approval', 'command'])
      if (node('approve')?.kind !== 'approval') errors.push('approval: expected an approval node.')
      dependsOn('approve', ['work'])
      dependsOn('continue', ['approve'])
      if (node('continue')?.options.when !== '$approve.output.accepted == 1') {
        errors.push('approval: continuation must use the accepted outcome.')
      }
      break
    case 'bash-script':
      exactNodeKinds(['bash', 'script'])
      dependsOn('script', ['shell'])
      if (node('script')?.options.runtime !== 'uv') errors.push('bash-script: script node needs the uv runtime.')
      break
    case 'ai-tools':
      exactNodeKinds(['command', 'prompt'])
      for (const id of ['research', 'synthesize']) {
        const allowedTools = node(id)?.options.allowed_tools
        if (!Array.isArray(allowedTools) || allowedTools.length === 0) {
          errors.push(`ai-tools: ${id} needs allowed tools.`)
        }
      }
      break
    case 'retry-trigger':
      exactNodeKinds(['command', 'prompt'])
      if (!isRecord(node('risky')?.options.retry)) errors.push('retry-trigger: risky node needs retry settings.')
      if (node('report')?.options.trigger_rule !== 'all_done')
        errors.push('retry-trigger: report needs all_done trigger rule.')
      break
    case 'bounded-loop': {
      exactNodeKinds(['loop'])
      const loop = node('iterate')?.value
      if (
        !isRecord(loop) ||
        loop.max_iterations === undefined ||
        loop.prompt === undefined ||
        loop.until === undefined
      ) {
        errors.push('bounded-loop: loop needs prompt, until, and max_iterations controls.')
      }
      break
    }
    case 'advanced-reference': {
      exactNodeKinds(['command', 'prompt', 'bash', 'script', 'loop', 'approval', 'cancel'])
      const companion = projection.companion
      const requiredCompanion = [
        'concurrency_key',
        'delivery_defaults',
        'execution_environment',
        'limits',
        'outward_action_nodes',
        'outward_action_policy',
        'overlap_policy',
        'pause_lane_policy',
        'required_secrets',
        'required_services',
        'resource_limits',
        'retention',
        'scheduling',
        'tags',
      ]
      if (!companion || requiredCompanion.some((key) => !Object.hasOwn(companion, key))) {
        errors.push('advanced-reference: companion major structures are incomplete.')
      }
      if (!Array.isArray(projection.definition.tags) || projection.definition.tags.length === 0) {
        errors.push('advanced-reference: expected common definition structures.')
      }
      break
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
