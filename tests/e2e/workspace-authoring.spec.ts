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

async function transactionState(page: Page): Promise<{ definitionRevision: number; undoDepth: number }> {
  const snapshot = await e2eSnapshot(page)
  if (typeof snapshot.definitionRevision !== 'number' || typeof snapshot.undoDepth !== 'number') {
    throw new Error('Expected the E2E snapshot to expose document revision and undo depth.')
  }
  return { definitionRevision: snapshot.definitionRevision, undoDepth: snapshot.undoDepth }
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
  const viewport = page.locator('[data-testid="workflow-canvas-viewport"]')
  const [bounds, viewportBounds] = await Promise.all([node.boundingBox(), viewport.boundingBox()])
  if (!bounds || !viewportBounds) throw new Error(`Expected visible node ${nodeId} and canvas viewport.`)
  const visibleTop = Math.max(bounds.y, viewportBounds.y)
  const visibleBottom = Math.min(bounds.y + bounds.height, viewportBounds.y + viewportBounds.height)
  if (visibleBottom - visibleTop < 16) throw new Error(`Expected a draggable visible body for node ${nodeId}.`)
  const start = {
    x: bounds.x + bounds.width / 2,
    y: Math.min(visibleBottom - 8, Math.max(visibleTop + 8, bounds.y + 40)),
  }
  const hitNodeId = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-node-id]')?.getAttribute('data-node-id') ?? null,
    start,
  )
  expect(hitNodeId).toBe(nodeId)
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

test('canvas menu stays outside the pointer viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openSeededPair(page)

  await page.getByRole('button', { name: 'More canvas actions' }).click()
  const menu = page.getByRole('menu', { name: 'More canvas actions' })
  const viewport = page.locator('[data-testid="workflow-canvas-viewport"]')
  const [menuBounds, viewportBounds] = await Promise.all([menu.boundingBox(), viewport.boundingBox()])
  if (!menuBounds || !viewportBounds) throw new Error('Expected visible canvas menu and pointer viewport geometry.')

  expect(menuBounds.y + menuBounds.height).toBeLessThanOrEqual(viewportBounds.y)
})

test('preserves mixed selection across no-op edge activation, refresh, and page navigation', async ({ page }) => {
  await openSeededPair(page)
  const prepare = page.getByRole('group', { name: 'prompt node prepare', exact: true })
  const dependency = page.getByRole('group', { name: 'Dependency from prepare to publish' })

  await prepare.focus()
  await prepare.press('Enter')
  await dependency.focus()
  await dependency.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')

  await expect(prepare).toHaveClass(/selected/)
  await expect(dependency.locator('path.workflow-edge')).toHaveClass(/selected/)
  await expect(page.getByRole('button', { name: 'Create Edge' })).toBeEnabled()

  await dependency.press('Enter')
  const refreshedDefinition = SEEDED_YAML.replace(
    'description: Verify the complete authoring path.',
    'description: Verify mixed selection after a no-op edge gesture.',
  )
  await replaceDefinitionYaml(page, refreshedDefinition)
  await page.getByRole('button', { name: 'Visual', exact: true }).click()

  await expect(prepare).toHaveClass(/selected/)
  await expect(dependency.locator('path.workflow-edge')).toHaveClass(/selected/)
  await expect(page.getByRole('button', { name: 'Create Edge' })).toBeEnabled()

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Back to Workflow' }).click()

  await expect(prepare).toHaveClass(/selected/)
  await expect(dependency.locator('path.workflow-edge')).toHaveClass(/selected/)
  await expect(page.getByRole('button', { name: 'Create Edge' })).toBeEnabled()
})

