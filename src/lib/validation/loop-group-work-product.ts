import type { ScopedDagCapabilities } from '$src/lib/contract/scoped-dag-rule'

export interface LoopGroupWorkProduct {
  readonly executions: number
  readonly attempts: number
  readonly limit: number
  readonly exceeded: boolean
}

export function calculateLoopGroupWorkProduct(
  groupNode: unknown,
  capabilities: ScopedDagCapabilities,
): LoopGroupWorkProduct {
  const bodyNodes = valueAtPath(groupNode, capabilities.bodyPath)
  const nodes = Array.isArray(bodyNodes) ? bodyNodes : []
  const groupIterations = integerAtPath(groupNode, capabilities.workProduct.group_iterations_path, 0)
  const environment = { capabilities, bodyNodes: nodes, groupIterations }
  const executions = evaluate(capabilities.workProductSemantics.expressions.executions, environment)
  const attempts = evaluate(capabilities.workProductSemantics.expressions.attempts, environment)
  const limit = capabilities.workProduct.limit
  return Object.freeze({ executions, attempts, limit, exceeded: executions > limit || attempts > limit })
}

interface EvaluationEnvironment {
  readonly capabilities: ScopedDagCapabilities
  readonly bodyNodes: readonly unknown[]
  readonly groupIterations: number
  readonly bodyNode?: unknown
}

function evaluate(expression: unknown, environment: EvaluationEnvironment): number {
  if (typeof expression === 'number' && Number.isFinite(expression)) return expression
  if (expression === 'group_iterations') return environment.groupIterations
  if (expression === 'ordinary_loop_multiplier') return ordinaryLoopMultiplier(environment)
  if (expression === 'selected_retries') return selectedRetries(environment)
  if (!Array.isArray(expression) || typeof expression[0] !== 'string') return 0

  const [operator, ...operands] = expression
  if (operator === '+') return operands.reduce((total, operand) => total + evaluate(operand, environment), 0)
  if (operator === '*') return operands.reduce((total, operand) => total * evaluate(operand, environment), 1)
  if (operator === 'sum' && operands[0] === 'body_nodes') {
    return environment.bodyNodes.reduce<number>(
      (total, bodyNode) => total + evaluate(operands[1], { ...environment, bodyNode }),
      0,
    )
  }
  return 0
}

function ordinaryLoopMultiplier(environment: EvaluationEnvironment): number {
  return integerAtPath(
    environment.bodyNode,
    environment.capabilities.workProduct.ordinary_loop_multiplier_path,
    integer(environment.capabilities.workProduct.ordinary_loop_default_multiplier, 1),
  )
}

function selectedRetries(environment: EvaluationEnvironment): number {
  const { capabilities, bodyNode } = environment
  for (const selector of capabilities.workProductSemantics.retryPrecedence) {
    if (selector === 'approval' && hasPath(bodyNode, capabilities.workProduct.approval_max_attempts_path.slice(0, 1))) {
      return integerAtPath(
        bodyNode,
        capabilities.workProduct.approval_max_attempts_path,
        capabilities.workProduct.approval_default_max_attempts,
      )
    }
    if (selector === 'retry' && hasPath(bodyNode, capabilities.workProduct.retry_max_attempts_path)) {
      return integerAtPath(bodyNode, capabilities.workProduct.retry_max_attempts_path, 0)
    }
    if (selector.includes('|')) {
      const kinds = selector.split('|')
      if (kinds.some((kind) => hasPath(bodyNode, [kind]))) {
        return capabilities.workProduct.command_prompt_default_retries
      }
    }
    if (selector === 'default') return capabilities.workProduct.other_default_retries
  }
  return capabilities.workProduct.other_default_retries
}

function valueAtPath(value: unknown, path: readonly string[]): unknown {
  let current = value
  for (const segment of path) {
    if (!isRecord(current) || !Object.hasOwn(current, segment)) return undefined
    current = current[segment]
  }
  return current
}

function hasPath(value: unknown, path: readonly string[]): boolean {
  return valueAtPath(value, path) !== undefined
}

function integerAtPath(value: unknown, path: readonly string[], fallback: number): number {
  return integer(valueAtPath(value, path), fallback)
}

function integer(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
