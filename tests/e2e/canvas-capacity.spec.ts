import { writeFile, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import type { LayoutWorkerRequest, LayoutWorkerResult } from '../../src/workers/layout-worker-protocol'
import { expect, test, type Page, type CDPSession } from '@playwright/test'
import {
  createLargeWorkflowFixture,
  LARGE_WORKFLOW_EDGE_COUNT,
  LARGE_WORKFLOW_NODE_COUNT,
} from '../performance/large-workflow'
import { e2eSnapshot, openSeededPair } from './support'
import { enforcePerceptualPerformance, shouldRunReferenceCapacityScenario } from './performance-policy'

interface LongTaskState {
  readonly entries: { readonly startTime: number; readonly duration: number }[]
  readonly observer: PerformanceObserver
}

interface E2EMetricSnapshot {
  readonly parseRequests: number
  readonly validationPasses: number
  readonly layouts: number
  readonly yamlTransactions: number
  readonly nativeCalls: number
  readonly gitCalls: number
  readonly pointerMoves: number
}

interface CapacityProbe {
  readonly definitionRevision: number
  readonly analysisRevision: number | null
  readonly analysisCurrent: boolean
  readonly nodeCount: number
  readonly edgeCount: number
  readonly commandApplied: boolean
  readonly layoutPosition: { readonly x: number; readonly y: number } | null
}

interface PersistedLayoutProbe {
  readonly saveCount: number
  readonly position: { readonly x: number; readonly y: number } | null
}

// Playwright traces take DOM snapshots that contaminate the renderer long-task observer used by this performance spec.
test.use({ trace: 'off' })

async function capacityProbe(page: Page, nodeId = 'node-000'): Promise<CapacityProbe> {
  return page.evaluate((id) => window.__WORKFLOW_STUDIO_E2E__!.capacityProbe(id), nodeId)
}

async function activeLayoutPosition(page: Page, nodeId: string): Promise<{ readonly x: number; readonly y: number }> {
  const position = (await capacityProbe(page, nodeId)).layoutPosition
  if (!position) throw new Error(`Expected an active layout position for ${nodeId}.`)
  return position
}

async function persistedLayoutProbe(page: Page, nodeId: string): Promise<PersistedLayoutProbe> {
  return page.evaluate(
    (id) =>
      (
        window.__WORKFLOW_STUDIO_E2E__ as unknown as {
          persistedLayoutProbe(nodeId: string): PersistedLayoutProbe
        }
      ).persistedLayoutProbe(id),
    nodeId,
  )
}

async function settleRenderer(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  )
}

async function beginLongTaskPhase(page: Page, browserName: string): Promise<number | null> {
  if (!enforcePerceptualPerformance || browserName !== 'chromium') return null
  await settleRenderer(page)
  return page.evaluate(() => {
    const state = (window as unknown as { __WORKFLOW_STUDIO_LONG_TASKS__: LongTaskState })
      .__WORKFLOW_STUDIO_LONG_TASKS__
    state.observer.takeRecords()
    state.entries.length = 0
    return performance.now()
  })
}

async function expectNoLongTasks(
  page: Page,
  browserName: string,
  label: string,
  phaseStart: number | null,
): Promise<void> {
  if (browserName !== 'chromium' || phaseStart === null) return
  await settleRenderer(page)
  const entries = await page.evaluate((startTime) => {
    const state = (window as unknown as { __WORKFLOW_STUDIO_LONG_TASKS__: LongTaskState })
      .__WORKFLOW_STUDIO_LONG_TASKS__
    state.observer.takeRecords().forEach(({ startTime, duration }) => state.entries.push({ startTime, duration }))
    const phaseEntries = state.entries.filter((entry) => entry.startTime >= startTime)
    state.entries.length = 0
    return phaseEntries
  }, phaseStart)
  expect(
    entries.filter(({ duration }) => duration > 50),
    JSON.stringify({ phase: label, entries }),
  ).toEqual([])
}

