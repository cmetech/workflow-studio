import { expect, test, type Locator, type Page } from '@playwright/test'
import { editorMetrics, openSeededPair, resetEditorMetrics, settleRenderer } from './support'

async function arrangeRoot(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'More canvas actions' }).click()
  await page.getByRole('menuitem', { name: 'Arrange Graph' }).click()
  await expect(page.getByRole('status', { name: 'Canvas authoring feedback' })).toContainText(
    /Graph arranged: 3 nodes and 2 dependencies/,
  )
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Object.keys(window.__WORKFLOW_STUDIO_E2E__!.persistedScopeLayout('root').scope?.routing?.routes ?? {}).length,
      ),
    )
    .toBe(2)
}

async function routedGeometry(page: Page) {
  return page.evaluate(() => ({
    nodes: Object.fromEntries(
      [...document.querySelectorAll<HTMLElement>('.svelte-flow__node[data-id]')].map((node) => {
        const bounds = node.getBoundingClientRect()
        return [node.dataset.id!, { width: bounds.width, height: bounds.height }]
      }),
    ),
    paths: Object.fromEntries(
      [...document.querySelectorAll<SVGGElement>('.svelte-flow__edge[data-id]')].map((edge) => [
        edge.dataset.id!,
        edge.querySelector<SVGPathElement>('.workflow-edge')!.getAttribute('d'),
      ]),
    ),
    persisted: window.__WORKFLOW_STUDIO_E2E__!.persistedScopeLayout('root'),
  }))
}

async function chooseTheme(page: Page, name: 'Light' | 'Dark'): Promise<void> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('radio', { name }).click()
  await page.getByRole('button', { name: 'Back to Workflow' }).click()
}

async function emphasisContrast(page: Page) {
  return page.evaluate(() => {
    const parse = (value: string): [number, number, number] => {
      const channels = (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
      if (channels.length !== 3) throw new Error(`Expected an RGB color, received ${value}.`)
      return channels as [number, number, number]
    }
    const mix = (foreground: string, background: string, opacity: number): [number, number, number] => {
      const fg = parse(foreground)
      const bg = parse(background)
      return fg.map((channel, index) => channel * opacity + bg[index]! * (1 - opacity)) as [number, number, number]
    }
    const luminance = (channels: readonly number[]): number => {
      const linear = channels.map((channel) => {
        const normalized = channel / 255
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
      })
      return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722
    }
    const contrast = (left: readonly number[], right: readonly number[]): number => {
      const a = luminance(left)
      const b = luminance(right)
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
    }
    const canvas = document.querySelector<HTMLElement>('.graph-canvas')!
    const canvasColor = getComputedStyle(canvas).backgroundColor
    const subduedEdge = document.querySelector<SVGPathElement>('.workflow-edge.deemphasized')!
    const edgeStyle = getComputedStyle(subduedEdge)
    const subduedNode = document.querySelector<HTMLElement>('.workflow-node[data-node-id="refine"].edges-deemphasized')!
    const nodeStyle = getComputedStyle(subduedNode)
    const nodeText = subduedNode.querySelector<HTMLElement>('.compound-summary')!
    const nodeOpacity = Number.parseFloat(nodeStyle.opacity)
    const canvasRgb = parse(canvasColor)
    const effectiveNodeBackground = mix(nodeStyle.backgroundColor, canvasColor, nodeOpacity)
    return {
      canvasColor,
      edgeOpacity: Number.parseFloat(edgeStyle.opacity),
      edgeStroke: edgeStyle.stroke,
      edgeContrast: contrast(mix(edgeStyle.stroke, canvasColor, Number.parseFloat(edgeStyle.opacity)), canvasRgb),
      nodeOpacity,
      nodeBackground: nodeStyle.backgroundColor,
      nodeTextColor: getComputedStyle(nodeText).color,
      nodeBorderColor: nodeStyle.borderTopColor,
      nodeTextContrast: contrast(
        mix(getComputedStyle(nodeText).color, canvasColor, nodeOpacity),
        effectiveNodeBackground,
      ),
      nodeBorderContrast: contrast(mix(nodeStyle.borderTopColor, canvasColor, nodeOpacity), canvasRgb),
    }
  })
}

async function selectAndHoverSeparateEdges(page: Page): Promise<{ selected: Locator; hovered: Locator }> {
  const selected = page.locator('.svelte-flow__edge[data-id="dependency:seed->refine"]')
  const hovered = page.locator('.svelte-flow__edge[data-id="dependency:seed->polish"]')
  await selected.click()
  await hovered.dispatchEvent('pointerenter')
  await expect(selected.locator('.workflow-edge')).toHaveClass(/deemphasized/)
  await expect(hovered.locator('.workflow-edge')).toHaveClass(/emphasized/)
  return { selected, hovered }
}

test.describe('routed edge emphasis browser contract', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName !== 'chromium', 'Chromium provides the required forced-colors and native measurement probe.')
  })

  test('preserves routed measurements, paths, persistence, and native-call counts through hover and focus', async ({
    page,
  }) => {
    await openSeededPair(page, { scenario: 'loop-group-authoring' })
    await arrangeRoot(page)
    const before = await routedGeometry(page)
    await resetEditorMetrics(page)
    const edge = page.locator('.svelte-flow__edge[data-id="dependency:seed->refine"]')

    await edge.dispatchEvent('pointerenter')
    await settleRenderer(page)
    await expect(edge.locator('.workflow-edge')).toHaveClass(/emphasized/)
    await edge.focus()
    await page.mouse.move(0, 0)
    await settleRenderer(page)
    await page.waitForTimeout(400)

    expect(await routedGeometry(page)).toEqual(before)
    expect(await editorMetrics(page)).toMatchObject({ layoutSaves: 0, nativeCalls: 0 })
  })

  test('keeps subdued connections and card content readable in both themes and forced colors', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openSeededPair(page, { scenario: 'loop-group-authoring' })
    for (const theme of ['Light', 'Dark'] as const) {
      await chooseTheme(page, theme)
      const { selected, hovered } = await selectAndHoverSeparateEdges(page)
      const contrast = await emphasisContrast(page)
      expect(contrast.edgeContrast, `${theme} subdued selected edge`).toBeGreaterThanOrEqual(3)
      expect(contrast.nodeBorderContrast, `${theme} subdued node border`).toBeGreaterThanOrEqual(3)
      expect(contrast.nodeTextContrast, JSON.stringify({ theme, contrast })).toBeGreaterThanOrEqual(4.5)
      expect(await hovered.evaluate((edge) => Number(getComputedStyle(edge.closest('svg')!).zIndex))).toBeGreaterThan(
        await selected.evaluate((edge) => Number(getComputedStyle(edge.closest('svg')!).zIndex)),
      )
      await page.keyboard.press('Escape')
    }

    await page.emulateMedia({ forcedColors: 'active' })
    await selectAndHoverSeparateEdges(page)
    const forced = await emphasisContrast(page)
    expect(forced.edgeOpacity).toBe(1)
    expect(forced.nodeOpacity).toBe(1)
    expect(forced.edgeContrast).toBeGreaterThanOrEqual(3)
    expect(forced.nodeTextContrast).toBeGreaterThanOrEqual(4.5)
  })
})
