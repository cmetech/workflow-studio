import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { showcaseRoot, planningBody, implementationBody } from '../../src/features/canvas/fixtures/routed-layout-cases'
import {
  arrangeGraph,
  activeScopeSnapshot,
  editorMetrics,
  resetEditorMetrics,
  expectNoPointerAuthorityWork,
  installRoutedWorkerProbe,
  prepareNodeDrag,
  performNodeDrag,
  e2eSnapshot,
  expectRoutedGeometry,
  expectSingleMountedScope,
  openSeededPair,
  readCanvasGeometry,
} from './support'

const fixturePath = new URL('./fixtures/loop-group-showcase.yaml', import.meta.url)

test('[RG1] [RG2] [RG3] [RG5] [RG11] [RG14] routes and restores the literal showcase root and both loop bodies', async ({
  page,
}) => {
  const literal = await readFile(fixturePath, 'utf8')
  expect(createHash('sha256').update(literal).digest('hex')).toBe(
    '1734f0d62a5dbad01dcf6f8ed4a4aed3572c52c0d7b2033fb98157edc57523bc',
  )
  await openSeededPair(page, { scenario: 'routed-showcase' })
  expect((await e2eSnapshot(page)).definitionText).toBe(literal)
  const before = await e2eSnapshot(page)
  await arrangeGraph(page, 7, 11)
  const root = await readCanvasGeometry(page)
  expectRoutedGeometry(root, showcaseRoot.request)
  const paths = new Map<string, Awaited<ReturnType<typeof readCanvasGeometry>>>()
  for (const body of [planningBody, implementationBody]) {
    const id = body.request.identity.scopeKey.slice('loop-group:'.length)
    await page.locator(`.svelte-flow__node[data-id="${id}"]`).getByRole('button', { name: 'Open loop body' }).click()
    await expectSingleMountedScope(page, body.request.identity.scopeKey)
    await arrangeGraph(page, body.request.nodes.length, body.request.edges.length)
    const geometry = await readCanvasGeometry(page)
    expectRoutedGeometry(geometry, body.request)
    paths.set(id, geometry)
    await page.getByRole('button', { name: 'Back to root workflow' }).click()
    await expect.poll(async () => (await readCanvasGeometry(page)).edges).toEqual(root.edges)
  }
  for (const [id, geometry] of paths) {
    await page.locator(`.svelte-flow__node[data-id="${id}"]`).getByRole('button', { name: 'Open loop body' }).click()
    await expect.poll(async () => (await readCanvasGeometry(page)).edges).toEqual(geometry.edges)
    await page.getByRole('button', { name: 'Back to root workflow' }).click()
  }
  await page.getByRole('treeitem', { name: /other.yaml, paired workflow/i }).click()
  await expect(page.locator('.svelte-flow__node')).toHaveCount(2)
  await page.getByRole('treeitem', { name: /release-demo.yaml, paired workflow/i }).click()
  await expect.poll(async () => (await readCanvasGeometry(page)).edges).toEqual(root.edges)
  for (const [id, geometry] of paths) {
    await page.locator(`.svelte-flow__node[data-id="${id}"]`).getByRole('button', { name: 'Open loop body' }).click()
    await expect.poll(async () => (await readCanvasGeometry(page)).edges).toEqual(geometry.edges)
    await page.getByRole('button', { name: 'Back to root workflow' }).click()
  }
  const after = await e2eSnapshot(page)
  expect(after).toMatchObject({
    definitionText: literal,
    definitionRevision: before.definitionRevision,
    companionText: before.companionText,
    undoDepth: before.undoDepth,
    gitStatusEntries: before.gitStatusEntries,
  })
  await expect(page.getByRole('link', { name: 'Svelte Flow' })).toBeVisible()
})