async function dragNodeBy(
  page: Page,
  nodeId: string,
  delta: { readonly x: number; readonly y: number },
  onBeforeRelease?: (metrics: E2EMetricSnapshot) => void,
): Promise<void> {
  const node = page.getByRole('group', { name: new RegExp(`node ${nodeId}$`) })
  const bounds = await node.boundingBox()
  if (!bounds) throw new Error(`Expected visible node ${nodeId}.`)
  const start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + delta.x, start.y + delta.y, { steps: 5 })
  if (onBeforeRelease) {
    const metrics = await page.evaluate(() =>
      (
        window.__WORKFLOW_STUDIO_E2E__ as unknown as {
          metrics(): E2EMetricSnapshot
        }
      ).metrics(),
    )
    onBeforeRelease(metrics)
  }
  await page.mouse.up()
}

async function dragPort(
  page: Page,
  sourceId: string,
  targetId: string,
  onBeforeRelease?: (metrics: E2EMetricSnapshot) => void,
): Promise<void> {
  const source = page.locator(`[data-node-id="${sourceId}"] [data-port="output"]`)
  const target = page.locator(`[data-node-id="${targetId}"] [data-port="input"]`)
  await expect(source).toBeInViewport()
  await expect(target).toBeInViewport()
  const [sourceBounds, targetBounds] = await Promise.all([source.boundingBox(), target.boundingBox()])
  if (!sourceBounds || !targetBounds) throw new Error(`Expected visible ports for ${sourceId} and ${targetId}.`)
  const hitTargets = await page.evaluate(
    ({ sourcePoint, targetPoint }) => ({
      source: document.elementFromPoint(sourcePoint.x, sourcePoint.y)?.getAttribute('aria-label'),
      target: document.elementFromPoint(targetPoint.x, targetPoint.y)?.getAttribute('aria-label'),
    }),
    {
      sourcePoint: { x: sourceBounds.x + sourceBounds.width / 2, y: sourceBounds.y + sourceBounds.height / 2 },
      targetPoint: { x: targetBounds.x + targetBounds.width / 2, y: targetBounds.y + targetBounds.height / 2 },
    },
  )
  expect(hitTargets).toEqual({
    source: `Dependencies leaving ${sourceId}`,
    target: `Dependencies entering ${targetId}`,
  })
  await page.mouse.move(sourceBounds.x + sourceBounds.width / 2, sourceBounds.y + sourceBounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(targetBounds.x + targetBounds.width / 2, targetBounds.y + targetBounds.height / 2, {
    steps: 5,
  })
  if (onBeforeRelease) {
    const metrics = await page.evaluate(() =>
      (
        window.__WORKFLOW_STUDIO_E2E__ as unknown as {
          metrics(): E2EMetricSnapshot
        }
      ).metrics(),
    )
    onBeforeRelease(metrics)
  }
  await page.mouse.up()
}

function expectNoPortDragWork(metrics: E2EMetricSnapshot): void {
  expect(metrics).toMatchObject({
    parseRequests: 0,
    validationPasses: 0,
    layouts: 0,
    yamlTransactions: 0,
    nativeCalls: 0,
    gitCalls: 0,
    pointerMoves: 0,
  })
}

test('keeps the 250-node/500-edge canvas responsive and local-only', async ({ browserName, page }) => {
  test.setTimeout(45_000)
  await page.setViewportSize({ width: 1440, height: 900 })

  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  const consoleMessages: string[] = []
  const fontRequests: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    consoleMessages.push(message.text())
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('request', (request) => {
    if (request.resourceType() === 'font') fontRequests.push(request.url())
  })
  await page.addInitScript(() => {
    const resizeErrors: string[] = []
    Object.defineProperty(window, '__WORKFLOW_STUDIO_RESIZE_ERRORS__', { value: resizeErrors })
    window.addEventListener('error', (event) => {
      if (/ResizeObserver loop/i.test(event.message)) resizeErrors.push(event.message)
    })
  })
  if (browserName === 'chromium') {
    await page.addInitScript(() => {
      const entries: { startTime: number; duration: number }[] = []
      const observer = new PerformanceObserver((list) => {
        entries.push(...list.getEntries().map(({ startTime, duration }) => ({ startTime, duration })))
      })
      observer.observe({ type: 'longtask' })
      Object.defineProperty(window, '__WORKFLOW_STUDIO_LONG_TASKS__', {
        value: { entries, observer } satisfies LongTaskState,
      })
    })
  }

  await openSeededPair(page, '?scenario=large-canvas')
  const nodeLocator = page.locator('[data-node-id]')
  const edgeLocator = page.locator('.svelte-flow__edge')
  const pointerViewport = page.locator('[data-testid="workflow-canvas-viewport"]')
  await expect.poll(async () => (await capacityProbe(page)).nodeCount).toBe(LARGE_WORKFLOW_NODE_COUNT)
  await expect.poll(async () => (await capacityProbe(page)).edgeCount).toBe(LARGE_WORKFLOW_EDGE_COUNT)
  await expect.poll(async () => (await capacityProbe(page)).analysisCurrent).toBe(true)
  await expect.poll(() => nodeLocator.count()).toBeGreaterThan(0)
  await expect.poll(() => edgeLocator.count()).toBeGreaterThan(0)
  await expect(pointerViewport.locator('.svelte-flow__controls')).toHaveCount(0)
  await expect(pointerViewport.locator('.svelte-flow__minimap')).toHaveCount(0)

  const fontState = await page.evaluate(async () => {
    const [sans, mono] = await Promise.all([
      document.fonts.load('14px "Geist Variable"', 'Workflow Studio'),
      document.fonts.load('14px "Geist Mono Variable"', 'node-000'),
    ])
    await document.fonts.ready
    return {
      sansCount: sans.length,
      monoCount: mono.length,
      sansLoaded: sans.every((face) => face.status === 'loaded'),
      monoLoaded: mono.every((face) => face.status === 'loaded'),
      sansCheck: document.fonts.check('14px "Geist Variable"', 'Workflow Studio'),
      monoCheck: document.fonts.check('14px "Geist Mono Variable"', 'node-000'),
    }
  })
  expect(fontState).toMatchObject({
    sansLoaded: true,
    monoLoaded: true,
    sansCheck: true,
    monoCheck: true,
  })
  expect(fontState.sansCount).toBeGreaterThan(0)
  expect(fontState.monoCount).toBeGreaterThan(0)
  expect(fontRequests.length).toBeGreaterThan(0)
  const applicationOrigin = new URL(page.url()).origin
  expect(fontRequests.filter((requestUrl) => new URL(requestUrl).origin !== applicationOrigin)).toEqual([])

  await page.evaluate(() =>
    (
      window.__WORKFLOW_STUDIO_E2E__ as unknown as {
        resetMetrics(): void
      }
    ).resetMetrics(),
  )

  const beforeYaml = (await e2eSnapshot(page)).definitionText
  const beforePosition = await activeLayoutPosition(page, 'node-000')
  const beforePersistedLayout = await persistedLayoutProbe(page, 'node-000')
  const dragPhase = await beginLongTaskPhase(page, browserName)
  await dragNodeBy(page, 'node-000', { x: 110, y: 120 }, (metrics) => {
    expect(metrics.pointerMoves).toBeGreaterThan(0)
    expect(metrics).toMatchObject({
      parseRequests: 0,
      validationPasses: 0,
      layouts: 0,
      yamlTransactions: 0,
      nativeCalls: 0,
      gitCalls: 0,
    })
  })
  await expect.poll(async () => (await activeLayoutPosition(page, 'node-000')).x).toBeGreaterThan(beforePosition.x + 80)
  await expect.poll(async () => (await activeLayoutPosition(page, 'node-000')).y).toBeGreaterThan(beforePosition.y + 80)
  await expectNoLongTasks(page, browserName, 'node drag', dragPhase)
  await expect
    .poll(async () => (await persistedLayoutProbe(page, 'node-000')).saveCount)
    .toBeGreaterThan(beforePersistedLayout.saveCount)
  await expect
    .poll(async () => (await persistedLayoutProbe(page, 'node-000')).position?.x ?? 0)
    .toBeGreaterThan(beforePosition.x + 80)
  await expect
    .poll(async () => (await persistedLayoutProbe(page, 'node-000')).position?.y ?? 0)
    .toBeGreaterThan(beforePosition.y + 80)
  expect((await e2eSnapshot(page)).definitionText).toBe(beforeYaml)

  await page.evaluate(() => window.__WORKFLOW_STUDIO_E2E__!.prepareCapacityConnection())
  await expect.poll(async () => (await capacityProbe(page)).edgeCount).toBe(LARGE_WORKFLOW_EDGE_COUNT - 1)
  await expect.poll(async () => (await capacityProbe(page)).analysisCurrent).toBe(true)
  const beforeRejectedCycle = (await e2eSnapshot(page)).definitionText
  const beforeEdgeRevision = (await capacityProbe(page)).definitionRevision
  const rejectedCyclePhase = await beginLongTaskPhase(page, browserName)
  await page.evaluate(() => window.__WORKFLOW_STUDIO_E2E__!.resetMetrics())
  await dragPort(page, 'node-027', 'node-026', expectNoPortDragWork)
  await expect(page.getByRole('status', { name: 'Canvas authoring feedback' })).toContainText(/create a cycle/i)
  expect((await capacityProbe(page)).definitionRevision).toBe(beforeEdgeRevision)
  await expectNoLongTasks(page, browserName, 'cycle rejection', rejectedCyclePhase)
  expect((await e2eSnapshot(page)).definitionText).toBe(beforeRejectedCycle)

  const validConnectionPhase = await beginLongTaskPhase(page, browserName)
  await page.evaluate(() => window.__WORKFLOW_STUDIO_E2E__!.resetMetrics())
  await dragPort(page, 'node-025', 'node-026', expectNoPortDragWork)
  await expect.poll(async () => (await capacityProbe(page)).edgeCount).toBe(LARGE_WORKFLOW_EDGE_COUNT)
  await expect.poll(async () => (await capacityProbe(page)).analysisCurrent).toBe(true)
  await expect(page.getByRole('group', { name: 'Dependency from node-025 to node-026' })).toBeAttached()
  await expectNoLongTasks(page, browserName, 'valid port connection', validConnectionPhase)
  const afterValidConnection = (await e2eSnapshot(page)).definitionText
  expect(afterValidConnection).not.toBe(beforeRejectedCycle)

  // The real external viewport resize is Task 10 setup: settle it for two frames and verify compact geometry first.
  await page.setViewportSize({ width: 1024, height: 700 })
  await settleRenderer(page)
  const compactGeometry = await pointerViewport.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    return { width: bounds.width, height: bounds.height, right: bounds.right, bottom: bounds.bottom }
  })
  expect(compactGeometry.width).toBeGreaterThan(0)
  expect(compactGeometry.height).toBeGreaterThan(0)
  expect(compactGeometry.right).toBeLessThanOrEqual(1024)
  expect(compactGeometry.bottom).toBeLessThanOrEqual(700)
  // Start authoring measurement only after setup; beginLongTaskPhase drains resize records per the approved threshold wording.
  const beforeInspectorEdit = (await e2eSnapshot(page)).definitionText
  const beforeInspectorRevision = (await capacityProbe(page)).definitionRevision
  const inspectorPhase = await beginLongTaskPhase(page, browserName)
  const node = page.getByRole('group', { name: /node node-000$/ })
  await node.focus()
  await node.press('Enter')
  const inspector = page.locator('aside[aria-label="Inspector"]')
  await expect(inspector).not.toHaveAttribute('inert')
  const commandField = inspector.getByRole('textbox', { name: /Command.*Required/i })
  await commandField.fill('/capacity-edited')
  await inspector.getByRole('button', { name: 'Apply Command' }).click()
  await expect.poll(async () => (await capacityProbe(page)).definitionRevision).toBeGreaterThan(beforeInspectorRevision)
  await expect.poll(async () => (await capacityProbe(page)).commandApplied).toBe(true)
  await expect.poll(async () => (await capacityProbe(page)).analysisCurrent).toBe(true)
  await page.getByRole('button', { name: 'Close inspector' }).click()
  await expectNoLongTasks(page, browserName, 'Inspector authoring', inspectorPhase)
  const afterInspectorEdit = (await e2eSnapshot(page)).definitionText
  expect(afterInspectorEdit).not.toBe(beforeInspectorEdit)
  expect(afterInspectorEdit).toContain('    command: /capacity-edited\n')

  const problemsPhase = await beginLongTaskPhase(page, browserName)
  const problems = page.getByRole('tabpanel', { name: 'Problems' })
  await expect.poll(() => problems.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  await problems.evaluate((element) => (element.scrollTop = element.scrollHeight))
  await expect.poll(() => problems.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  await expectNoLongTasks(page, browserName, 'Problems scroll', problemsPhase)

  const navigationPhase = await beginLongTaskPhase(page, browserName)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Back to Workflow' }).click()
  await expect.poll(async () => (await capacityProbe(page)).nodeCount).toBe(LARGE_WORKFLOW_NODE_COUNT)
  await expect.poll(async () => (await capacityProbe(page)).edgeCount).toBe(LARGE_WORKFLOW_EDGE_COUNT)
  await expect.poll(async () => (await capacityProbe(page)).analysisCurrent).toBe(true)
  await expect.poll(() => page.locator('[data-node-id]').count()).toBeGreaterThan(0)
  await expectNoLongTasks(page, browserName, 'Settings navigation and return', navigationPhase)
  expect((await e2eSnapshot(page)).definitionText).toBe(afterInspectorEdit)

  if (browserName === 'chromium') {
    await page.evaluate(() => {
      const state = (window as unknown as { __WORKFLOW_STUDIO_LONG_TASKS__: LongTaskState })
        .__WORKFLOW_STUDIO_LONG_TASKS__
      state.observer.disconnect()
    })
  }

  const resizeErrors = await page.evaluate(
    () => (window as unknown as { __WORKFLOW_STUDIO_RESIZE_ERRORS__: string[] }).__WORKFLOW_STUDIO_RESIZE_ERRORS__,
  )
  expect(pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])
  expect(
    [...pageErrors, ...consoleMessages, ...resizeErrors].filter((message) => /ResizeObserver loop/i.test(message)),
  ).toEqual([])
})

