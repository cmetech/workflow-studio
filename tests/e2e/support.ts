import { expect, type Page } from '@playwright/test'
import type { EditorMetricSnapshot } from '../../src/lib/metrics/editor-metrics'
import type { GraphScopeKey } from '../../src/lib/projection/types'

export interface ExactGeometry {
  readonly label: string
  readonly viewport: { readonly width: number; readonly height: number }
}

export const EXACT_GEOMETRIES: readonly ExactGeometry[] = [
  { label: '1024x700', viewport: { width: 1024, height: 700 } },
  { label: '1280x800', viewport: { width: 1280, height: 800 } },
  { label: '1440x900', viewport: { width: 1440, height: 900 } },
  { label: 'effective 200% (512x350 CSS viewport)', viewport: { width: 512, height: 350 } },
]

export async function expectExactWorkbenchGeometry(page: Page): Promise<void> {
  const geometry = await page.evaluate(() => {
    const root = document.documentElement
    const status = document.querySelector<HTMLElement>('[aria-label="Application status"]')
    if (!status) throw new Error('Expected the application status bar.')
    return {
      innerWidth,
      innerHeight,
      scrollHeight: root.scrollHeight,
      clientHeight: root.clientHeight,
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      statusBottom: status.getBoundingClientRect().bottom,
    }
  })
  expect(geometry.scrollHeight).toBe(geometry.clientHeight)
  expect(geometry.scrollWidth).toBe(geometry.clientWidth)
  expect(geometry.statusBottom).toBeLessThanOrEqual(geometry.innerHeight)
  expect(geometry.statusBottom).toBeGreaterThan(0)
  expect(geometry.clientWidth).toBe(geometry.innerWidth)
  expect(geometry.clientHeight).toBe(geometry.innerHeight)
}

export interface SeededPairOptions {
  readonly scenario: string
  readonly pairName?: string
}

export interface ActiveScopeSnapshot {
  readonly workflowId: string | null
  readonly definitionRevision: number
  readonly activeScopeKey: GraphScopeKey | null
  readonly selectedNodeIds: readonly string[]
  readonly viewport: { readonly x: number; readonly y: number; readonly zoom: number } | null
  readonly positions: Readonly<Record<string, { readonly x: number; readonly y: number }>>
  readonly focusTarget: Readonly<Record<string, unknown>> | null
  readonly inspector: { readonly tab: string; readonly scrollTop: number } | null
  readonly canvasScroll: { readonly left: number; readonly top: number } | null
  readonly yamlScroll: number
  readonly problemsScroll: number
  readonly mountedSvelteFlowCount: number
}

export async function openSeededPair(page: Page, options?: string | SeededPairOptions): Promise<void> {
  const query =
    typeof options === 'string' ? options : options ? `?scenario=${encodeURIComponent(options.scenario)}` : ''
  const pairName = typeof options === 'object' ? (options.pairName ?? 'release-demo.yaml') : 'release-demo.yaml'
  await page.goto(`/${query}`)
  await page.getByRole('button', { name: 'Open Folder' }).first().click()
  const compact = (page.viewportSize()?.width ?? 1280) < 1280
  if (compact) await page.getByRole('button', { name: 'Explorer', exact: true }).click()
  const pair = page.getByRole('treeitem', { name: new RegExp(`${escapeRegExp(pairName)}, paired workflow`, 'i') })
  await expect(pair).toBeVisible()
  await pair.click()
  await expect
    .poll(async () => {
      const snapshot = await e2eSnapshot(page)
      return (
        typeof snapshot.definitionRevision === 'number' &&
        snapshot.analysisDefinitionRevision === snapshot.definitionRevision
      )
    })
    .toBe(true)
  await expect(page.getByRole('region', { name: 'Workflow graph' })).toBeVisible()
  if (compact) {
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Explorer', exact: true })).toBeFocused()
  }
}

export function modShortcut(key: string): string {
  return process.platform === 'darwin' ? `Meta+${key}` : `Control+${key}`
}

export async function settleRenderer(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  )
}

export async function editorMetrics(page: Page): Promise<EditorMetricSnapshot> {
  return page.evaluate(() => window.__WORKFLOW_STUDIO_E2E__!.metrics())
}

export async function resetEditorMetrics(page: Page): Promise<void> {
  await page.evaluate(() => window.__WORKFLOW_STUDIO_E2E__!.resetMetrics())
}

export function expectNoPointerAuthorityWork(metrics: EditorMetricSnapshot): void {
  expect(metrics).toMatchObject({
    parseRequests: 0,
    validationPasses: 0,
    layouts: 0,
    yamlTransactions: 0,
    nativeCalls: 0,
    gitCalls: 0,
    layoutSaves: 0,
  })
}

export async function activeScopeSnapshot(page: Page): Promise<ActiveScopeSnapshot> {
  return page.evaluate(() => window.__WORKFLOW_STUDIO_E2E__!.scopeSnapshot())
}

export async function expectSingleMountedScope(page: Page, scopeKey: GraphScopeKey): Promise<void> {
  await expect(page.locator('.svelte-flow')).toHaveCount(1)
  await expect(page.getByTestId('workflow-canvas')).toHaveAttribute('data-scope-key', scopeKey)
  await expect(page.getByTestId('workflow-canvas')).toHaveAttribute('aria-busy', 'false')
}

export interface NodeDragStart {
  readonly x: number
  readonly y: number
}

