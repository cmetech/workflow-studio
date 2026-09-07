export function createLayoutWorker(): Worker {
  return new Worker(new URL('../../../src/workers/layout-worker.ts', import.meta.url), { type: 'module' })
}
