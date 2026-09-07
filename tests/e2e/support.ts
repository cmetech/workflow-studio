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

export async function arrangeGraph(page: Page, nodes: number, edges: number): Promise<void> {
  await page.getByRole('button', { name: 'More canvas actions' }).click()
  await page.getByRole('menuitem', { name: 'Arrange Graph', exact: true }).click()
  await expect(
    page.getByText(`Graph arranged: ${nodes} nodes and ${edges} dependencies.`, { exact: true }),
  ).toBeVisible()
  await expect(page.getByTestId('workflow-canvas')).toHaveAttribute('aria-busy', 'false')
  await page.keyboard.press('Escape')
  await settleRenderer(page)
}

export interface CanvasGeometry {
  readonly nodes: readonly { id: string; x: number; y: number; width: number; height: number }[]
  readonly edges: readonly { id: string; label: string; path: string; points: readonly { x: number; y: number }[] }[]
}

/** Read the rendered SVG, including each quadratic bend's control point, in graph coordinates. */
export async function readCanvasGeometry(page: Page): Promise<CanvasGeometry> {
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(document.querySelector<SVGPathElement>('path.workflow-edge')?.getScreenCTM())),
    )
    .toBe(true)
  return page.evaluate(() => {
    const svg = document.querySelector<SVGPathElement>('path.workflow-edge')
    const matrix = svg?.getScreenCTM()
    if (!matrix) throw new Error('Expected rendered SVG edges and their graph-to-screen transform.')
    const inverse = matrix.inverse()
    const nodes = [...document.querySelectorAll<HTMLElement>('.svelte-flow__node')].map((element) => {
      const box = element.getBoundingClientRect()
      const topLeft = new DOMPoint(box.left, box.top).matrixTransform(inverse)
      const bottomRight = new DOMPoint(box.right, box.bottom).matrixTransform(inverse)
      return {
        id: element.dataset.id!,
        x: topLeft.x,
        y: topLeft.y,
        width: bottomRight.x - topLeft.x,
        height: bottomRight.y - topLeft.y,
      }
    })
    const edges = [...document.querySelectorAll<SVGGElement>('.svelte-flow__edge')].map((element) => {
      const path = element.querySelector('path.workflow-edge')?.getAttribute('d')
      if (!path) throw new Error('Expected every edge to have a semantic SVG path.')
      const tokens = path.match(/[MLQ]|[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi) ?? []
      if (path.replace(/[MLQ\s,\d.e+-]/gi, '') !== '') throw new Error(`Unexpected SVG command: ${path}`)
      const points: { x: number; y: number }[] = []
      for (let index = 0; index < tokens.length;) {
        const command = tokens[index++]
        if (command !== 'M' && command !== 'L' && command !== 'Q') throw new Error(`Unsupported SVG path: ${path}`)
        points.push({ x: Number(tokens[index++]), y: Number(tokens[index++]) })
        if (command === 'Q') points.push({ x: Number(tokens[index++]), y: Number(tokens[index++]) })
      }
      return { id: element.dataset.id!, label: element.getAttribute('aria-label') ?? '', path, points }
    })
    return { nodes, edges }
  })
}

/** Keep actual bends/reversals, but not L subdivisions or Q entry/exit points on a straight run. */
function collapsePathSubdivisions(points: CanvasGeometry['edges'][number]['points']) {
  const corners: { x: number; y: number }[] = []
  for (const point of points) {
    const previous = corners.at(-1),
      before = corners.at(-2)
    if (previous?.x === point.x && previous.y === point.y) continue
    if (
      before &&
      previous &&
      ((before.x === previous.x && previous.x === point.x && (previous.y - before.y) * (point.y - previous.y) > 0) ||
        (before.y === previous.y && previous.y === point.y && (previous.x - before.x) * (point.x - previous.x) > 0))
    )
      corners[corners.length - 1] = point
    else corners.push(point)
  }
  return corners
}

