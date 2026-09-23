import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/svelte'
import { afterEach, vi } from 'vitest'

if (!globalThis.ResizeObserver) {
  class TestResizeObserver implements ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }

  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: TestResizeObserver,
  })
}

afterEach(() => {
  cleanup()
})

// Explicit unit-test transport: production always uses the packaged worker and never falls back.
vi.mock('$src/features/packages/package-analysis-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('./src/features/packages/package-analysis-client')>()
  return {
    ...original,
    runPackageAnalysis: async (input: import('./src/features/packages/package-analysis-pure').PackageAnalysisInput) => {
      const { processPackageAnalysisRequest } = await import('./src/features/packages/package-analysis-worker')
      const response = await processPackageAnalysisRequest({
        requestId: 'unit-test',
        sourceSnapshotToken: input.snapshot.sourceSnapshotToken,
        input,
      })
      if ('error' in response) throw new Error(response.error)
      return structuredClone(response.result)
    },
  }
})
