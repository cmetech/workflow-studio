import { expect, test, type Page } from '@playwright/test'
import { e2eSnapshot, openSeededPair, replaceDefinitionYaml } from './support'

const SEEDED_YAML = `name: Release demo
description: Verify the complete authoring path.
nodes:
  - id: prepare
    prompt: Prepare the release notes.
  - id: publish
    command: /publish
    depends_on: [prepare]
`

async function expectAuthoritativeYaml(page: Page, expected: string): Promise<void> {
  await expect.poll(async () => (await e2eSnapshot(page)).definitionText).toBe(expected)
}

interface SavedLayoutEntry {
  readonly layout?: {
    readonly nodePositions?: Record<string, { readonly x: number; readonly y: number }>
  }
}

async function layoutPosition(page: Page, nodeId: string): Promise<{ readonly x: number; readonly y: number }> {
  const serialized = (await e2eSnapshot(page)).layout
  if (typeof serialized !== 'string') throw new Error('Expected a saved layout record.')
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

async function dragPort(
  page: Page,
  sourceId: string,
  sourcePort: 'input' | 'output',
  targetId: string,
  targetPort: 'input' | 'output',
): Promise<void> {
  const source = page.locator(`[data-node-id="${sourceId}"] [data-port="${sourcePort}"]`)
  const target = page.locator(`[data-node-id="${targetId}"] [data-port="${targetPort}"]`)
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
  await page.mouse.up()
}

test('opens a seeded workflow pair before authoring begins', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Folder' }).first().click()

  const pair = page.getByRole('treeitem', { name: /release-demo\.yaml, paired workflow/i })
  await expect(pair).toBeVisible()
  await pair.click()
  await expect(page.getByText('prepare', { exact: true }).first()).toBeVisible()
})

test('updates the graph from authoritative YAML and saves the exact text', async ({ page }) => {
  const yaml = `name: YAML authored release
description: The graph is derived from this exact text.
nodes:
  - id: yaml_node
    prompt: Confirm the release.
`
  await openSeededPair(page)
  await replaceDefinitionYaml(page, yaml)
  await page.getByRole('button', { name: 'Split', exact: true }).click()

  await expect(page.getByRole('group', { name: 'prompt node yaml_node' })).toBeVisible()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+S' : 'Control+S')
  await expect.poll(async () => (await e2eSnapshot(page)).definitionText).toBe(yaml)
})

