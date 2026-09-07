import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'vite'
import { expect, test } from '@playwright/test'
import type { LayoutWorkerRequest, LayoutWorkerResult } from '../../src/workers/layout-worker-protocol'

let output: string
let server: Server
let origin: string
const request: LayoutWorkerRequest = {
  type: 'layout',
  identity: {
    requestId: 'browser',
    workflowIdentity: 'workflow',
    pairGeneration: 1,
    scopeKey: 'root',
    graphFingerprint: `sha256:${'a'.repeat(64)}`,
    layoutRevision: 0,
  },
  nodes: [
    { id: 'a', order: 0, width: 216, height: 104 },
    { id: 'b', order: 1, width: 216, height: 160 },
  ],
  edges: [{ id: 'ab', source: 'a', target: 'b', order: 0 }],
}

test.beforeAll(async () => {
  output = await mkdtemp(join(tmpdir(), 'workflow-studio-layout-worker-'))
  await build({
    configFile: false,
    logLevel: 'error',
    resolve: { alias: { $src: resolve('src') } },
    build: {
      outDir: output,
      lib: { entry: resolve('tests/e2e/fixtures/layout-worker-entry.ts'), formats: ['es'], fileName: 'entry' },
    },
  })
  server = createServer(async (incoming, response) => {
    if (incoming.url === '/') {
      response.setHeader('Content-Type', 'text/html')
      response.end('<!doctype html><title>Layout worker production fixture</title>')
      return
    }
    const relative = incoming.url?.slice(1) ?? ''
    if (!/^[a-zA-Z0-9_./-]+\.js$/.test(relative) || relative.includes('..')) {
      response.writeHead(404).end()
      return
    }
    try {
      response.setHeader('Content-Type', 'text/javascript')
      response.end(await readFile(join(output, relative)))
    } catch {
      response.writeHead(404).end()
    }
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing worker fixture address')
  origin = `http://127.0.0.1:${address.port}`
})

test.afterAll(async () => {
  if (server) await new Promise<void>((done, reject) => server.close((error) => (error ? reject(error) : done())))
  if (output) await rm(output, { recursive: true, force: true })
})

test('[RG13] starts the production-bundled layout worker and returns validated routes using local assets', async ({
  page,
  context,
}) => {
  const external: string[] = []
  await context.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin !== origin) {
      external.push(route.request().url())
      await route.abort()
    } else await route.continue()
  })
  await page.goto(origin)
  const response = await page.evaluate(async (input) => {
    const entry = (await import('/entry.js')) as { createLayoutWorker(): Worker }
    const worker = entry.createLayoutWorker()
    try {
      return await new Promise<LayoutWorkerResult>((done, reject) => {
        const timeout = setTimeout(() => reject(new Error('Layout worker response timed out')), 5000)
        worker.onmessage = (event) => {
          clearTimeout(timeout)
          done(event.data)
        }
        worker.onerror = (event) => {
          clearTimeout(timeout)
          reject(new Error(event.message))
        }
        worker.postMessage(input)
      })
    } finally {
      worker.terminate()
    }
  }, request)
  expect(response.type).toBe('layout-result')
  expect(response.identity).toEqual(request.identity)
  if (response.type !== 'layout-result') return
  expect(response.routes.ab?.points.length).toBeGreaterThanOrEqual(2)
  expect(response.positions.b!.x).toBeGreaterThan(response.positions.a!.x)
  expect(response).not.toHaveProperty('sections')
  expect(external).toEqual([])
  expect((await readdir(join(output, 'assets'))).some((file) => file.startsWith('layout-worker-'))).toBe(true)
})

test('[RG8] terminates the algorithm worker when its application worker is terminated', async ({
  page,
  browser,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Chromium target inspection verifies descendant lifecycle.')
  const protocol = await browser.newBrowserCDPSession()
  try {
    await page.goto(origin)
    const response = await page.evaluate(async (input) => {
      const entry = (await import('/entry.js')) as { createLayoutWorker(): Worker }
      const worker = entry.createLayoutWorker()
      ;(window as unknown as { layoutWorker: Worker }).layoutWorker = worker
      return await new Promise<LayoutWorkerResult>((done, reject) => {
        const timeout = setTimeout(() => reject(new Error('Layout worker response timed out')), 5000)
        worker.onmessage = (event) => {
          clearTimeout(timeout)
          done(event.data)
        }
        worker.onerror = (event) => {
          clearTimeout(timeout)
          reject(new Error(event.message))
        }
        worker.postMessage(input)
      })
    }, request)
    expect(response.type).toBe('layout-result')
    const workerUrls = async () =>
      (await protocol.send('Target.getTargets')).targetInfos
        .filter((target) => target.type === 'worker' && target.url.startsWith(origin))
        .map((target) => target.url)
    await expect
      .poll(workerUrls)
      .toEqual(
        expect.arrayContaining([
          expect.stringMatching(/\/layout-worker-[^/]+\.js$/),
          expect.stringMatching(/\/elk-engine-worker-[^/]+\.js$/),
        ]),
      )
    await page.evaluate(() => (window as unknown as { layoutWorker: Worker }).layoutWorker.terminate())
    await expect.poll(workerUrls).toEqual([])
    expect((await readdir(join(output, 'assets'))).some((file) => file.startsWith('elk-engine-worker-'))).toBe(true)
  } finally {
    await protocol.detach()
  }
})

test('[RG8] returns bounded failures for malformed envelopes and handles the next valid request', async ({ page }) => {
  await page.goto(origin)
  const responses = await page.evaluate(async (input) => {
    const entry = (await import('/entry.js')) as { createLayoutWorker(): Worker }
    const worker = entry.createLayoutWorker()
    const results: LayoutWorkerResult[] = []
    try {
      for (const value of [
        null,
        { ...input, identity: undefined },
        { ...input, identity: { requestId: 'private', nested: { yaml: 'do not echo' } } },
        input,
      ]) {
        results.push(
          await new Promise<LayoutWorkerResult>((done, reject) => {
            const timeout = setTimeout(() => reject(new Error('Layout worker response timed out')), 5000)
            worker.onmessage = (event) => {
              clearTimeout(timeout)
              done(event.data)
            }
            worker.onerror = (event) => {
              clearTimeout(timeout)
              reject(new Error(event.message))
            }
            worker.postMessage(value)
          }),
        )
      }
      return results
    } finally {
      worker.terminate()
    }
  }, request)
  expect(responses.slice(0, 3)).toEqual(
    Array.from({ length: 3 }, () => ({
      type: 'layout-error',
      identity: null,
      code: 'invalid_request',
      message: 'Graph arrangement request is invalid.',
    })),
  )
  expect(responses[3]).toMatchObject({ type: 'layout-result', identity: request.identity })
})