/** Independent acceptance math: never call the production geometry validator as its own oracle. */
export function expectRoutedGeometry(
  geometry: CanvasGeometry,
  expected: {
    readonly nodes: readonly { readonly id: string }[]
    readonly edges: readonly { readonly source: string; readonly target: string }[]
  },
  maximumCrossings = 0,
): void {
  const tolerance = 0.5
  expect(geometry.nodes.map(({ id }) => id).sort()).toEqual(expected.nodes.map(({ id }) => id).sort())
  expect(geometry.edges.map(({ label }) => label).sort()).toEqual(
    expected.edges.map(({ source, target }) => `Dependency from ${source} to ${target}`).sort(),
  )
  const segments: { edge: string; a: { x: number; y: number }; b: { x: number; y: number } }[] = []
  const endpoints = new Map<string, number[]>()
  for (const dependency of expected.edges) {
    const edge = geometry.edges.find(
      ({ label }) => label === `Dependency from ${dependency.source} to ${dependency.target}`,
    )!
    const source = geometry.nodes.find(({ id }) => id === dependency.source)!
    const target = geometry.nodes.find(({ id }) => id === dependency.target)!
    expect(edge.points.length).toBeGreaterThanOrEqual(2)
    expect(edge.points.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))).toBe(true)
    const first = edge.points[0]!,
      last = edge.points.at(-1)!
    expect(Math.abs(first.x - (source.x + source.width)), edge.label).toBeLessThanOrEqual(tolerance)
    expect(Math.abs(last.x - target.x), edge.label).toBeLessThanOrEqual(tolerance)
    for (const [side, node, point] of [
      ['source', source, first],
      ['target', target, last],
    ] as const) {
      expect(point.y).toBeGreaterThanOrEqual(node.y - tolerance)
      expect(point.y).toBeLessThanOrEqual(node.y + node.height + tolerance)
      const key = `${side}:${node.id}`
      const previous = endpoints.get(key) ?? []
      expect(
        previous.every((y) => Math.abs(y - point.y) > tolerance),
        `${edge.label} must use a distinct ${side} lane`,
      ).toBe(true)
      endpoints.set(key, [...previous, point.y])
    }
    for (let index = 1; index < edge.points.length; index++) {
      const a = edge.points[index - 1]!,
        b = edge.points[index]!
      const horizontal = Math.abs(a.y - b.y) <= tolerance
      expect(horizontal || Math.abs(a.x - b.x) <= tolerance, edge.label).toBe(true)
      for (const node of geometry.nodes) {
        if (node.id === source.id || node.id === target.id) continue
        const left = node.x - 24 + tolerance,
          right = node.x + node.width + 24 - tolerance
        const top = node.y - 24 + tolerance,
          bottom = node.y + node.height + 24 - tolerance
        const intersects = horizontal
          ? a.y > top && a.y < bottom && Math.max(a.x, b.x) > left && Math.min(a.x, b.x) < right
          : a.x > left && a.x < right && Math.max(a.y, b.y) > top && Math.min(a.y, b.y) < bottom
        expect(intersects, `${edge.label} enters ${node.id}'s 24px clearance`).toBe(false)
      }
    }
    // Crossing/coincidence endpoint exclusions apply to real bends, never artificial SVG subdivisions.
    const corners = collapsePathSubdivisions(edge.points)
    for (let index = 1; index < corners.length; index++) {
      const a = corners[index - 1]!,
        b = corners[index]!
      if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) > tolerance) segments.push({ edge: edge.id, a, b })
    }
  }
  const crossingPoints = new Set<string>()
  for (let i = 0; i < segments.length; i++)
    for (let j = i + 1; j < segments.length; j++) {
      const a = segments[i]!,
        b = segments[j]!
      if (a.edge === b.edge) continue
      const aHorizontal = Math.abs(a.a.y - a.b.y) <= tolerance
      const bHorizontal = Math.abs(b.a.y - b.b.y) <= tolerance
      if (aHorizontal === bHorizontal) {
        const sameLine = aHorizontal ? Math.abs(a.a.y - b.a.y) <= tolerance : Math.abs(a.a.x - b.a.x) <= tolerance
        if (sameLine) {
          const axis = aHorizontal ? 'x' : 'y'
          const overlap =
            Math.min(Math.max(a.a[axis], a.b[axis]), Math.max(b.a[axis], b.b[axis])) -
            Math.max(Math.min(a.a[axis], a.b[axis]), Math.min(b.a[axis], b.b[axis]))
          expect(overlap, `${a.edge} and ${b.edge} share a long lane`).toBeLessThanOrEqual(24 + tolerance)
        }
        continue
      }
      const h = aHorizontal ? a : b,
        v = aHorizontal ? b : a
      if (
        v.a.x > Math.min(h.a.x, h.b.x) + tolerance &&
        v.a.x < Math.max(h.a.x, h.b.x) - tolerance &&
        h.a.y > Math.min(v.a.y, v.b.y) + tolerance &&
        h.a.y < Math.max(v.a.y, v.b.y) - tolerance
      )
        crossingPoints.add(`${[a.edge, b.edge].sort().join('|')}:${v.a.x}:${h.a.y}`)
    }
  expect(crossingPoints.size, JSON.stringify([...crossingPoints])).toBeLessThanOrEqual(maximumCrossings)
}

interface RoutedWorkerProbe {
  corruptNextResult: boolean
  corruptedResults: number
  requests: number
}

declare global {
  interface Window {
    __ROUTED_WORKER_PROBE__?: RoutedWorkerProbe
  }
}

/** Corrupt an actual worker response at the browser boundary; no production injection switch. */
export async function installRoutedWorkerProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__ROUTED_WORKER_PROBE__ = { corruptNextResult: false, corruptedResults: 0, requests: 0 }
    const RealWorker = window.Worker
    window.Worker = class extends RealWorker {
      private readonly layoutWorker: boolean
      private readonly listeners = new Map<EventListenerOrEventListenerObject, EventListener>()
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        this.layoutWorker = String(url).includes('/layout-worker')
      }
      override postMessage(message: unknown, transferOrOptions?: Transferable[] | StructuredSerializeOptions): void {
        if (this.layoutWorker && (message as { type?: string })?.type === 'layout')
          window.__ROUTED_WORKER_PROBE__!.requests++
        if (Array.isArray(transferOrOptions)) super.postMessage(message, transferOrOptions)
        else super.postMessage(message, transferOrOptions)
      }
      override addEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions,
      ): void {
        if (!this.layoutWorker || type !== 'message') {
          super.addEventListener(type, listener, options)
          return
        }
        const wrapped: EventListener = (event) => {
          const data = (event as MessageEvent).data
          let delivered = event
          if (data?.type === 'layout-result' && window.__ROUTED_WORKER_PROBE__!.corruptNextResult) {
            window.__ROUTED_WORKER_PROBE__!.corruptNextResult = false
            window.__ROUTED_WORKER_PROBE__!.corruptedResults++
            delivered = new MessageEvent('message', { data: { ...data, routes: {} } })
          }
          if (typeof listener === 'function') listener.call(this, delivered)
          else listener.handleEvent(delivered)
        }
        this.listeners.set(listener, wrapped)
        super.addEventListener(type, wrapped, options)
      }
      override removeEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | EventListenerOptions,
      ): void {
        super.removeEventListener(type, this.listeners.get(listener) ?? listener, options)
        this.listeners.delete(listener)
      }
    }
  })
}