interface ArrangeCapacityRun {
  durationMs: number
  points: number
  responseType: string
  elapsedMs: number
}
interface ArrangeCapacityState {
  requests: number
  responses: number
  runs: ArrangeCapacityRun[]
  dropNext: boolean
  terminations: number
}

declare global {
  interface Window {
    __ARRANGE_CAPACITY__: ArrangeCapacityState
  }
}

async function installArrangeCapacityProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state: ArrangeCapacityState = { requests: 0, responses: 0, runs: [], dropNext: false, terminations: 0 }
    window.__ARRANGE_CAPACITY__ = state
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      private layoutWorker: boolean
      private sentAt = 0
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        this.layoutWorker = String(url).includes('layout-worker')
        if (this.layoutWorker) {
          super.addEventListener('message', (event: MessageEvent) => {
            state.responses++
            const result = event.data
            state.runs.push({
              durationMs: result.durationMs ?? -1,
              points: Object.values(result.routes ?? {}).reduce<number>(
                (sum, route) => sum + (route as { points: unknown[] }).points.length,
                0,
              ),
              responseType: result.type,
              elapsedMs: performance.now() - this.sentAt,
            })
          })
        }
      }
      override postMessage(message: unknown, transfer: Transferable[]): void
      override postMessage(message: unknown, options?: StructuredSerializeOptions): void
      override postMessage(message: unknown, options?: Transferable[] | StructuredSerializeOptions): void {
        if (this.layoutWorker) {
          state.requests++
          this.sentAt = performance.now()
          if (state.dropNext) {
            state.dropNext = false
            return
          }
        }
        if (Array.isArray(options)) super.postMessage(message, options)
        else super.postMessage(message, options)
      }
      override terminate(): void {
        if (this.layoutWorker) state.terminations++
        super.terminate()
      }
    }
    const entries: { startTime: number; duration: number }[] = []
    const observer = new PerformanceObserver((list) => {
      entries.push(...list.getEntries().map(({ startTime, duration }) => ({ startTime, duration })))
    })
    if (PerformanceObserver.supportedEntryTypes.includes('longtask')) observer.observe({ type: 'longtask' })
    Object.defineProperty(window, '__WORKFLOW_STUDIO_LONG_TASKS__', { value: { entries, observer } })
  })
}