export async function prepareNodeDrag(page: Page, nodeId: string): Promise<NodeDragStart> {
  const node = page.locator(`.svelte-flow__node[data-id="${nodeId}"]`)
  await expect(node).toBeInViewport()
  const start = await node.evaluate((element, expectedNodeId) => {
    const bounds = element.getBoundingClientRect()
    const left = Math.max(0, Math.ceil(bounds.left))
    const right = Math.min(innerWidth - 1, Math.floor(bounds.right))
    const top = Math.max(0, Math.ceil(bounds.top))
    const bottom = Math.min(innerHeight - 1, Math.floor(bounds.bottom))
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        const target = document.elementFromPoint(x, y)
        if (
          target?.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId === expectedNodeId &&
          !target.closest('button, [data-port], .nodrag')
        ) {
          return { x, y }
        }
      }
    }
    return null
  }, nodeId)
  if (!start) throw new Error(`Node ${nodeId} has no truthful draggable hit target.`)
  return start
}

export async function performNodeDrag(
  page: Page,
  start: NodeDragStart,
  delta: { readonly x: number; readonly y: number },
  beforeRelease?: () => Promise<void>,
  steps = 5,
): Promise<void> {
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + delta.x, start.y + delta.y, { steps })
  await beforeRelease?.()
  await page.mouse.up()
}

export async function dragNodeBy(
  page: Page,
  nodeId: string,
  delta: { readonly x: number; readonly y: number },
  beforeRelease?: () => Promise<void>,
): Promise<void> {
  await performNodeDrag(page, await prepareNodeDrag(page, nodeId), delta, beforeRelease)
}

export interface PortDragPoints {
  readonly source: { readonly x: number; readonly y: number }
  readonly target: { readonly x: number; readonly y: number }
}

export async function preparePortDrag(page: Page, sourceId: string, targetId: string): Promise<PortDragPoints> {
  const source = page.locator(`[data-node-id="${sourceId}"] [data-port="output"]`)
  const target = page.locator(`[data-node-id="${targetId}"] [data-port="input"]`)
  const [sourceBox, targetBox] = await Promise.all([source.boundingBox(), target.boundingBox()])
  if (!sourceBox || !targetBox) throw new Error(`Connection ${sourceId} -> ${targetId} has no port geometry.`)
  const hitTargets = await page.evaluate(
    ({ sourcePoint, targetPoint }) => ({
      source: document.elementFromPoint(sourcePoint.x, sourcePoint.y)?.getAttribute('aria-label'),
      target: document.elementFromPoint(targetPoint.x, targetPoint.y)?.getAttribute('aria-label'),
    }),
    {
      sourcePoint: { x: sourceBox.x + sourceBox.width / 2, y: sourceBox.y + sourceBox.height / 2 },
      targetPoint: { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height / 2 },
    },
  )
  expect(hitTargets, JSON.stringify({ sourceBox, targetBox })).toEqual({
    source: `Dependencies leaving ${sourceId}`,
    target: `Dependencies entering ${targetId}`,
  })
  return {
    source: { x: sourceBox.x + sourceBox.width / 2, y: sourceBox.y + sourceBox.height / 2 },
    target: { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height / 2 },
  }
}

export async function performPortDrag(
  page: Page,
  points: PortDragPoints,
  beforeRelease?: () => Promise<void>,
  steps = 5,
): Promise<void> {
  await page.mouse.move(points.source.x, points.source.y)
  await page.mouse.down()
  await page.mouse.move(points.target.x, points.target.y, { steps })
  await beforeRelease?.()
  await page.mouse.up()
}

export async function dragPort(
  page: Page,
  sourceId: string,
  targetId: string,
  beforeRelease?: () => Promise<void>,
): Promise<void> {
  await performPortDrag(page, await preparePortDrag(page, sourceId, targetId), beforeRelease)
}

export async function replaceDefinitionYaml(page: Page, text: string): Promise<void> {
  await page
    .getByRole('group', { name: 'Editor mode' })
    .locator(':scope > button')
    .filter({ hasText: /^YAML$/ })
    .click()
  const editor = page.locator('[aria-label="Definition YAML"] .cm-content')
  await editor.focus()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
  await page.keyboard.insertText(text)
}

export async function e2eSnapshot(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(async () => {
    if (!window.__WORKFLOW_STUDIO_E2E__) throw new Error('E2E fixture controls were not installed.')
    return window.__WORKFLOW_STUDIO_E2E__.snapshot()
  })
}

export async function yamlSelection(page: Page): Promise<{ line: number; column: number; collapsed: boolean }> {
  return page.locator('[aria-label="Definition YAML"] .cm-content').evaluate((content) => {
    const selection = window.getSelection()
    if (!selection?.anchorNode || !selection.focusNode || !content.contains(selection.anchorNode)) {
      throw new Error('The active CodeMirror DOM selection is unavailable.')
    }
    const line = (
      selection.anchorNode.nodeType === Node.ELEMENT_NODE
        ? (selection.anchorNode as Element)
        : selection.anchorNode.parentElement
    )?.closest('.cm-line')
    if (!line) throw new Error('The active CodeMirror line is unavailable.')
    const offset = (node: Node, innerOffset: number) => {
      const range = document.createRange()
      range.setStart(line, 0)
      range.setEnd(node, innerOffset)
      return range.toString().length
    }
    return {
      line: [...content.querySelectorAll('.cm-line')].indexOf(line) + 1,
      column: offset(selection.anchorNode, selection.anchorOffset) + 1,
      collapsed: selection.isCollapsed,
    }
  })
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
