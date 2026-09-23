/** Isolated reference-performance fixture; never imported by the production bootstrap. */
import { createLargeWorkflowFixture } from '../../tests/performance/large-workflow'
import type { EditorMetricSnapshot } from '../lib/metrics/editor-metrics'
export const PACKAGE_PERFORMANCE_SCENARIO = 'package-performance'
export const packagePerformanceFiles: Readonly<Record<string, string>> = {
  'workflows/release-demo.yaml': createLargeWorkflowFixture().yaml.replaceAll('    command:', '    prompt:'),
  'workflows/release-demo.hermes.yaml': 'language_compatibility: archon-2026-07\n',
  'workflows/workflow-package.json': JSON.stringify({
    schemaVersion: 1,
    id: 'capacity-package',
    version: '1.0.0',
    displayName: 'Capacity package',
    description: 'Deterministic package readiness at the visual capacity boundary.',
    license: 'MIT',
    publisher: 'loop24-test',
    tags: ['performance'],
    workflows: [{ definition: 'release-demo.yaml', companion: 'release-demo.hermes.yaml' }],
    externalRequirements: { runtimes: [], tools: [], providers: [], services: [], secrets: [] },
  }),
  'workflows/scripts/reference.ts': 'export const reference = 1;\n',
  ...Object.fromEntries(
    Array.from({ length: 100 }, (_, index) => [
      'workflows/assets/info-' + index + '.json',
      JSON.stringify({ index, text: 'bounded package data' }),
    ]),
  ),
}
export interface PackagePerformanceResult {
  readonly ready: boolean
  readonly blockers: readonly string[]
  readonly fileCount: number
  readonly elapsedMs: number
}
const authorityKeys = [
  'parseRequests',
  'validationPasses',
  'layouts',
  'yamlTransactions',
  'nativeCalls',
  'gitCalls',
] as const
interface PackagePerformanceStatus {
  readonly running: boolean
  readonly result: PackagePerformanceResult | null
  readonly error: string | null
  readonly pointerFrames: number
  readonly authorityFrames: readonly Partial<Record<(typeof authorityKeys)[number], number>>[]
}
declare global {
  interface Window {
    __WORKFLOW_STUDIO_PACKAGE_PERFORMANCE__?: {
      ready(): Promise<void>
      run(): Promise<PackagePerformanceResult>
      start(): void
      status(): PackagePerformanceStatus
      resetPointerFrames(): void
    }
  }
}
export function installPackagePerformanceControls(metrics: () => EditorMetricSnapshot): void {
  // Warm code and trusted contracts before timing, never the actual package analysis.
  const dependencies = Promise.all([
    import('../lib/contract/bundled-contracts'),
    import('../lib/package-contract/bundled-package-contract'),
    import('../lib/native/bridge'),
    import('../features/packages/package-catalog-controller'),
    import('../features/packages/package-analysis'),
  ]).then(async ([authoring, packages, native, catalog, analysis]) => ({
    authoring: await authoring.loadBundledAuthoringContracts(),
    contract: await packages.loadBundledWorkflowPackageContract(),
    resourceContract: (await packages.loadBundledResourceResolution()).contract,
    getNativeBridge: native.getNativeBridge,
    Catalog: catalog.PackageCatalogController,
    capture: analysis.capturePackageAnalysis,
  }))
  let running = false,
    result: PackagePerformanceResult | null = null,
    error: string | null = null,
    pointerFrames = 0
  let authorityFrames: Partial<Record<(typeof authorityKeys)[number], number>>[] = []
  let catalog: InstanceType<
    typeof import('../features/packages/package-catalog-controller').PackageCatalogController
  > | null = null
  async function run(): Promise<PackagePerformanceResult> {
    if (running) throw Error('A package performance measurement is already running.')
    running = true
    result = null
    error = null
    try {
      const deps = await dependencies
      const started = performance.now()
      const native = deps.getNativeBridge()
      catalog ??= new deps.Catalog({
        contract: deps.contract,
        readManifest: async (path) => (await native.workspaceReadTextArtifact(path)).text,
      })
      await catalog.refresh({ id: 'browser-workspace', files: await native.workspaceScan() })
      const captured = await deps.capture({
        packageRoot: 'workflows',
        native,
        contract: deps.contract,
        resourceContract: deps.resourceContract,
        authoring: deps.authoring,
        index: { committedIndexText: null, workingIndexText: null, workingIndexHash: null },
      })
      result = {
        ready: captured.analysis.ready,
        blockers: captured.analysis.blockers.map((finding) => finding.code),
        fileCount: captured.snapshot.files.length,
        elapsedMs: performance.now() - started,
      }
      return result
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
      throw cause
    } finally {
      running = false
    }
  }
  document.addEventListener(
    'pointermove',
    () => {
      const before = metrics()
      // Include the synchronous event handlers and Svelte's immediate reactive flush.
      queueMicrotask(() =>
        queueMicrotask(() => {
          pointerFrames++
          const after = metrics(),
            delta: Partial<Record<(typeof authorityKeys)[number], number>> = {}
          for (const key of authorityKeys) if (after[key] !== before[key]) delta[key] = after[key] - before[key]
          if (Object.keys(delta).length) authorityFrames.push(delta)
        }),
      )
    },
    { capture: true },
  )
  window.__WORKFLOW_STUDIO_PACKAGE_PERFORMANCE__ = {
    ready: async () => {
      await dependencies
    },
    run,
    start() {
      void run().catch(() => undefined)
    },
    status: () => ({ running, result, error, pointerFrames, authorityFrames: [...authorityFrames] }),
    resetPointerFrames() {
      pointerFrames = 0
      authorityFrames = []
    },
  }
}