test('[RG8] preserves the arranged layout on a malformed worker result and recovers on the next Arrange', async ({
  page,
}) => {
  await installRoutedWorkerProbe(page)
  await openSeededPair(page, { scenario: 'routed-showcase' })
  await arrangeGraph(page, 7, 11)
  const before = await readCanvasGeometry(page)
  const scope = await activeScopeSnapshot(page)
  await page.evaluate(() => {
    window.__ROUTED_WORKER_PROBE__!.corruptNextResult = true
  })
  await page.getByRole('button', { name: 'More canvas actions' }).click()
  await page.getByRole('menuitem', { name: 'Arrange Graph', exact: true }).click()
  await expect(
    page.getByText('Arrange Graph could not produce a safe routed layout. Your current layout was preserved.', {
      exact: true,
    }),
  ).toBeVisible()
  expect(await page.evaluate(() => window.__ROUTED_WORKER_PROBE__!.corruptedResults)).toBe(1)
  expect((await readCanvasGeometry(page)).edges).toEqual(before.edges)
  expect(await activeScopeSnapshot(page)).toMatchObject({
    positions: scope.positions,
    viewport: scope.viewport,
    selectedNodeIds: scope.selectedNodeIds,
  })
  await expect(page.getByRole('menuitem', { name: 'Arrange Graph', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await arrangeGraph(page, 7, 11)
  expectRoutedGeometry(await readCanvasGeometry(page), showcaseRoot.request)
})

test('[RG6] [RG9] falls back immediately during real dragging and persists manual positions until re-Arrange', async ({
  page,
}) => {
  await installRoutedWorkerProbe(page)
  await openSeededPair(page, { scenario: 'routed-showcase' })
  await arrangeGraph(page, 7, 11)
  const root = await readCanvasGeometry(page)
  await page
    .locator('.svelte-flow__node[data-id="planning-cycle"]')
    .getByRole('button', { name: 'Open loop body' })
    .click()
  await arrangeGraph(page, 4, 5)
  const before = await e2eSnapshot(page)
  const geometry = await readCanvasGeometry(page)
  await expect
    .poll(async () =>
      page.evaluate(
        () => window.__WORKFLOW_STUDIO_E2E__!.persistedScopeLayout('loop-group:planning-cycle').scope?.routing,
      ),
    )
    .toBeTruthy()
  const requests = await page.evaluate(() => window.__ROUTED_WORKER_PROBE__!.requests)
  const start = await prepareNodeDrag(page, 'draft-plan')
  await resetEditorMetrics(page)
  await performNodeDrag(page, start, { x: 20, y: 35 }, async () => {
    const dragging = await readCanvasGeometry(page)
    expect(dragging.edges).not.toEqual(geometry.edges)
    // Smooth-step previews attach all outgoing edges to the live centered handle.
    const outgoing = dragging.edges.filter(({ label }) => label.startsWith('Dependency from draft-plan to '))
    expect(outgoing).toHaveLength(3)
    expect(new Set(outgoing.map(({ points }) => JSON.stringify(points[0]))).size).toBe(1)
    expectNoPointerAuthorityWork(await editorMetrics(page))
    expect(await page.evaluate(() => window.__ROUTED_WORKER_PROBE__!.requests)).toBe(requests)
  })
  const manual = await activeScopeSnapshot(page)
  await expect
    .poll(async () =>
      page.evaluate(() => window.__WORKFLOW_STUDIO_E2E__!.persistedScopeLayout('loop-group:planning-cycle').scope),
    )
    .toMatchObject({ nodePositions: manual.positions })
  const persisted = await page.evaluate(
    () => window.__WORKFLOW_STUDIO_E2E__!.persistedScopeLayout('loop-group:planning-cycle').scope,
  )
  expect(persisted).not.toHaveProperty('routing')
  expect(await e2eSnapshot(page)).toMatchObject({
    definitionText: before.definitionText,
    definitionRevision: before.definitionRevision,
    undoDepth: before.undoDepth,
    gitStatusEntries: before.gitStatusEntries,
  })
  await page.getByRole('button', { name: 'Back to root workflow' }).click()
  await expect.poll(async () => (await readCanvasGeometry(page)).edges).toEqual(root.edges)
  await page
    .locator('.svelte-flow__node[data-id="planning-cycle"]')
    .getByRole('button', { name: 'Open loop body' })
    .click()
  expect((await activeScopeSnapshot(page)).positions).toEqual(manual.positions)
  expect(await page.evaluate(() => window.__ROUTED_WORKER_PROBE__!.requests)).toBe(requests)
  await arrangeGraph(page, 4, 5)
  expectRoutedGeometry(await readCanvasGeometry(page), planningBody.request)
})
