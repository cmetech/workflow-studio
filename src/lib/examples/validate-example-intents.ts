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
  'loop-group-current-output',
  'loop-group-iteration-context',
  'loop-group-primary-sink',
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
  const graph = projection.graphs.find(({ scope }) => scope.key === 'root')
  if (!graph) {
    errors.push(`${id}: expected a root graph.`)
    return
  }
  const node = (nodeId: string): ProjectedNode | undefined => graph.nodes.find(({ id }) => id === nodeId)
  const exactNodeKinds = (expected: readonly string[]) => {
    const actual = graph.nodes.map(({ kind }) => kind).sort()
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
      if (graph.nodes.length !== 1 || node('prompt')?.kind !== 'prompt')
        errors.push('minimal: expected one prompt node.')
      break
    case 'sequential':
      if (graph.nodes.length !== 3) errors.push('sequential: expected three nodes.')
      exactNodeKinds(['command', 'prompt', 'command'])
      dependsOn('prepare', [])
      dependsOn('review', ['prepare'])
      dependsOn('finish', ['review'])
      break
    case 'parallel-fan-in':
      if (graph.nodes.length !== 4) errors.push('parallel-fan-in: expected four nodes.')
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
      if (node('continue')?.options.when !== undefined)
        errors.push('approval: continuation must rely on the approval dependency gate.')
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
      const definition = projection.definition as Record<string, unknown>
      if (!Array.isArray(definition.tags) || definition.tags.length === 0) {
        errors.push('advanced-reference: expected common definition structures.')
      }
      break
    }
    case 'loop-group-current-output': {
      const body = projection.graphs.find(({ scope }) => scope.key === 'loop-group:refine')
      if (!body) {
        errors.push('loop-group-current-output: expected the refine body graph.')
        break
      }
      if (body.definitionOrder.join('\0') !== ['draft', 'review'].join('\0'))
        errors.push('loop-group-current-output: body definition order is incorrect.')
      const review = body.nodes.find(({ id }) => id === 'review')
      if (review?.dependsOn.join('\0') !== ['draft'].join('\0'))
        errors.push('loop-group-current-output: review dependencies are incorrect.')
      if (review?.value !== 'Review $draft.output')
        errors.push('loop-group-current-output: review must consume the exact current output reference.')
      if (body.primarySinkId !== 'review') errors.push('loop-group-current-output: review must be the primary sink.')
      break
    }
    case 'loop-group-iteration-context': {
      dependsOn('refine', ['seed'])
      const body = projection.graphs.find(({ scope }) => scope.key === 'loop-group:refine')
      const revise = body?.nodes.find(({ id }) => id === 'revise')
      if (!body) errors.push('loop-group-iteration-context: expected the refine body graph.')
      else if (body.outerInputs.join('\0') !== ['seed'].join('\0'))
        errors.push('loop-group-iteration-context: outer inputs are incorrect.')
      if ((revise?.dependsOn ?? []).length !== 0)
        errors.push('loop-group-iteration-context: previous output must not add a current-body edge.')
      if (
        typeof revise?.value !== 'string' ||
        !revise.value.includes('$seed.output') ||
        !revise.value.includes('$LOOP_PREV.revise.output')
      )
        errors.push('loop-group-iteration-context: revise references are incorrect.')
      if (body?.primarySinkId !== 'revise')
        errors.push('loop-group-iteration-context: revise must be the primary sink.')
      break
    }
    case 'loop-group-primary-sink': {
      const body = projection.graphs.find(({ scope }) => scope.key === 'loop-group:summarize')
      if (!body) {
        errors.push('loop-group-primary-sink: expected the summarize body graph.')
        break
      }
      if (body.definitionOrder.join('\0') !== ['prepare', 'publish', 'archive'].join('\0'))
        errors.push('loop-group-primary-sink: body definition order is incorrect.')
      for (const terminal of ['publish', 'archive']) {
        const child = body.nodes.find(({ id }) => id === terminal)
        if (child?.dependsOn.join('\0') !== ['prepare'].join('\0'))
          errors.push(`loop-group-primary-sink: ${terminal} dependencies are incorrect.`)
        if (body.edges.some(({ source }) => source === terminal))
          errors.push(`loop-group-primary-sink: ${terminal} must be terminal.`)
      }
      if (body.primarySinkId !== 'publish')
        errors.push('loop-group-primary-sink: publish must be the first terminal primary sink.')
      const companion = projection.companion
      if (
        !isRecord(companion) ||
        !Array.isArray(companion.outward_action_nodes) ||
        companion.outward_action_nodes.join('\0') !== ['summarize/publish'].join('\0') ||
        companion.outward_action_policy !== 'approval_required'
      )
        errors.push('loop-group-primary-sink: scoped companion policy is incorrect.')
      break
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