test('preserves pointer-selected edge ownership across a projection refresh', async ({ page }) => {
  await openSeededPair(page)
  const dependency = page.getByRole('group', { name: 'Dependency from prepare to publish' })

  const edgeCenter = await dependency.locator('.svelte-flow__edge-interaction').evaluate((path: SVGPathElement) => {
    const point = path.getPointAtLength(path.getTotalLength() / 2)
    const matrix = path.getScreenCTM()
    if (!matrix) throw new Error('Expected the edge interaction path to have a screen transform.')
    const screenPoint = new DOMPoint(point.x, point.y).matrixTransform(matrix)
    return { x: screenPoint.x, y: screenPoint.y }
  })
  await page.mouse.click(edgeCenter.x, edgeCenter.y, { delay: 50 })
  await expect(dependency.locator('path.workflow-edge')).toHaveClass(/selected/)
  await expect(page.locator('.svelte-flow__node.selected')).toHaveCount(0)

  const refreshedDefinition = SEEDED_YAML.replace(
    'description: Verify the complete authoring path.',
    'description: Verify pointer edge selection after projection refresh.',
  )
  await replaceDefinitionYaml(page, refreshedDefinition)
  await page.getByRole('button', { name: 'Visual', exact: true }).click()

  await expect(dependency.locator('path.workflow-edge')).toHaveClass(/selected/)
  await expect(page.locator('.svelte-flow__node.selected')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Create Edge' })).toBeDisabled()
})

test('preserves marquee-selected nodes and connected edge across refresh and page navigation', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openSeededPair(page)
  const prepare = page.getByRole('group', { name: 'prompt node prepare', exact: true })
  const publish = page.getByRole('group', { name: 'command node publish', exact: true })
  const viewport = page.locator('[data-testid="workflow-canvas-viewport"]')
  const [prepareBounds, publishBounds, viewportBounds] = await Promise.all([
    prepare.boundingBox(),
    publish.boundingBox(),
    viewport.boundingBox(),
  ])
  if (!prepareBounds || !publishBounds || !viewportBounds) {
    throw new Error('Expected visible nodes and canvas viewport for marquee selection.')
  }
  const start = {
    x: Math.max(viewportBounds.x + 3, Math.min(prepareBounds.x, publishBounds.x) - 20),
    y: Math.max(viewportBounds.y + 3, Math.min(prepareBounds.y, publishBounds.y) - 20),
  }
  const end = {
    x: Math.min(
      viewportBounds.x + viewportBounds.width - 3,
      Math.max(prepareBounds.x + prepareBounds.width, publishBounds.x + publishBounds.width) + 20,
    ),
    y: Math.min(
      viewportBounds.y + viewportBounds.height - 3,
      Math.max(prepareBounds.y + prepareBounds.height, publishBounds.y + publishBounds.height) + 20,
    ),
  }

  await page.keyboard.down('Shift')
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 8 })
  await page.mouse.up()
  await page.keyboard.up('Shift')

  await expect
    .poll(() =>
      page
        .locator('.svelte-flow__node.selected')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-id')).sort()),
    )
    .toEqual(['prepare', 'publish'])
  const dependency = page.getByRole('group', { name: 'Dependency from prepare to publish' })
  await expect(dependency.locator('path.workflow-edge')).toHaveClass(/selected/)

  const refreshedDefinition = SEEDED_YAML.replace(
    'description: Verify the complete authoring path.',
    'description: Verify marquee selection after projection refresh.',
  )
  await replaceDefinitionYaml(page, refreshedDefinition)
  await page.getByRole('button', { name: 'Visual', exact: true }).click()

  await expect
    .poll(() =>
      page
        .locator('.svelte-flow__node.selected')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-id')).sort()),
    )
    .toEqual(['prepare', 'publish'])
  await expect(dependency.locator('path.workflow-edge')).toHaveClass(/selected/)

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Back to Workflow' }).click()
  await expect(prepare).toHaveClass(/selected/)
  await expect(publish).toHaveClass(/selected/)
  await expect(dependency.locator('path.workflow-edge')).toHaveClass(/selected/)
})

