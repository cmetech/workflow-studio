import { expect, test, type Page } from '@playwright/test'
import { LARGE_WORKFLOW_EDGE_COUNT, LARGE_WORKFLOW_NODE_COUNT } from '../performance/large-workflow'
import { e2eSnapshot, openSeededPair } from './support'

interface SavedLayoutEntry {
  readonly layout?: {
    readonly nodePositions?: Record<string, { readonly x: number; readonly y: number }>
  }
}

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

async function layoutPosition(page: Page, nodeId: string): Promise<{ readonly x: number; readonly y: number }> {
  const serialized = (await e2eSnapshot(page)).layout
  if (typeof serialized !== 'string') throw new Error('Expected a saved large-canvas layout record.')
  const entries = JSON.parse(serialized) as SavedLayoutEntry[]
  const position = entries.find((entry) => entry.layout?.nodePositions?.[nodeId])?.layout?.nodePositions?.[nodeId]
  if (!position) throw new Error(`Expected a saved layout position for ${nodeId}.`)
  return position
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
  const longTaskCheckpoints: { readonly label: string; readonly time: number }[] = []
  const checkpoint = async (label: string): Promise<void> => {
    if (browserName === 'chromium')
      longTaskCheckpoints.push({ label, time: await page.evaluate(() => performance.now()) })
  }

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
  await expect.poll(async () => (await e2eSnapshot(page)).projectionNodeCount).toBe(LARGE_WORKFLOW_NODE_COUNT)
  await expect.poll(async () => (await e2eSnapshot(page)).projectionEdgeCount).toBe(LARGE_WORKFLOW_EDGE_COUNT)
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

  if (browserName === 'chromium') {
    await page.evaluate(() => {
      const state = (window as unknown as { __WORKFLOW_STUDIO_LONG_TASKS__: LongTaskState })
        .__WORKFLOW_STUDIO_LONG_TASKS__
      state.observer.takeRecords()
      state.entries.length = 0
    })
  }

  await page.evaluate(() =>
    (
      window.__WORKFLOW_STUDIO_E2E__ as unknown as {
        resetMetrics(): void
      }
    ).resetMetrics(),
  )
  await checkpoint('start interaction sequence')

  const beforeYaml = (await e2eSnapshot(page)).definitionText
  const beforePosition = await layoutPosition(page, 'node-000')
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
  await expect.poll(async () => (await layoutPosition(page, 'node-000')).x).toBeGreaterThan(beforePosition.x + 80)
  await expect.poll(async () => (await layoutPosition(page, 'node-000')).y).toBeGreaterThan(beforePosition.y + 80)
  expect((await e2eSnapshot(page)).definitionText).toBe(beforeYaml)
  await checkpoint('node drag complete')

  if (browserName === 'chromium') {
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    )
    const dragLongTasks = await page.evaluate(() => {
      const state = (window as unknown as { __WORKFLOW_STUDIO_LONG_TASKS__: LongTaskState })
        .__WORKFLOW_STUDIO_LONG_TASKS__
      state.observer.takeRecords().forEach(({ startTime, duration }) => state.entries.push({ startTime, duration }))
      const entries = [...state.entries]
      state.entries.length = 0
      return entries
    })
    expect(
      dragLongTasks.filter(({ duration }) => duration > 50),
      JSON.stringify(dragLongTasks),
    ).toEqual([])
  }

  await page.evaluate(() => window.__WORKFLOW_STUDIO_E2E__!.prepareCapacityConnection())
  await expect.poll(async () => (await e2eSnapshot(page)).projectionEdgeCount).toBe(LARGE_WORKFLOW_EDGE_COUNT - 1)
  if (browserName === 'chromium') {
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    )
    await page.evaluate(() => {
      const state = (window as unknown as { __WORKFLOW_STUDIO_LONG_TASKS__: LongTaskState })
        .__WORKFLOW_STUDIO_LONG_TASKS__
      state.observer.takeRecords()
      state.entries.length = 0
    })
  }
  await checkpoint('capacity connection prepared')
  const beforeRejectedCycle = (await e2eSnapshot(page)).definitionText
  await page.evaluate(() => window.__WORKFLOW_STUDIO_E2E__!.resetMetrics())
  await dragPort(page, 'node-027', 'node-026', expectNoPortDragWork)
  await expect(page.getByRole('status', { name: 'Canvas authoring feedback' })).toContainText(/create a cycle/i)
  expect((await e2eSnapshot(page)).definitionText).toBe(beforeRejectedCycle)
  await page.evaluate(() => window.__WORKFLOW_STUDIO_E2E__!.resetMetrics())
  await dragPort(page, 'node-025', 'node-026', expectNoPortDragWork)
  await expect.poll(async () => (await e2eSnapshot(page)).projectionEdgeCount).toBe(LARGE_WORKFLOW_EDGE_COUNT)
  await expect(page.getByRole('group', { name: 'Dependency from node-025 to node-026' })).toBeAttached()
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  )
  await checkpoint('edge connected')
  const afterValidConnection = (await e2eSnapshot(page)).definitionText
  expect(afterValidConnection).not.toBe(beforeRejectedCycle)
  await checkpoint('edge interactions complete')

  await page.setViewportSize({ width: 1024, height: 700 })
  const node = page.getByRole('group', { name: /node node-000$/ })
  await node.focus()
  await node.press('Enter')
  const inspector = page.locator('aside[aria-label="Inspector"]')
  await expect(inspector).not.toHaveAttribute('inert')
  const beforeInspectorEdit = (await e2eSnapshot(page)).definitionText
  const commandField = inspector.getByRole('textbox', { name: /Command.*Required/i })
  await commandField.fill('/capacity-edited')
  await inspector.getByRole('button', { name: 'Apply Command' }).click()
  await expect.poll(async () => (await e2eSnapshot(page)).definitionText).not.toBe(beforeInspectorEdit)
  await expect.poll(async () => (await e2eSnapshot(page)).definitionText).toContain('    command: /capacity-edited\n')
  await checkpoint('inspector field applied')
  await page.getByRole('button', { name: 'Close inspector' }).click()
  await checkpoint('inspector complete')

  const problems = page.getByRole('region', { name: 'Problems' }).locator('[data-scroll-owner="problems"]')
  await expect.poll(() => problems.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  await problems.evaluate((element) => (element.scrollTop = element.scrollHeight))
  await expect.poll(() => problems.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  await checkpoint('problems scroll complete')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Back to Workflow' }).click()
  await expect.poll(async () => (await e2eSnapshot(page)).projectionNodeCount).toBe(LARGE_WORKFLOW_NODE_COUNT)
  await expect.poll(async () => (await e2eSnapshot(page)).projectionEdgeCount).toBe(LARGE_WORKFLOW_EDGE_COUNT)
  await expect.poll(() => page.locator('[data-node-id]').count()).toBeGreaterThan(0)
  await checkpoint('navigation complete')

  if (browserName === 'chromium') {
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    )
    const longTaskEntries = await page.evaluate(() => {
      const state = (window as unknown as { __WORKFLOW_STUDIO_LONG_TASKS__: LongTaskState })
        .__WORKFLOW_STUDIO_LONG_TASKS__
      state.observer.takeRecords().forEach(({ startTime, duration }) => state.entries.push({ startTime, duration }))
      state.observer.disconnect()
      return [...state.entries]
    })
    expect(
      longTaskEntries.filter(({ duration }) => duration > 50),
      JSON.stringify({ longTaskEntries, longTaskCheckpoints }),
    ).toEqual([])
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