test('adds, duplicates, connects, references, renames, deletes, saves, and reopens exact authoritative YAML', async ({
  page,
}) => {
  await openSeededPair(page)
  await expectAuthoritativeYaml(page, SEEDED_YAML)

  await page.getByRole('button', { name: 'Add Node' }).click()
  const addNode = page.getByRole('dialog', { name: 'Add node' })
  await addNode.getByRole('option', { name: /Command/ }).click()
  const command = page.getByRole('group', { name: 'command node command' })
  await expect(command).toBeVisible()
  const afterAdd = `${SEEDED_YAML}  - id: command
    command: ""
`
  await expectAuthoritativeYaml(page, afterAdd)

  await command.focus()
  await command.press('Enter')
  const commandField = page.getByRole('textbox', { name: /Commandrequired/i })
  await expect(commandField).toBeEnabled()
  await commandField.fill('/review')
  await page.getByRole('button', { name: 'Apply Command' }).click()
  const afterCommand = afterAdd.replace('    command: ""\n', '    command: "/review"\n')
  await expectAuthoritativeYaml(page, afterCommand)
  await expect(page.getByRole('button', { name: 'Add Node' })).toBeEnabled()

  const prepare = page.getByRole('group', { name: 'prompt node prepare', exact: true })
  await prepare.focus()
  await prepare.press('Enter')
  await page.getByRole('button', { name: 'More canvas actions' }).click()
  const duplicateAction = page.getByRole('menuitem', { name: 'Duplicate Selection' })
  await expect(duplicateAction).toBeEnabled()
  await duplicateAction.click()
  const duplicate = page.getByRole('group', { name: 'prompt node prepare-2' })
  await expect(duplicate).toBeVisible()
  const afterDuplicate = `name: Release demo
description: Verify the complete authoring path.
nodes:
  - id: prepare
    prompt: Prepare the release notes.
  - id: publish
    command: /publish
    depends_on: [prepare]
  - id: command
    command: "/review"
  - id: prepare-2
    prompt: Prepare the release notes.
`
  await expectAuthoritativeYaml(page, afterDuplicate)

  await duplicate.focus()
  await duplicate.press('Enter')
  await page.getByRole('button', { name: 'Create Edge' }).click()
  await page.getByRole('option', { name: 'prepare' }).click()
  const afterEdge = afterDuplicate.replace(
    '  - id: prepare\n    prompt: Prepare the release notes.\n',
    '  - id: prepare\n    prompt: Prepare the release notes.\n    depends_on:\n      - prepare-2\n',
  )
  await expectAuthoritativeYaml(page, afterEdge)

  await expect(page.getByRole('button', { name: 'Add Node' })).toBeEnabled()
  await prepare.focus()
  await prepare.press('Enter')
  await page.getByRole('tab', { name: 'Execution' }).click()
  const whenField = page.getByRole('textbox', { name: 'When', exact: true })
  await expect(whenField).toBeEnabled()
  await whenField.fill("$prepare-2.output.status == 'ready'")
  await page.getByRole('button', { name: 'Apply When' }).click()
  const afterReference = afterEdge.replace(
    '    depends_on:\n      - prepare-2\n',
    "    depends_on:\n      - prepare-2\n    when: $prepare-2.output.status == 'ready'\n",
  )
  await expectAuthoritativeYaml(page, afterReference)

  await expect(page.getByRole('button', { name: 'Add Node' })).toBeEnabled()
  await duplicate.focus()
  await duplicate.press('Enter')
  await page.getByRole('tab', { name: 'General' }).click()
  const idField = page.getByRole('textbox', { name: /IDrequired/i })
  await expect(idField).toBeEnabled()
  await idField.fill('collect')
  await page.getByRole('button', { name: 'Apply ID' }).click()
  const renamed = page.getByRole('group', { name: 'prompt node collect' })
  await expect(renamed).toBeVisible()
  const afterRename = afterReference
    .replace('      - prepare-2\n', '      - collect\n')
    .replace('$prepare-2.output.status', '$collect.output.status')
    .replace('  - id: prepare-2\n', '  - id: collect\n')
  await expectAuthoritativeYaml(page, afterRename)

  const bounds = await renamed.boundingBox()
  expect(bounds).not.toBeNull()
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + 18)
  await page.mouse.down()
  await page.mouse.move(bounds!.x + 80, bounds!.y + 90, { steps: 5 })
  await page.mouse.up()
  await expect.poll(async () => (await e2eSnapshot(page)).layout).not.toBeNull()

  await command.focus()
  await command.press('Enter')
  await page.getByRole('button', { name: 'More canvas actions' }).click()
  await page.getByRole('menuitem', { name: 'Delete Selection' }).click()
  const deleteDialog = page.getByRole('dialog', { name: 'Delete selected nodes' })
  await deleteDialog.getByRole('button', { name: 'Delete nodes' }).click()
  await expect(deleteDialog).toBeHidden()
  await expect(command).toHaveCount(0)
  const afterDelete = afterRename.replace('  - id: command\n    command: "/review"\n', '')
  await expectAuthoritativeYaml(page, afterDelete)

  const before = await layoutPosition(page, 'publish')
  await dragNodeBy(page, 'publish', { x: 110, y: 120 })
  await expect.poll(async () => (await layoutPosition(page, 'publish')).x).toBeGreaterThan(before.x + 80)
  await expect.poll(async () => (await layoutPosition(page, 'publish')).y).toBeGreaterThan(before.y + 80)
  const publishAfterDrag = await layoutPosition(page, 'publish')

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+S' : 'Control+S')
  await expectAuthoritativeYaml(page, afterDelete)

  await page.getByRole('button', { name: 'Examples', exact: true }).click()
  await page
    .getByRole('button', { name: /^Create Editable Copy:/ })
    .first()
    .click()
  await expect(page.getByRole('group', { name: 'prompt node prompt' })).toBeVisible()
  await page.getByRole('button', { name: 'Explorer', exact: true }).click()
  const releaseDemo = page.getByRole('treeitem', { name: /release-demo\.yaml, paired workflow/i })
  await releaseDemo.click()
  await expect(releaseDemo).toHaveAttribute('aria-current', 'page')
  await expectAuthoritativeYaml(page, afterDelete)
  await expect(page.getByRole('group', { name: 'command node publish' })).toBeVisible()
  await expect.poll(async () => layoutPosition(page, 'publish')).toEqual(publishAfterDrag)
})