test('Escape clears edge-only and mixed selection without projection resurrection', async ({ page }) => {
  await openSeededPair(page)
  const prepare = page.getByRole('group', { name: 'prompt node prepare', exact: true })
  const dependency = page.getByRole('group', { name: 'Dependency from prepare to publish' })

  await dependency.focus()
  await dependency.press('Enter')
  await expect(dependency.locator('path.workflow-edge')).toHaveClass(/selected/)
  await dependency.press('Escape')
  await expect(dependency.locator('path.workflow-edge')).not.toHaveClass(/selected/)

  const edgeOnlyRefresh = SEEDED_YAML.replace(
    'description: Verify the complete authoring path.',
    'description: Verify cleared edge selection after projection refresh.',
  )
  await replaceDefinitionYaml(page, edgeOnlyRefresh)
  await page.getByRole('button', { name: 'Visual', exact: true }).click()
  await expect(dependency.locator('path.workflow-edge')).not.toHaveClass(/selected/)

  await prepare.focus()
  await prepare.press('Enter')
  await dependency.focus()
  await dependency.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
  await expect(prepare).toHaveClass(/selected/)
  await expect(dependency.locator('path.workflow-edge')).toHaveClass(/selected/)
  const inspector = page.getByRole('region', { name: 'Workflow inspector' })
  await expect(inspector.getByText('prepare', { exact: true }).first()).toBeVisible()
  await dependency.press('Escape')
  await expect(prepare).not.toHaveClass(/selected/)
  await expect(dependency.locator('path.workflow-edge')).not.toHaveClass(/selected/)
  await expect(page.getByRole('button', { name: 'Create Edge' })).toBeDisabled()
  await expect(inspector.getByText('Workflow', { exact: true }).first()).toBeVisible()

  const mixedRefresh = edgeOnlyRefresh.replace(
    'description: Verify cleared edge selection after projection refresh.',
    'description: Verify cleared mixed selection after projection refresh.',
  )
  await replaceDefinitionYaml(page, mixedRefresh)
  await page.getByRole('button', { name: 'Visual', exact: true }).click()
  await expect(prepare).not.toHaveClass(/selected/)
  await expect(dependency.locator('path.workflow-edge')).not.toHaveClass(/selected/)
  await expect(page.getByRole('button', { name: 'Create Edge' })).toBeDisabled()
})

test('picker-priority Escape clears mixed selection without projection resurrection', async ({ page }) => {
  await openSeededPair(page)
  const prepare = page.getByRole('group', { name: 'prompt node prepare', exact: true })
  const dependency = page.getByRole('group', { name: 'Dependency from prepare to publish' })

  await prepare.focus()
  await prepare.press('Enter')
  await dependency.focus()
  await dependency.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
  await expect(prepare).toHaveClass(/selected/)
  await expect(dependency.locator('path.workflow-edge')).toHaveClass(/selected/)
  const inspector = page.getByRole('region', { name: 'Workflow inspector' })
  await expect(inspector.getByText('prepare', { exact: true }).first()).toBeVisible()

  await page.getByRole('button', { name: 'Create Edge' }).click()
  await expect(page.getByText('Create edge from prepare', { exact: true })).toBeVisible()
  await dependency.focus()
  await dependency.press('Escape')

  await expect(page.getByText('Create edge from prepare', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('status', { name: 'Canvas authoring feedback' })).toHaveText('Edge creation cancelled.')
  await expect(prepare).not.toHaveClass(/selected/)
  await expect(dependency.locator('path.workflow-edge')).not.toHaveClass(/selected/)
  await expect(page.getByRole('button', { name: 'Create Edge' })).toBeDisabled()
  await expect(inspector.getByText('Workflow', { exact: true }).first()).toBeVisible()

  const refreshedDefinition = SEEDED_YAML.replace(
    'description: Verify the complete authoring path.',
    'description: Verify picker-priority Escape after projection refresh.',
  )
  await replaceDefinitionYaml(page, refreshedDefinition)
  await page.getByRole('button', { name: 'Visual', exact: true }).click()

  await expect(prepare).not.toHaveClass(/selected/)
  await expect(dependency.locator('path.workflow-edge')).not.toHaveClass(/selected/)
  await expect(page.getByRole('button', { name: 'Create Edge' })).toBeDisabled()
})

test('prunes edge selection when a same-workflow projection removes the edge', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openSeededPair(page)
  const dependency = page.getByRole('group', { name: 'Dependency from prepare to publish' })

  await dependency.focus()
  await dependency.press('Enter')
  await expect(dependency.locator('path.workflow-edge')).toHaveClass(/selected/)

  await page.getByRole('button', { name: 'Split', exact: true }).click()
  const editor = page.locator('[aria-label="Definition YAML"] .cm-content')
  await editor.click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
  await page.keyboard.insertText(SEEDED_YAML.replace('    depends_on: [prepare]\n', ''))
  await expect(page.getByRole('group', { name: 'Dependency from prepare to publish' })).toHaveCount(0)

  await editor.click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
  await page.keyboard.insertText(SEEDED_YAML)
  const restoredDependency = page.getByRole('group', { name: 'Dependency from prepare to publish' })
  await expect(restoredDependency).toHaveCount(1)
  await expect(restoredDependency.locator('path.workflow-edge')).not.toHaveClass(/selected/)
})