async function invokeArrange(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'More canvas actions' }).click()
  await page.getByRole('menuitem', { name: 'Arrange Graph', exact: true }).click()
}

interface TraceEvent {
  name: string
  ph: string
  tid: number
  pid: number
  dur?: number
  args?: { name?: string }
}

async function finishMainTaskTrace(session: CDPSession): Promise<{ maximumMs: number; taskCount: number }> {
  const completed = new Promise<{ stream: string }>((resolve) => session.once('Tracing.tracingComplete', resolve))
  await session.send('Tracing.end')
  const { stream } = await completed
  let source = ''
  for (;;) {
    const chunk = await session.send('IO.read', { handle: stream })
    source += chunk.data
    if (chunk.eof) break
  }
  await session.send('IO.close', { handle: stream })
  await session.detach()
  const { traceEvents } = JSON.parse(source) as { traceEvents: TraceEvent[] }
  const mainThreads = new Set(
    traceEvents
      .filter((event) => event.name === 'thread_name' && event.args?.name === 'CrRendererMain')
      .map(({ pid, tid }) => `${pid}:${tid}`),
  )
  const durations = traceEvents
    .filter(
      (event) =>
        mainThreads.has(`${event.pid}:${event.tid}`) &&
        event.ph === 'X' &&
        event.name === 'ThreadControllerImpl::RunTask',
    )
    .map((event) => event.dur! / 1000)
  expect(durations.length, 'Chromium top-level renderer task trace must contain actual samples').toBeGreaterThan(0)
  return { maximumMs: Math.max(...durations), taskCount: durations.length }
}