test('real palette and port gestures commit a dependency and reject a cycle without changing YAML', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openSeededPair(page)
  await page.getByRole('button', { name: 'Nodes', exact: true }).click()
  const palette = page.getByRole('region', { name: 'Nodes' })
  const viewport = page.locator('[data-testid="workflow-canvas-viewport"]')
  const canvasVisuals = await page.locator('[data-node-id="publish"]').evaluate((node) => {
    const port = node.querySelector<HTMLElement>('[data-port="output"]')
    const kind = node.querySelector<HTMLElement>('.kind')
    if (!port || !kind) throw new Error('Expected the publish node port and kind label.')
    const portCenter = getComputedStyle(port, '::after')
    return {
      portCenter: { width: portCenter.width, height: portCenter.height },
      kindTextTransform: getComputedStyle(kind).textTransform,
    }
  })
  expect(canvasVisuals).toEqual({
    portCenter: { width: '10px', height: '10px' },
    kindTextTransform: 'none',
  })
  await palette.getByRole('button', { name: /add command node/i }).dragTo(viewport, {
    targetPosition: { x: 520, y: 360 },
  })
  await expect
    .poll(async () => ((await e2eSnapshot(page)).definitionText.match(/^  - id: command$/gm) ?? []).length)
    .toBe(1)
  await expect.poll(async () => Math.abs((await layoutPosition(page, 'command')).x - 520)).toBeLessThanOrEqual(8)
  await expect.poll(async () => Math.abs((await layoutPosition(page, 'command')).y - 360)).toBeLessThanOrEqual(8)

  const command = page.getByRole('group', { name: 'command node command' })
  await command.focus()
  await command.press('Enter')
  const commandField = page.getByRole('textbox', { name: /Commandrequired/i })
  await expect(commandField).toBeEnabled()
  await commandField.fill('/review')
  await page.getByRole('button', { name: 'Apply Command' }).click()
  await expect
    .poll(async () => (await e2eSnapshot(page)).definitionText)
    .toContain('  - id: command\n    command: "/review"\n')
  await expect(page.getByRole('button', { name: 'Add Node' })).toBeEnabled()

  await dragPort(page, 'publish', 'output', 'command', 'input')
  await expect
    .poll(async () => (await e2eSnapshot(page)).definitionText)
    .toContain('  - id: command\n    command: "/review"\n    depends_on:\n      - publish\n')
  await expect(page.getByRole('button', { name: 'Add Node' })).toBeEnabled()

  const dependency = page.getByRole('group', { name: 'Dependency from publish to command' })
  await dependency.focus()
  await dependency.press('Enter')
  const selectedPath = dependency.locator('path.workflow-edge')
  await expect(selectedPath).toHaveClass(/selected/)
  const selectedEdgeStyle = await selectedPath.evaluate((path) => ({
    computedStroke: getComputedStyle(path).stroke,
    inlineStyle: path.getAttribute('style'),
    matchingRules: Array.from(document.styleSheets).flatMap((sheet) => {
      try {
        return Array.from(sheet.cssRules)
          .filter((rule) => rule.cssText.includes('workflow-edge'))
          .map((rule) => rule.cssText)
      } catch {
        return []
      }
    }),
  }))
  const expectedSelectedStroke = await page.evaluate(() => {
    const probe = document.createElement('div')
    probe.style.color = 'var(--color-edge-selected)'
    document.body.append(probe)
    const color = getComputedStyle(probe).color
    probe.remove()
    return color
  })
  expect(selectedEdgeStyle.computedStroke, JSON.stringify(selectedEdgeStyle)).toBe(expectedSelectedStroke)

  const beforeCycle = (await e2eSnapshot(page)).definitionText
  await dragPort(page, 'publish', 'output', 'prepare', 'input')
  await expect(page.getByRole('status', { name: 'Canvas authoring feedback' })).toContainText(/create a cycle/i)
  await expectAuthoritativeYaml(page, beforeCycle as string)

  await replaceDefinitionYaml(page, 'name: [\n')
  await page.getByRole('button', { name: 'Visual', exact: true }).click()
  await expect(page.getByText(/last valid graph.*read-only/i)).toBeVisible()
  const stalePath = page
    .getByRole('group', { name: 'Dependency from publish to command' })
    .locator('path.workflow-edge')
  await expect(stalePath).toHaveClass(/stale/)
  const staleDash = await stalePath.evaluate((path) => getComputedStyle(path).strokeDasharray)
  expect(staleDash.replaceAll('px', '').replaceAll(',', '').trim().replace(/\s+/g, ' ')).toBe('5 4')
})
