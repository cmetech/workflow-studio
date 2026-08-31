import { expect, test, type Page } from '@playwright/test'
import { LARGE_WORKFLOW_EDGE_COUNT, LARGE_WORKFLOW_NODE_COUNT } from '../performance/large-workflow'
import { e2eSnapshot, openSeededPair } from './support'

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
  if (browserName !== 'chromium') return null
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
  const problems = page.getByRole('region', { name: 'Problems' }).locator('[data-scroll-owner="problems"]')
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