test('[RG12] explicitly arranges fixed-seed 250/500 with one bounded real-worker response and no main-thread long task', async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(
    !shouldRunReferenceCapacityScenario(enforcePerceptualPerformance, browserName),
    'Shared CI retains the Chromium capacity path; complete cross-engine acceptance runs on reference hardware.',
  )
  test.setTimeout(60_000)
  await installArrangeCapacityProbe(page)
  await openSeededPair(page, '?scenario=routed-capacity')
  await expect.poll(async () => (await capacityProbe(page)).analysisCurrent).toBe(true)
  const yaml = (await e2eSnapshot(page)).definitionText
  expect(yaml).toBe(createLargeWorkflowFixture().yaml)
  const session =
    enforcePerceptualPerformance && browserName === 'chromium' ? await page.context().newCDPSession(page) : null
  if (session) await session.send('Tracing.start', { categories: 'toplevel', transferMode: 'ReturnAsStream' })
  for (let run = 0; run < 4; run++) {
    const phase = await beginLongTaskPhase(page, browserName)
    await invokeArrange(page)
    await expect(page.getByRole('status', { name: 'Canvas authoring feedback' })).toHaveText(
      'Graph arranged: 250 nodes and 500 dependencies.',
      { timeout: 10_000 },
    )
    await expectNoLongTasks(page, browserName, `Arrange ${run === 0 ? 'cold' : 'warmed'} ${run}`, phase)
    const state = await page.evaluate(() => window.__ARRANGE_CAPACITY__)
    expect(state.requests).toBe(run + 1)
    expect(state.responses).toBe(run + 1)
    expect(state.runs[run]!.responseType).toBe('layout-result')
    expect(state.runs[run]!.points).toBeGreaterThanOrEqual(1_000)
    expect(state.runs[run]!.points).toBeLessThanOrEqual(32_000)
    if (enforcePerceptualPerformance && run > 0) expect(state.runs[run]!.durationMs).toBeLessThanOrEqual(3_000)
    await page.keyboard.press('Escape')
  }
  const state = await page.evaluate(() => window.__ARRANGE_CAPACITY__)
  const mainTasks = session ? await finishMainTaskTrace(session) : null
  if (mainTasks) expect(mainTasks.maximumMs).toBeLessThanOrEqual(50)
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Object.keys(window.__WORKFLOW_STUDIO_E2E__!.persistedScopeLayout('root').scope?.routing?.routes ?? {}).length,
      ),
    )
    .toBe(500)
  const rendering = await page.evaluate(async () => {
    const modulePath = '/src/features/canvas/edge-route-path.ts'
    const { roundedOrthogonalPath } = await import(/* @vite-ignore */ modulePath)
    const routes = window.__WORKFLOW_STUDIO_E2E__!.persistedScopeLayout('root').scope!.routing!.routes
    const rejected = Object.values(routes)
      .filter((route) => !roundedOrthogonalPath(route.points))
      .map((route) => route.edgeId)
    const mounted = [...document.querySelectorAll('.svelte-flow__edge[data-id]')]
    const fallback = mounted
      .filter((edge) => {
        const route = routes[edge.getAttribute('data-id')!]
        const path = edge.querySelector('.workflow-edge')?.getAttribute('d') ?? ''
        const first = route?.points[0],
          last = route?.points.at(-1)
        return !first || !last || !path.startsWith(`M ${first.x} ${first.y}`) || !path.endsWith(`${last.x} ${last.y}`)
      })
      .map((edge) => edge.getAttribute('data-id'))
    return { rejected, fallback, mounted: mounted.length }
  })
  expect(rendering.rejected).toEqual([])
  expect(rendering.fallback).toEqual([])
  expect(rendering.mounted).toBeGreaterThan(0)
  const evidencePath = testInfo.outputPath('arrange-capacity.json')
  await writeFile(evidencePath, JSON.stringify({ ...state, mainTasks, rendering }, null, 2))
  await testInfo.attach('arrange-capacity.json', { path: evidencePath, contentType: 'application/json' })
  expect((await e2eSnapshot(page)).definitionText).toBe(yaml)

  // Exercise the real inspector/analysis path with all accepted routes active.
  const node = page.locator('.svelte-flow__node[data-id]').first()
  await node.focus()
  await node.press('Enter')
  const inspector = page.locator('aside[aria-label="Inspector"]')
  await inspector.getByRole('textbox', { name: /Command.*Required/i }).fill('/capacity-edited')
  const beforeRevision = (await capacityProbe(page)).definitionRevision
  await page.evaluate(() => {
    const paths = new Map(
      [...document.querySelectorAll('.svelte-flow__edge[data-id]')].map((edge) => [
        edge.getAttribute('data-id'),
        edge.querySelector('.workflow-edge')?.getAttribute('d'),
      ]),
    )
    const changes: string[] = []
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        const path = record.target as Element
        if (!path.matches('.workflow-edge')) continue
        const id = path.closest('[data-id]')?.getAttribute('data-id') ?? ''
        if (paths.has(id) && path.getAttribute('d') !== paths.get(id)) changes.push(id)
      }
    })
    observer.observe(document.querySelector('.graph-canvas')!, {
      subtree: true,
      attributes: true,
      attributeFilter: ['d'],
    })
    Object.assign(window, { __ROUTE_CONTENT_PROBE__: { observer, changes } })
  })
  const contentSession =
    enforcePerceptualPerformance && browserName === 'chromium' ? await page.context().newCDPSession(page) : null
  if (contentSession)
    await contentSession.send('Tracing.start', { categories: 'toplevel', transferMode: 'ReturnAsStream' })
  const contentPhase = await beginLongTaskPhase(page, browserName)
  await inspector.getByRole('button', { name: 'Apply Command' }).click()
  await expect.poll(async () => (await capacityProbe(page)).definitionRevision).toBeGreaterThan(beforeRevision)
  await expect.poll(async () => (await capacityProbe(page)).analysisCurrent).toBe(true)
  await expectNoLongTasks(page, browserName, 'Routed content-only analysis', contentPhase)
  const contentMainTasks = contentSession ? await finishMainTaskTrace(contentSession) : null
  if (contentMainTasks) expect(contentMainTasks.maximumMs).toBeLessThanOrEqual(50)
  const changedPaths = await page.evaluate(() => {
    const probe = (window as unknown as { __ROUTE_CONTENT_PROBE__: { observer: MutationObserver; changes: string[] } })
      .__ROUTE_CONTENT_PROBE__
    probe.observer.disconnect()
    return probe.changes
  })
  expect(changedPaths).toEqual([])
  expect((await page.evaluate(() => window.__ARRANGE_CAPACITY__)).requests).toBe(4)
  const contentEvidencePath = testInfo.outputPath('routed-content-capacity.json')
  await writeFile(contentEvidencePath, JSON.stringify({ contentMainTasks, changedPaths }, null, 2))
  await testInfo.attach('routed-content-capacity.json', { path: contentEvidencePath, contentType: 'application/json' })
})

