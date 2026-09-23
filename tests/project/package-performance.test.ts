import * as packageManifest from '$src/lib/packages/manifest'
import * as workflowYaml from '$src/lib/yaml/parse-document'
import * as artifactSyntax from '$src/features/artifacts/static-diagnostics'
import { render } from '@testing-library/svelte'
import { tick } from 'svelte'
import { afterEach, expect, it, vi } from 'vitest'
import GraphCanvas from '$src/features/canvas/GraphCanvas.svelte'
import PackageOverview from '$src/features/packages/PackageOverview.svelte'
import { PackageCatalogController } from '$src/features/packages/package-catalog-controller'
import { capturePackageAnalysis } from '$src/features/packages/package-analysis'
import { commandRegistry } from '$src/lib/commands/registry'
import { loadBundledAuthoringContracts } from '$src/lib/contract/bundled-contracts'
import {
  loadBundledWorkflowPackageContract,
  loadBundledResourceResolution,
} from '$src/lib/package-contract/bundled-package-contract'
import { createBrowserBridge } from '$src/lib/native/browser-bridge'
import { createEditorMetricsCollector, installEditorMetrics } from '$src/lib/metrics/editor-metrics'
import { clearCanvasState } from '$src/stores/canvas'
import { $packageCatalog, resetPackages } from '$src/stores/packages'
import { createLargeWorkflowFixture } from '../performance/large-workflow'
import manifest from '../fixtures/workflow-packages/laptop-diagnostic/workflow-package.json'
afterEach(() => {
  clearCanvasState()
  resetPackages()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
it('keeps package discovery, full readiness, hashing and I/O outside 250-node/500-edge pointer callbacks', async () => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1200 })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 800 })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  const fixture = createLargeWorkflowFixture()
  expect(fixture.projection.nodes).toHaveLength(250)
  expect(fixture.projection.edges).toHaveLength(500)
  const contract = await loadBundledWorkflowPackageContract()
  const original = createBrowserBridge({
    initialFiles: {
      'pkg/workflow-package.json': JSON.stringify({
        ...manifest,
        workflows: [{ definition: 'main.yaml', companion: 'main.hermes.yaml' }],
      }),
      'pkg/main.yaml': fixture.yaml.replaceAll('    command:', '    prompt:'),
      'pkg/main.hermes.yaml': 'language_compatibility: archon-2026-07\n',
      'pkg/scripts/reference.ts': 'export const reference = 1;\n',
      ...Object.fromEntries(
        Array.from({ length: 100 }, (_, index) => ['pkg/assets/info-' + index + '.txt', 'packaged data ' + index]),
      ),
    },
  })
  let inPointerFrame = false
  const io = vi.fn((name: string) => {
    if (inPointerFrame) throw Error('Native work during pointer callback: ' + name)
  })
  const native = new Proxy(original, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver)
      if (typeof value !== 'function') return value
      return (...args: unknown[]) => {
        io(String(key))
        return Reflect.apply(value, target, args)
      }
    },
  })
  const manifestParser = vi.spyOn(packageManifest, 'parsePackageManifest')
  const yamlParser = vi.spyOn(workflowYaml, 'parseWorkflowYaml')
  const scriptParser = vi.spyOn(artifactSyntax, 'analyzeArtifactSyntax')
  const metrics = createEditorMetricsCollector()
  const restore = installEditorMetrics({
    increment(metric) {
      if (inPointerFrame && !['pointerMoves', 'dragCompletions'].includes(metric))
        throw Error('Expensive editor operation during pointer callback: ' + metric)
      metrics.increment(metric)
    },
  })
  const catalog = new PackageCatalogController({
    contract,
    readManifest: async (path) => (await native.workspaceReadTextArtifact(path)).text,
  })
  try {
    const { container } = render(GraphCanvas, {
      commandSurface: commandRegistry,
      projection: fixture.projection,
      layout: fixture.layout,
    })
    await tick()
    const files = await native.workspaceScan()
    await catalog.refresh({ id: 'browser-workspace', files })
    const deps = {
      packageRoot: 'pkg',
      native,
      contract,
      resourceContract: (await loadBundledResourceResolution()).contract,
      authoring: await loadBundledAuthoringContracts(),
      index: { committedIndexText: null, workingIndexText: null, workingIndexHash: null },
    }
    const analyzed = await capturePackageAnalysis(deps)
    expect(analyzed.analysis.blockers).toEqual([])
    expect(analyzed.snapshot.files).toHaveLength(104)
    expect(manifestParser).toHaveBeenCalled()
    expect(yamlParser).toHaveBeenCalled()
    expect(scriptParser).toHaveBeenCalled()
    render(PackageOverview, { package: analyzed.package, analysis: analyzed.analysis })
    await tick()
    const canvas = container.querySelector<HTMLElement>('[data-testid="workflow-canvas"]')!
    canvas.dispatchEvent(new CustomEvent('workflowdragstart', { bubbles: true }))
    for (let batch = 0; batch < 2; batch++) {
      metrics.reset()
      io.mockClear()
      manifestParser.mockClear()
      yamlParser.mockClear()
      scriptParser.mockClear()
      for (let move = 1; move <= 500; move++) {
        inPointerFrame = true
        try {
          canvas.dispatchEvent(
            new CustomEvent('workflowdragmove', {
              bubbles: true,
              detail: { id: 'node-000', position: { x: move, y: move * 2 } },
            }),
          )
        } finally {
          inPointerFrame = false
        }
      }
      expect(io).not.toHaveBeenCalled()
      expect(manifestParser).not.toHaveBeenCalled()
      expect(yamlParser).not.toHaveBeenCalled()
      expect(scriptParser).not.toHaveBeenCalled()
      expect(metrics.snapshot()).toMatchObject({
        pointerMoves: 500,
        parseRequests: 0,
        validationPasses: 0,
        layouts: 0,
        yamlTransactions: 0,
        nativeCalls: 0,
        gitCalls: 0,
      })
      // Real package work between callbacks must not invalidate the active canvas projection.
      if (batch === 0) {
        await catalog.refresh({ id: 'browser-workspace', files })
        await capturePackageAnalysis(deps)
        await tick()
      }
    }
    expect($packageCatalog.get().phase).toBe('ready')
    expect(fixture.projection.nodes).toHaveLength(250)
  } finally {
    catalog.dispose()
    restore()
  }
})
