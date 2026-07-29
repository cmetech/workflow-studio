export interface EditorMetricSnapshot {
  readonly parseRequests: number
  readonly validationPasses: number
  readonly layouts: number
  readonly yamlTransactions: number
  readonly nativeCalls: number
  readonly gitCalls: number
  readonly pointerMoves: number
  readonly dragCompletions: number
  readonly layoutSaves: number
}

export type EditorMetric = keyof EditorMetricSnapshot

export interface EditorMetrics {
  increment(metric: EditorMetric): void
}

const ZERO_METRICS: EditorMetricSnapshot = Object.freeze({
  parseRequests: 0,
  validationPasses: 0,
  layouts: 0,
  yamlTransactions: 0,
  nativeCalls: 0,
  gitCalls: 0,
  pointerMoves: 0,
  dragCompletions: 0,
  layoutSaves: 0,
})

const NOOP_METRICS: EditorMetrics = Object.freeze({ increment: () => undefined })
let activeMetrics: EditorMetrics = NOOP_METRICS

export interface EditorMetricsCollector extends EditorMetrics {
  snapshot(): EditorMetricSnapshot
  reset(): void
}

export function createEditorMetricsCollector(): EditorMetricsCollector {
  let counts: Record<EditorMetric, number> = { ...ZERO_METRICS }
  return {
    increment(metric) {
      counts[metric] += 1
    },
    snapshot() {
      return Object.freeze({ ...counts })
    },
    reset() {
      counts = { ...ZERO_METRICS }
    },
  }
}

export function recordEditorMetric(metric: EditorMetric): void {
  activeMetrics.increment(metric)
}

/** Installs a collector at production boundaries and returns an idempotent restore callback for tests. */
export function installEditorMetrics(metrics: EditorMetrics): () => void {
  const previous = activeMetrics
  activeMetrics = metrics
  let restored = false
  return () => {
    if (restored) return
    restored = true
    if (activeMetrics === metrics) activeMetrics = previous
  }
}