test('[RG8] times out after 5,000ms without changing layout and recovers with a new worker', async ({ page }) => {
  test.setTimeout(25_000)
  await installArrangeCapacityProbe(page)
  await openSeededPair(page, '?scenario=large-canvas')
  const before = await page.evaluate(() => window.__WORKFLOW_STUDIO_E2E__!.scopeSnapshot())
  await page.evaluate(() => {
    window.__ARRANGE_CAPACITY__.dropNext = true
  })
  const started = Date.now()
  await invokeArrange(page)
  await expect(page.getByRole('status', { name: 'Canvas authoring feedback' })).toHaveText(
    'Arrange Graph could not produce a safe routed layout. Your current layout was preserved.',
    { timeout: 8_000 },
  )
  expect(Date.now() - started).toBeGreaterThanOrEqual(5_000)
  expect(Date.now() - started).toBeLessThan(8_000)
  const timedOut = await page.evaluate(() => window.__ARRANGE_CAPACITY__)
  expect(timedOut).toMatchObject({ requests: 1, responses: 0, terminations: 1 })
  expect(await page.evaluate(() => window.__WORKFLOW_STUDIO_E2E__!.scopeSnapshot())).toEqual(before)
  await page.keyboard.press('Escape')
  await invokeArrange(page)
  await expect(page.getByRole('status', { name: 'Canvas authoring feedback' })).toHaveText(
    'Graph arranged: 250 nodes and 500 dependencies.',
    { timeout: 10_000 },
  )
  expect(await page.evaluate(() => window.__ARRANGE_CAPACITY__)).toMatchObject({
    requests: 2,
    responses: 1,
    terminations: 1,
  })
})

