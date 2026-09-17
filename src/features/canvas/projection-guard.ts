import type { WorkflowProjection } from '$src/lib/projection/types'

export function isWorkflowProjection(value: unknown): value is WorkflowProjection {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).name === 'string' &&
    typeof (value as Record<string, unknown>).profile === 'string' &&
    Array.isArray((value as Record<string, unknown>).graphs)
  )
}