test('resets edge selection when a new workflow reuses the same edge id', async ({ page }) => {
  const sequentialYaml = `name: Sequential chain
description: Three nodes connected in order.
nodes:
  - id: prepare
    command: /prepare
  - id: review
    prompt: Review $prepare.output.
    depends_on: [prepare]
  - id: finish
    command: /finish
    depends_on: [review]
`
  await openSeededPair(page)
  await replaceDefinitionYaml(page, sequentialYaml)
  await page.getByRole('button', { name: 'Visual', exact: true }).click()
  const dependency = page.getByRole('group', { name: 'Dependency from prepare to review' })

  await dependency.focus()
  await dependency.press('Enter')
  await expect(dependency.locator('path.workflow-edge')).toHaveClass(/selected/)

  await page.getByRole('button', { name: 'Examples', exact: true }).click()
  await page.getByRole('button', { name: 'Create Editable Copy: Sequential chain' }).click()
  await page.getByRole('button', { name: 'Back to Workflow' }).click()

  const reusedDependency = page.getByRole('group', { name: 'Dependency from prepare to review' })
  await expect(reusedDependency).toHaveCount(1)
  await expect(reusedDependency.locator('path.workflow-edge')).not.toHaveClass(/selected/)
})

test('node body remains the real hit target and draggable in the former controls rectangle', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openSeededPair(page)

  const node = page.getByRole('group', { name: 'prompt node prepare', exact: true })
  const viewport = page.locator('[data-testid="workflow-canvas-viewport"]')
  const initialPosition = await layoutPosition(page, 'prepare')
  const [initialNodeBounds, viewportBounds] = await Promise.all([node.boundingBox(), viewport.boundingBox()])
  if (!initialNodeBounds || !viewportBounds) throw new Error('Expected visible node and canvas viewport geometry.')

  const firstStart = {
    x: initialNodeBounds.x + initialNodeBounds.width / 2,
    y: initialNodeBounds.y + 40,
  }
  const formerControlsNodeOrigin = {
    x: viewportBounds.x + 8,
    y: viewportBounds.y + viewportBounds.height - initialNodeBounds.height - 8,
  }
  await page.mouse.move(firstStart.x, firstStart.y)
  await page.mouse.down()
  await page.mouse.move(formerControlsNodeOrigin.x + initialNodeBounds.width / 2, formerControlsNodeOrigin.y + 40, {
    steps: 5,
  })
  await page.mouse.up()
  await expect.poll(async () => layoutPosition(page, 'prepare')).not.toEqual(initialPosition)

  const positioned = await node.boundingBox()
  if (!positioned) throw new Error('Expected the moved node to remain visible.')
  const hitPoint = {
    x: positioned.x + 20,
    y: positioned.y + positioned.height - 8,
  }
  const hitTarget = await page.evaluate(({ x, y }) => {
    const element = document.elementFromPoint(x, y)
    return {
      nodeId: element?.closest('[data-node-id]')?.getAttribute('data-node-id') ?? null,
      tagName: element?.tagName ?? null,
      control: element?.closest('.svelte-flow__controls') !== null,
    }
  }, hitPoint)
  expect(hitTarget.nodeId).toBe('prepare')
  expect(hitTarget.tagName).not.toBe('SVG')
  expect(hitTarget.control).toBe(false)

  const beforeSecondDrag = await layoutPosition(page, 'prepare')
  await page.mouse.move(hitPoint.x, hitPoint.y)
  await page.mouse.down()
  await page.mouse.move(hitPoint.x + 90, hitPoint.y - 60, { steps: 5 })
  await page.mouse.up()
  await expect.poll(async () => (await layoutPosition(page, 'prepare')).x).toBeGreaterThan(beforeSecondDrag.x + 40)
  await expect.poll(async () => (await layoutPosition(page, 'prepare')).y).toBeLessThan(beforeSecondDrag.y - 25)
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
  const commandField = page.getByRole('textbox', { name: /Command.*Required/i })
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
  const idField = page.getByRole('textbox', { name: /ID.*Required/i })
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
  const createExampleCopy = page.getByRole('button', { name: /^Create Editable Copy:/ }).first()
  await createExampleCopy.focus()
  await createExampleCopy.press('Enter')
  const backToWorkflow = page.getByRole('button', { name: 'Back to Workflow' })
  await backToWorkflow.focus()
  await backToWorkflow.press('Enter')
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
  const commandField = page.getByRole('textbox', { name: /Command.*Required/i })
  await expect(commandField).toBeEnabled()
  await commandField.fill('/review')
  await page.getByRole('button', { name: 'Apply Command' }).click()
  await expect
    .poll(async () => (await e2eSnapshot(page)).definitionText)
    .toContain('  - id: command\n    command: "/review"\n')
  await expect(page.getByRole('button', { name: 'Add Node' })).toBeEnabled()

  const beforeConnection = await transactionState(page)
  await dragPort(page, 'publish', 'output', 'command', 'input')
  await expect
    .poll(async () => (await e2eSnapshot(page)).definitionText)
    .toContain('  - id: command\n    command: "/review"\n    depends_on:\n      - publish\n')
  await expect
    .poll(() => transactionState(page))
    .toEqual({
      definitionRevision: beforeConnection.definitionRevision + 1,
      undoDepth: beforeConnection.undoDepth + 1,
    })
  await expect(page.getByRole('button', { name: 'Add Node' })).toBeEnabled()

  const dependency = page.getByRole('group', { name: 'Dependency from publish to command' })
  await dependency.focus()
  await dependency.press('Enter')
  const selectedPath = dependency.locator('path.workflow-edge')
  await expect(selectedPath).toHaveClass(/selected/)
  const selectedStyleContract = await selectedPath.evaluate((path) => {
    const matchingStrokes: string[] = []
    const visit = (rules: CSSRuleList): void => {
      for (const rule of rules) {
        if (rule instanceof CSSStyleRule) {
          try {
            if (path.matches(rule.selectorText)) matchingStrokes.push(rule.style.getPropertyValue('stroke').trim())
          } catch {
            // Ignore selectors unsupported by the current engine; another matching rule still proves the contract.
          }
        } else if ('cssRules' in rule) {
          visit((rule as CSSGroupingRule).cssRules)
        }
      }
    }
    for (const sheet of document.styleSheets) {
      try {
        visit(sheet.cssRules)
      } catch {
        // Cross-origin sheets are not expected, but must not make the selected-style probe engine-specific.
      }
    }
    return {
      token: getComputedStyle(document.documentElement).getPropertyValue('--color-edge-selected').trim(),
      matchingStrokes,
    }
  })
  expect(selectedStyleContract.token).not.toBe('')
  expect(selectedStyleContract.matchingStrokes).toContain('var(--color-edge-selected)')
  await expect(page.getByText('Open Inspector is unavailable.', { exact: true })).toHaveCount(0)
  await expect(page.locator('.svelte-flow__node.selected')).toHaveCount(0)

  const selectedDefinition = (await e2eSnapshot(page)).definitionText
  if (typeof selectedDefinition !== 'string') throw new Error('Expected the selected workflow definition text.')
  const refreshedDefinition = selectedDefinition.replace(
    'description: Verify the complete authoring path.',
    'description: Verify the complete authoring path after projection refresh.',
  )
  await replaceDefinitionYaml(page, refreshedDefinition)
  await expectAuthoritativeYaml(page, refreshedDefinition)
  await page.getByRole('button', { name: 'Visual', exact: true }).click()
  const refreshedDependency = page.getByRole('group', { name: 'Dependency from publish to command' })
  await expect(refreshedDependency.locator('path.workflow-edge')).toHaveClass(/selected/)
  await expect
    .poll(() =>
      page
        .locator('.svelte-flow__node.selected')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-id'))),
    )
    .toEqual([])

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
