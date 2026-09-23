import { expect, test, type Page } from '@playwright/test'
import { PACKAGE_PERFORMANCE_SCENARIO } from '../../src/e2e/package-performance-fixture'
import { openSeededPair, settleRenderer } from './support'
interface LongTaskProbe {
  entries: { startTime: number; duration: number }[]
  observer: PerformanceObserver
}
declare global {
  interface Window {
    __PACKAGE_LONG_TASKS__?: LongTaskProbe
  }
}
// Trace DOM snapshots contaminate the renderer measurement; the existing 50ms threshold remains unchanged.
test.use({ trace: 'off', screenshot: 'off', viewport: { width: 1440, height: 900 } })
async function begin(page: Page) {
  await settleRenderer(page)
  return page.evaluate(() => {
    const probe = window.__PACKAGE_LONG_TASKS__!
    probe.observer.takeRecords()
    probe.entries.length = 0
    return performance.now()
  })
}
async function sample(page: Page, start: number) {
  await settleRenderer(page)
  return page.evaluate((time) => {
    const probe = window.__PACKAGE_LONG_TASKS__!
    probe.entries.push(...probe.observer.takeRecords().map(({ startTime, duration }) => ({ startTime, duration })))
    return probe.entries.filter((entry) => entry.startTime >= time)
  }, start)
}
test('keeps 250-node/500-edge package refresh and readiness responsive without authority work in pointer frames @reference-performance', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'The Long Tasks API measurement requires Chromium.')
  test.setTimeout(90_000)
  await page.addInitScript(() => {
    const entries: { startTime: number; duration: number }[] = []
    const observer = new PerformanceObserver((list) => {
      entries.push(...list.getEntries().map(({ startTime, duration }) => ({ startTime, duration })))
    })
    observer.observe({ type: 'longtask' })
    window.__PACKAGE_LONG_TASKS__ = { entries, observer }
  })
  await openSeededPair(page, { scenario: PACKAGE_PERFORMANCE_SCENARIO })
  await expect
    .poll(() => page.evaluate(() => window.__WORKFLOW_STUDIO_E2E__!.capacityProbe('node-000').nodeCount))
    .toBe(250)
  await expect
    .poll(() => page.evaluate(() => window.__WORKFLOW_STUDIO_E2E__!.capacityProbe('node-000').edgeCount))
    .toBe(500)
  await page.evaluate(async () => {
    await document.fonts.ready
    await window.__WORKFLOW_STUDIO_PACKAGE_PERFORMANCE__!.ready()
  })
  const first = await begin(page)
  const cold = await page.evaluate(() => window.__WORKFLOW_STUDIO_PACKAGE_PERFORMANCE__!.run())
  expect(cold.ready, cold.blockers.join(', ')).toBe(true)
  expect(cold.fileCount).toBe(104)
  const coldLongTasks = await sample(page, first)
  expect
    .soft(
      coldLongTasks.filter((entry) => entry.duration > 50),
      JSON.stringify({ phase: 'first package readiness', cold, coldLongTasks }),
    )
    .toEqual([])
  const node = page.getByRole('group', { name: /node node-000$/ })
  await node.click()
  await settleRenderer(page)
  const bounds = await node.boundingBox()
  if (!bounds) throw Error('The capacity node must be visible')
  const x = bounds.x + bounds.width / 2,
    y = bounds.y + bounds.height / 2
  await page.mouse.move(x, y)
  const concurrentStart = await begin(page)
  await page.mouse.down()
  await page.evaluate(() => {
    window.__WORKFLOW_STUDIO_PACKAGE_PERFORMANCE__!.resetPointerFrames()
    window.__WORKFLOW_STUDIO_PACKAGE_PERFORMANCE__!.start()
  })
  await page.mouse.move(x + 90, y + 70, { steps: 30 })
  await page.mouse.up()
  await expect
    .poll(() => page.evaluate(() => window.__WORKFLOW_STUDIO_PACKAGE_PERFORMANCE__!.status().running))
    .toBe(false)
  const status = await page.evaluate(() => window.__WORKFLOW_STUDIO_PACKAGE_PERFORMANCE__!.status())
  expect(status.error).toBeNull()
  expect(status.result?.ready).toBe(true)
  expect(status.pointerFrames).toBeGreaterThan(0)
  expect(status.authorityFrames).toEqual([])
  expect(await page.evaluate(() => window.__WORKFLOW_STUDIO_E2E__!.metrics().pointerMoves)).toBeGreaterThan(0)
  const concurrentLongTasks = await sample(page, concurrentStart)
  const report = { cold, coldLongTasks, concurrent: status, concurrentLongTasks }
  console.info('PACKAGE_PERFORMANCE ' + JSON.stringify(report))
  await test
    .info()
    .attach('package-performance.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' })
  expect(
    concurrentLongTasks.filter((entry) => entry.duration > 50),
    JSON.stringify({ phase: 'package readiness during drag', concurrentLongTasks }),
  ).toEqual([])
})
