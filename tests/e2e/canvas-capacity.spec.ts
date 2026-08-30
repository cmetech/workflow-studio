import { expect, test, type Page } from '@playwright/test'
import { LARGE_WORKFLOW_EDGE_COUNT, LARGE_WORKFLOW_NODE_COUNT } from '../performance/large-workflow'
import { e2eSnapshot, openSeededPair } from './support'

interface SavedLayoutEntry {
  readonly layout?: {
    readonly nodePositions?: Record<string, { readonly x: number; readonly y: number }>
  }
}

interface LongTaskState {
  readonly durations: number[]
  readonly observer: PerformanceObserver
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
): Promise<void> {
  const node = page.getByRole('group', { name: new RegExp(`node ${nodeId}$`) })
  const bounds = await node.boundingBox()
  if (!bounds) throw new Error(`Expected visible node ${nodeId}.`)
  const start = { x: bounds.x + bounds.width / 2, y: bounds.y + 40 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + delta.x, start.y + delta.y, { steps: 5 })
  await page.mouse.up()
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
      const durations: number[] = []
      const observer = new PerformanceObserver((list) => {
        durations.push(...list.getEntries().map(({ duration }) => duration))
      })
      observer.observe({ type: 'longtask' })
      Object.defineProperty(window, '__WORKFLOW_STUDIO_LONG_TASKS__', {
        value: { durations, observer } satisfies LongTaskState,
      })
    })
  }

  await openSeededPair(page, '?scenario=large-canvas')
  const nodeLocator = page.locator('[data-node-id]')
  const edgeLocator = page.locator('.svelte-flow__edge')
  await expect(nodeLocator).toHaveCount(LARGE_WORKFLOW_NODE_COUNT)
  await expect(edgeLocator).toHaveCount(LARGE_WORKFLOW_EDGE_COUNT)

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
      state.durations.length = 0
    })
  }

  const beforeYaml = (await e2eSnapshot(page)).definitionText
  const beforePosition = await layoutPosition(page, 'node-000')
  await dragNodeBy(page, 'node-000', { x: 110, y: 120 })
  await expect.poll(async () => (await layoutPosition(page, 'node-000')).x).toBeGreaterThan(beforePosition.x + 80)
  await expect.poll(async () => (await layoutPosition(page, 'node-000')).y).toBeGreaterThan(beforePosition.y + 80)
  expect((await e2eSnapshot(page)).definitionText).toBe(beforeYaml)

  if (browserName === 'chromium') {
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    )
    const longTaskDurations = await page.evaluate(() => {
      const state = (window as unknown as { __WORKFLOW_STUDIO_LONG_TASKS__: LongTaskState })
        .__WORKFLOW_STUDIO_LONG_TASKS__
      state.observer.takeRecords().forEach(({ duration }) => state.durations.push(duration))
      state.observer.disconnect()
      return [...state.durations]
    })
    expect(longTaskDurations.filter((duration) => duration > 50)).toEqual([])
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