test('[RG13] arranges with the exact emitted production worker assets while external networking is blocked', async ({
  page,
  context,
}) => {
  test.setTimeout(30_000)
  const output = await mkdtemp(join(tmpdir(), 'workflow-studio-offline-routing-'))
  const sources = new Map<string, string>()
  const served: string[] = []
  const server = createServer((request, response) => {
    const path = request.url ?? '/'
    if (path === '/') {
      response.setHeader('Content-Type', 'text/html')
      response.end('<!doctype html><title>Offline production layout</title>')
    } else if (sources.has(path)) {
      served.push(path)
      response.setHeader('Content-Type', 'text/javascript')
      response.end(sources.get(path))
    } else response.writeHead(404).end()
  })
  try {
    execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', output], {
      stdio: 'pipe',
      timeout: 90_000,
    })
    const files = await readdir(join(output, 'assets'))
    const worker = files.find((file) => /^layout-worker-.*\.js$/.test(file))!
    const algorithm = files.find((file) => /^elk-engine-worker-.*\.js$/.test(file))!
    expect(worker).toBeTruthy()
    expect(algorithm).toBeTruthy()
    for (const file of [worker, algorithm])
      sources.set(`/assets/${file}`, await readFile(join(output, 'assets', file), 'utf8'))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing local fixture address')
    const origin = `http://127.0.0.1:${address.port}`
    const attempted: string[] = []
    await context.route('**/*', async (route) => {
      if (new URL(route.request().url()).origin !== origin) {
        attempted.push(route.request().url())
        await route.abort()
      } else await route.continue()
    })
    await page.goto(origin)
    const fixture = createLargeWorkflowFixture()
    const request: LayoutWorkerRequest = {
      type: 'layout',
      identity: {
        requestId: 'offline',
        workflowIdentity: 'offline',
        pairGeneration: 1,
        scopeKey: 'root',
        graphFingerprint: `sha256:${'a'.repeat(64)}`,
        layoutRevision: 0,
      },
      nodes: fixture.projection.nodes.map(({ id }, order) => ({ id, order, width: 216, height: 104 })),
      edges: fixture.projection.edges.map(({ id, source, target }, order) => ({ id, source, target, order })),
    }
    const result = await page.evaluate(
      async ({ worker, request }) => {
        const endpoint = new Worker(`/assets/${worker}`, { type: 'module' })
        try {
          return await new Promise<LayoutWorkerResult>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Offline worker timed out')), 5_000)
            endpoint.onmessage = (event) => {
              clearTimeout(timer)
              resolve(event.data)
            }
            endpoint.onerror = (event) => {
              clearTimeout(timer)
              reject(new Error(event.message))
            }
            endpoint.postMessage(request)
          })
        } finally {
          endpoint.terminate()
        }
      },
      { worker, request },
    )
    expect(result.type).toBe('layout-result')
    expect(result.identity).toEqual(request.identity)
    if (result.type !== 'layout-result') return
    expect(Object.keys(result.routes)).toHaveLength(500)
    expect(Object.values(result.routes).reduce((count, route) => count + route.points.length, 0)).toBeLessThanOrEqual(
      32_000,
    )
    expect(served.sort()).toEqual([`/assets/${worker}`, `/assets/${algorithm}`].sort())
    expect(attempted).toEqual([])
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(output, { recursive: true, force: true })
  }
})
