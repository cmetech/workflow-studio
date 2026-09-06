import { expect, test, type Locator } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'
import {
  activeScopeSnapshot,
  editorMetrics,
  e2eSnapshot,
  expectExactWorkbenchGeometry,
  expectNoPointerAuthorityWork,
  expectSingleMountedScope,
  modShortcut,
  openSeededPair,
  performNodeDrag,
  performPortDrag,
  prepareNodeDrag,
  preparePortDrag,
  replaceDefinitionYaml,
  resetEditorMetrics,
  settleRenderer,
  yamlSelection,
} from './support'

// Trace DOM snapshots contaminate Chromium's renderer long-task observer.
const performanceTest = test.extend({})
performanceTest.use({ trace: 'off' })

interface LongTaskState {
  readonly entries: Array<{ readonly startTime: number; readonly duration: number }>
  readonly observer: PerformanceObserver
}

async function beginLongTaskPhase(page: import('@playwright/test').Page, browserName: string): Promise<number | null> {
  if (browserName !== 'chromium') return null
  await settleRenderer(page)
  return page.evaluate(() => {
    const state = (window as unknown as { __LOOP_GROUP_LONG_TASKS__: LongTaskState }).__LOOP_GROUP_LONG_TASKS__
    state.observer.takeRecords()
    state.entries.splice(0)
    return performance.now()
  })
}

async function expectNoLongTasks(
  page: import('@playwright/test').Page,
  browserName: string,
  label: string,
  phaseStart: number | null,
): Promise<void> {
  if (browserName !== 'chromium' || phaseStart === null) return
  await settleRenderer(page)
  const observation = await page.evaluate((startTime) => {
    const state = (window as unknown as { __LOOP_GROUP_LONG_TASKS__: LongTaskState }).__LOOP_GROUP_LONG_TASKS__
    state.observer.takeRecords().forEach(({ startTime, duration }) => state.entries.push({ startTime, duration }))
    const phaseEntries = state.entries.filter((entry) => entry.startTime >= startTime)
    state.entries.splice(0)
    return { phaseEntries, phaseStart: startTime, phaseEnd: performance.now() }
  }, phaseStart)
  expect(
    observation.phaseEntries.filter(({ duration }) => duration > 50),
    JSON.stringify({ label, ...observation }),
  ).toEqual([])
}

async function expectVisibleFocusCue(control: Locator, visual = control): Promise<void> {
  await expect(control).toBeFocused()
  const cue = await visual.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
      borderWidths: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth].map(
        Number.parseFloat,
      ),
    }
  })
  expect(
    (cue.outlineStyle !== 'none' && cue.outlineWidth > 0) || cue.borderWidths.some((width) => width > 0),
    JSON.stringify(cue),
  ).toBe(true)
}

function scopedLayoutState(snapshot: Awaited<ReturnType<typeof activeScopeSnapshot>>) {
  return {
    activeScopeKey: snapshot.activeScopeKey,
    selectedNodeIds: snapshot.selectedNodeIds,
    viewport: snapshot.viewport,
    positions: snapshot.positions,
    focusTarget: snapshot.focusTarget,
    inspector: snapshot.inspector,
    canvasScroll: snapshot.canvasScroll,
    problemsScroll: snapshot.problemsScroll,
  }
}

async function expectedIssueSelection(page: import('@playwright/test').Page, code: string) {
  const snapshot = await e2eSnapshot(page)
  const issue = (snapshot.analysisIssues as Array<{ code: string; line?: number; column?: number }>).find(
    (candidate) => candidate.code === code,
  )
  if (!issue?.line || !issue.column) throw new Error(`Issue ${code} has no literal source coordinate.`)
  const text = String(snapshot.definitionText)
  const lines = text.split('\n')
  if (!lines[issue.line - 1] || issue.column > lines[issue.line - 1]!.length + 1) {
    throw new Error(`Issue ${code} coordinate does not address the literal fixture text.`)
  }
  return { line: issue.line, column: issue.column, collapsed: true }
}

test.describe('loop group visual authoring', () => {
  test('opens a bundled compound group by its action, keyboard, and double click', async ({ page }) => {
    await openSeededPair(page)
    await page.getByRole('button', { name: 'Examples', exact: true }).click()
    await page.getByRole('button', { name: 'Create Editable Copy: Iteration context' }).click()
    const expectedDefinition = await readFile(
      new URL('../../examples/loop-group-iteration-context/workflow.yaml', import.meta.url),
      'utf8',
    )
    const expectedCompanion = await readFile(
      new URL('../../examples/loop-group-iteration-context/workflow.hermes.yaml', import.meta.url),
      'utf8',
    )
    await expect.poll(async () => (await e2eSnapshot(page)).definitionText).toBe(expectedDefinition)
    await page.getByRole('button', { name: 'Back to Workflow' }).click()
    const created = await e2eSnapshot(page)
    expect(created.definitionText).toBe(expectedDefinition)
    expect(created.companionText).toBe(expectedCompanion)

    const group = page.locator('.svelte-flow__node[data-id="refine"]')
    await expect(group).toHaveAccessibleName(/refine.*1 body node.*maximum 3 iterations.*primary output revise/i)
    const openRefine = group.getByRole('button', { name: 'Open loop body' })
    await expect(openRefine).toBeVisible()
    await expectSingleMountedScope(page, 'root')

    await openRefine.click()
    await expect(page.getByRole('heading', { name: /refine loop body/i })).toBeFocused()
    await expectSingleMountedScope(page, 'loop-group:refine')
    await page.getByRole('button', { name: 'Back to root workflow' }).click()
    await expect(group).toBeFocused()

    await group.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: /refine loop body/i })).toBeFocused()
    await page.getByRole('button', { name: 'Back to root workflow' }).click()
    await group.dblclick()
    await expectSingleMountedScope(page, 'loop-group:refine')
  })

  test('authors body nodes and references without crossing sibling scope identity', async ({ page }) => {
    const task12RawDefinition = await readFile(
      new URL('../../examples/loop-group-iteration-context/workflow.yaml', import.meta.url),
      'utf8',
    )
    await openSeededPair(page, { scenario: 'loop-group-authoring', pairName: 'release-demo.yaml' })
    await page.locator('.svelte-flow__node[data-id="polish"]').focus()
    await page.keyboard.press('Enter')
    await page.getByRole('tab', { name: 'References', exact: true }).click()
    const references = page.getByRole('region', { name: 'References for polish' })
    await expect(references).toBeVisible()
    for (const name of [
      'Earlier nodes in this iteration',
      'Inputs from the main workflow',
      'Outputs from the previous iteration',
    ])
      await expect(references.getByRole('heading', { name, exact: true })).toBeVisible()
    await page.locator('.svelte-flow__node[data-id="review"]').focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('.svelte-flow__node[data-id="review"]')).toHaveClass(/selected/)
    await page.getByRole('tab', { name: 'General' }).click()
    const prompt = page.getByRole('textbox', { name: /Prompt Required/i })
    await prompt.click()
    await expect(page.getByText('$draft.output', { exact: true })).toBeVisible()
    await expect(page.getByText('$LOOP_PREV.review.output', { exact: true })).toBeVisible()
    const before = await e2eSnapshot(page)
    await resetEditorMetrics(page)
    await page.getByRole('button', { name: 'Insert $draft.output' }).click()
    await page.getByRole('button', { name: 'Insert $seed.output' }).click()
    await page.getByRole('button', { name: 'Insert $LOOP_PREV.review.output' }).click()
    await expect(prompt).toHaveValue('Review the body outputs.$draft.output$seed.output$LOOP_PREV.review.output')
    await page.getByRole('button', { name: /Apply .* Prompt$/ }).click()
    await expect
      .poll(async () => (await e2eSnapshot(page)).definitionRevision)
      .toBe((before.definitionRevision as number) + 1)
    expect(await editorMetrics(page)).toMatchObject({ yamlTransactions: 1 })
    expect((await e2eSnapshot(page)).undoDepth).toBe(Number(before.undoDepth) + 1)
    const referenceText = String((await e2eSnapshot(page)).definitionText)
    expect(referenceText).toContain('prompt: Review the body outputs.$draft.output$seed.output$LOOP_PREV.review.output')
    const parsedReferences = parse(referenceText) as {
      nodes: Array<{ id: string; loop_group?: { nodes: Array<Record<string, unknown>> } }>
    }
    expect(parsedReferences.nodes.find(({ id }) => id === 'polish')?.loop_group?.nodes).toContainEqual({
      id: 'review',
      depends_on: ['draft'],
      prompt: 'Review the body outputs.$draft.output$seed.output$LOOP_PREV.review.output',
      provider: 'deterministic-provider',
      model: 'retained-model',
    })
    await expect(page.locator('.svelte-flow__node[data-id="draft"]')).toHaveCount(1)

    const beforeAdd = await e2eSnapshot(page)
    await page.getByRole('button', { name: 'Nodes', exact: true }).click()
    await page.getByRole('button', { name: 'Add Bash node' }).click()
    const bash = page.locator('.svelte-flow__node[data-id="bash"]')
    await expect(bash).toBeAttached()
    expect((await e2eSnapshot(page)).undoDepth).toBe(Number(beforeAdd.undoDepth) + 1)
    await bash.focus()
    await page.keyboard.press('Enter')
    const bashField = page.getByRole('textbox', { name: /Nodes Item 3 Bash Required/i })
    const beforeBash = await e2eSnapshot(page)
    await bashField.fill('echo verified')
    await page.getByRole('button', { name: /Apply .* Item 3 Bash$/ }).click()
    await expect.poll(async () => String((await e2eSnapshot(page)).definitionText)).toContain('bash: "echo verified"')
    expect((await e2eSnapshot(page)).undoDepth).toBe(Number(beforeBash.undoDepth) + 1)
    const idField = page.getByRole('textbox', { name: /Nodes Item 3 Id Required/i })
    const beforeRename = await e2eSnapshot(page)
    await idField.fill('verify')
    await page.getByRole('button', { name: /Apply .* Item 3 Id$/ }).click()
    const verify = page.locator('.svelte-flow__node[data-id="verify"]')
    await expect(verify).toBeAttached()
    expect((await e2eSnapshot(page)).undoDepth).toBe(Number(beforeRename.undoDepth) + 1)

    const beforeConnect = await e2eSnapshot(page)
    const beforeConnectRevision = Number(beforeConnect.definitionRevision)
    await performPortDrag(page, await preparePortDrag(page, 'draft', 'verify'))
    await expect.poll(async () => Number((await e2eSnapshot(page)).definitionRevision)).toBe(beforeConnectRevision + 1)
    expect(Number((await e2eSnapshot(page)).undoDepth)).toBe(Number(beforeConnect.undoDepth) + 1)
    const connected = String((await e2eSnapshot(page)).definitionText)
    const parsedConnected = parse(connected) as {
      nodes: Array<{ id: string; loop_group?: { nodes: Array<Record<string, unknown>> } }>
    }
    expect(parsedConnected.nodes.find(({ id }) => id === 'polish')?.loop_group?.nodes).toContainEqual({
      id: 'verify',
      bash: 'echo verified',
      depends_on: ['draft'],
    })
    const beforeRejected = await e2eSnapshot(page)
    await performPortDrag(page, await preparePortDrag(page, 'verify', 'draft'))
    await expect(page.getByRole('status', { name: 'Canvas authoring feedback' })).toContainText(/cycle/i)
    expect((await e2eSnapshot(page)).definitionRevision).toBe(beforeRejected.definitionRevision)
    expect((await e2eSnapshot(page)).definitionText).toBe(beforeRejected.definitionText)
    expect((await e2eSnapshot(page)).undoDepth).toBe(beforeRejected.undoDepth)

    await verify.focus()
    await page.keyboard.press('Enter')
    const beforeDuplicate = await e2eSnapshot(page)
    await page.getByRole('button', { name: 'More canvas actions' }).click()
    await page.getByRole('menuitem', { name: 'Duplicate Selection' }).click()
    await expect(page.locator('.svelte-flow__node[data-id="verify-2"]')).toBeAttached()
    expect((await e2eSnapshot(page)).undoDepth).toBe(Number(beforeDuplicate.undoDepth) + 1)
    const beforeDelete = await e2eSnapshot(page)
    await page.getByRole('button', { name: 'More canvas actions' }).click()
    await page.getByRole('menuitem', { name: 'Delete Selection' }).click()
    const deleteDialog = page.getByRole('dialog', { name: 'Delete selected nodes' })
    await deleteDialog.getByRole('button', { name: 'Delete nodes' }).click()
    await expect(page.locator('.svelte-flow__node[data-id="verify"]')).toHaveCount(0)
    await expect(page.locator('.svelte-flow__node[data-id="verify-2"]')).toHaveCount(1)
    expect((await e2eSnapshot(page)).undoDepth).toBe(Number(beforeDelete.undoDepth) + 1)

    const refineScope = await activeScopeSnapshot(page)
    await page.getByRole('button', { name: 'Back to root workflow' }).click()
    const savedText = String((await e2eSnapshot(page)).definitionText)
    const savedCompanion = String((await e2eSnapshot(page)).companionText)
    await page.keyboard.press(modShortcut('s'))
    await page.getByRole('button', { name: 'Explorer', exact: true }).click()
    await page.getByRole('treeitem', { name: /other\.yaml, paired workflow/i }).click()
    await page.getByRole('treeitem', { name: /release-demo\.yaml, paired workflow/i }).click()
    await expect.poll(async () => String((await e2eSnapshot(page)).definitionText)).toBe(savedText)
    expect(String((await e2eSnapshot(page)).companionText)).toBe(savedCompanion)
    expect(savedText.startsWith(task12RawDefinition)).toBe(true)
    expect(savedText).toContain('  # retained visual-authoring augmentation\n')
    expect(savedText).toContain('depends_on: [seed]')
    expect(savedText).toContain('prompt: |-\n            Draft a concise summary.')
    expect(savedText).toContain('provider: &retained_provider "deterministic-provider"')
    expect(savedText).toContain('provider: *retained_provider\n          model: retained-model')

    await page.locator('.svelte-flow__node[data-id="polish"]').focus()
    await page.keyboard.press('Enter')
    const reopenedRefine = await activeScopeSnapshot(page)
    expect(reopenedRefine.activeScopeKey).toBe('loop-group:polish')
    expect(reopenedRefine.viewport).toEqual(refineScope.viewport)
    expect(reopenedRefine.positions).toEqual(refineScope.positions)
    await page.getByRole('button', { name: 'Back to root workflow' }).click()
    await page.locator('.svelte-flow__node[data-id="refine"]').focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('.svelte-flow__node[data-id="revise"]')).toHaveCount(1)
    const sibling = await activeScopeSnapshot(page)
    expect(sibling.activeScopeKey).toBe('loop-group:refine')
    expect(refineScope.activeScopeKey).toBe('loop-group:polish')
  })

  test('preserves independent root and body state through workbench navigation', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 500 })
    await openSeededPair(page, { scenario: 'loop-group-state-restoration', pairName: 'release-demo.yaml' })
    await settleRenderer(page)
    await expect.poll(async () => Object.keys((await activeScopeSnapshot(page)).positions).length).toBe(3)
    await page.getByRole('button', { name: 'More canvas actions' }).click()
    await page.getByRole('menuitem', { name: 'Fit Graph' }).click()
    await page.locator('.svelte-flow__node[data-id="polish"]').getByRole('button', { name: 'Open loop body' }).click()
    await page.getByRole('button', { name: 'Back to root workflow' }).click()
    const flowViewport = page.locator('.svelte-flow__viewport')
    const rootTransform = await flowViewport.getAttribute('style')
    await page.getByRole('button', { name: 'More canvas actions' }).click()
    await page.getByRole('menuitem', { name: 'Zoom In' }).click()
    await expect.poll(() => flowViewport.getAttribute('style')).not.toBe(rootTransform)

    const beforeWheelZoom = (await activeScopeSnapshot(page)).viewport
    const wheelBox = await page.getByTestId('workflow-canvas-viewport').boundingBox()
    if (!wheelBox) throw new Error('The root canvas has no wheel-zoom geometry.')
    await page.mouse.move(wheelBox.x + wheelBox.width / 2, wheelBox.y + wheelBox.height / 2)
    await page.mouse.wheel(0, -240)
    await expect.poll(async () => (await activeScopeSnapshot(page)).viewport?.zoom).not.toBe(beforeWheelZoom?.zoom)
    const pane = page.locator('.svelte-flow__pane')
    const rootPanPoint = await pane.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      for (let y = Math.ceil(bounds.top); y < Math.floor(bounds.bottom); y += 4) {
        for (let x = Math.ceil(bounds.left); x < Math.floor(bounds.right); x += 4) {
          if (document.elementFromPoint(x, y) === element) return { x, y }
        }
      }
      return null
    })
    if (!rootPanPoint) throw new Error('The root canvas has no truthful panning target.')
    await page.mouse.click(rootPanPoint.x, rootPanPoint.y)
    const beforeRootPan = (await activeScopeSnapshot(page)).viewport
    await page.keyboard.down('Space')
    await page.mouse.move(rootPanPoint.x, rootPanPoint.y)
    await page.mouse.down()
    await page.mouse.move(rootPanPoint.x + 30, rootPanPoint.y + 20, { steps: 5 })
    await page.mouse.up()
    await page.keyboard.up('Space')
    await expect.poll(async () => (await activeScopeSnapshot(page)).viewport).not.toEqual(beforeRootPan)
    await page.getByRole('button', { name: 'More canvas actions' }).click()
    await page.getByRole('menuitem', { name: 'Fit Graph' }).click()
    await page
      .locator('.svelte-flow__node[data-id="polish"]')
      .getByRole('button', { name: 'Inspector for polish' })
      .click()
    await page.getByRole('tab', { name: 'Advanced' }).click()
    const rootInspectorScroller = page.locator('[data-scroll-owner="inspector"]')
    await rootInspectorScroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight
      element.dispatchEvent(new Event('scroll'))
    })
    const rootProblemsScroller = page.locator('[data-scroll-owner="problems"]')
    await rootProblemsScroller.evaluate((element) => (element.scrollTop = Math.floor(element.scrollHeight / 2)))
    await expect.poll(() => rootProblemsScroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    const rootCanvasScroller = page.getByTestId('workflow-canvas-viewport')
    const rootCanvasDomScroll = await rootCanvasScroller.evaluate((element) => {
      element.style.overflow = 'auto'
      const flow = element.querySelector<HTMLElement>('.svelte-flow')!
      flow.style.width = 'calc(100% + 80px)'
      flow.style.height = 'calc(100% + 80px)'
      const spacer = document.createElement('div')
      spacer.style.width = '2000px'
      spacer.style.height = '1500px'
      element.append(spacer)
      element.scrollTo(11, 13)
      return {
        left: element.scrollLeft,
        top: element.scrollTop,
        width: element.scrollWidth,
        client: element.clientWidth,
      }
    })
    expect(rootCanvasDomScroll.left + rootCanvasDomScroll.top, JSON.stringify(rootCanvasDomScroll)).toBeGreaterThan(0)
    const rootPosition = (await activeScopeSnapshot(page)).positions.refine!
    await page.getByTestId('workflow-canvas').evaluate((element, position) => {
      element.dispatchEvent(new CustomEvent('workflowdragstop', { bubbles: true, detail: { id: 'polish', position } }))
    }, rootPosition)
    const root = await activeScopeSnapshot(page)
    expect(root.inspector?.scrollTop).toBeGreaterThan(0)
    expect((root.canvasScroll?.left ?? 0) + (root.canvasScroll?.top ?? 0)).toBeGreaterThan(0)
    expect(root.problemsScroll).toBeGreaterThan(0)
    await page.keyboard.press('Escape')
    await page.locator('.svelte-flow__node[data-id="polish"]').getByRole('button', { name: 'Open loop body' }).click()
    const review = page.locator('.svelte-flow__node[data-id="review"]')
    await review.focus()
    await page.keyboard.press('Enter')
    await page.getByRole('tab', { name: 'General' }).click()
    await page.getByRole('tab', { name: 'Problems', exact: true }).focus()
    await page.keyboard.press('Enter')
    const bodyInspectorScroller = page.locator('[data-scroll-owner="inspector"]')
    await bodyInspectorScroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight
      element.dispatchEvent(new Event('scroll'))
    })
    await rootProblemsScroller.evaluate((element) => (element.scrollTop = element.scrollHeight))
    await page.getByTestId('workflow-canvas-viewport').evaluate((element) => {
      element.style.overflow = 'auto'
      const flow = element.querySelector<HTMLElement>('.svelte-flow')!
      flow.style.width = 'calc(100% + 120px)'
      flow.style.height = 'calc(100% + 120px)'
      const spacer = document.createElement('div')
      spacer.style.width = '2100px'
      spacer.style.height = '1600px'
      element.append(spacer)
      element.scrollLeft = 23
      element.scrollTop = 29
    })
    const bodyPosition = (await activeScopeSnapshot(page)).positions.review!
    await page.getByTestId('workflow-canvas').evaluate((element, position) => {
      element.dispatchEvent(new CustomEvent('workflowdragstop', { bubbles: true, detail: { id: 'review', position } }))
    }, bodyPosition)
    await page.keyboard.press('Escape')
    const unsaved = `${String((await e2eSnapshot(page)).definitionText)}${Array.from(
      { length: 80 },
      (_, index) => `# retained unsaved body line ${index}\n`,
    ).join('')}`
    await replaceDefinitionYaml(page, unsaved)
    await expect.poll(async () => String((await e2eSnapshot(page)).definitionText)).toBe(unsaved)
    await expect
      .poll(async () => {
        const snapshot = await e2eSnapshot(page)
        return snapshot.analysisDefinitionRevision === snapshot.definitionRevision
      })
      .toBe(true)
    await page.getByRole('button', { name: 'Visual' }).click()
    await expectSingleMountedScope(page, 'loop-group:polish')
    await page.locator('.svelte-flow__node[data-id="review"]').focus()
    await page.keyboard.press('Enter')
    await page.getByRole('tab', { name: 'General' }).click()
    await rootProblemsScroller.evaluate((element) => (element.scrollTop = element.scrollHeight))
    await expect
      .poll(() => rootProblemsScroller.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(root.problemsScroll)
    const visualBody = await activeScopeSnapshot(page)
    expect(root.selectedNodeIds).toEqual(['polish'])
    expect(visualBody.selectedNodeIds).toEqual(['review'])
    expect(visualBody.selectedNodeIds).not.toEqual(root.selectedNodeIds)
    expect(root.inspector?.tab).toBe('Advanced')
    expect(visualBody.inspector?.tab).toBe('General')
    expect(visualBody.inspector).not.toEqual(root.inspector)
    expect(visualBody.viewport).not.toEqual(root.viewport)
    expect(visualBody.focusTarget).not.toEqual(root.focusTarget)
    expect(visualBody.inspector?.scrollTop).toBeGreaterThan(0)
    expect(visualBody.canvasScroll).not.toEqual(root.canvasScroll)
    expect(visualBody.problemsScroll).toBeGreaterThan(root.problemsScroll)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'YAML' }).click()
    const yamlScroller = page.locator('[aria-label="Definition YAML"] .cm-scroller')
    await yamlScroller.evaluate((element) => (element.scrollTop = element.scrollHeight))
    await expect.poll(() => yamlScroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    const body = await activeScopeSnapshot(page)
    const companion = String((await e2eSnapshot(page)).companionText)

    for (const activity of ['Settings', 'Examples', 'Documentation', 'Git']) {
      await page.getByRole('button', { name: activity, exact: true }).click()
      await expect(page.getByRole('region', { name: activity, exact: true })).toBeVisible()
      await page.getByRole('button', { name: /Back to Workflow/i }).click()
      expect(String((await e2eSnapshot(page)).definitionText)).toBe(unsaved)
      expect(String((await e2eSnapshot(page)).companionText)).toBe(companion)
      expect(await activeScopeSnapshot(page)).toEqual(body)
    }

    await expect.poll(() => yamlScroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    await page.getByRole('button', { name: 'Visual' }).click()
    await expect.poll(async () => (await activeScopeSnapshot(page)).selectedNodeIds).toEqual(['review'])
    const restoredBody = await activeScopeSnapshot(page)
    expect(scopedLayoutState(restoredBody)).toEqual(scopedLayoutState(visualBody))

    await page.getByRole('button', { name: 'Back to root workflow' }).click()
    const restoredRoot = await activeScopeSnapshot(page)
    expect(scopedLayoutState(restoredRoot)).toEqual(scopedLayoutState(root))
    expect(String((await e2eSnapshot(page)).definitionText)).toBe(unsaved)
    expect(String((await e2eSnapshot(page)).companionText)).toBe(companion)
    expect(restoredRoot.mountedSvelteFlowCount).toBe(1)
    await page.locator('.svelte-flow__node[data-id="polish"]').getByRole('button', { name: 'Open loop body' }).click()
    await expect.poll(async () => activeScopeSnapshot(page)).toEqual(visualBody)

    const unknown = `${unsaved}future_unknown: retained\n`
    await replaceDefinitionYaml(page, unknown)
    await expect.poll(async () => String((await e2eSnapshot(page)).definitionText)).toBe(unknown)
    await expect
      .poll(async () => {
        const snapshot = await e2eSnapshot(page)
        return snapshot.analysisDefinitionRevision === snapshot.definitionRevision
      })
      .toBe(true)
    await page.keyboard.press(modShortcut('s'))
    await expect(page.getByRole('alert')).toContainText(/Save blocked/i)
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: /Back to Workflow/i }).click()
    expect(String((await e2eSnapshot(page)).definitionText)).toBe(unknown)
    await page.getByRole('button', { name: 'Back to root workflow' }).click()
    expect((await activeScopeSnapshot(page)).activeScopeKey).toBe('root')
    expect(String((await e2eSnapshot(page)).definitionText)).toBe(unknown)
  })

  test('routes scoped Problems without confusing repeated child IDs', async ({ page }) => {
    await openSeededPair(page, { scenario: 'loop-group-scoped-problems', pairName: 'release-demo.yaml' })
    await expect(page.locator('[data-issue-key]')).toHaveCount(3)
    const childRow = page.locator('[data-issue-key*="e2e_scoped_child"]')
    const childIssue = childRow.locator('button').first()
    await childIssue.click()
    await expect.poll(async () => (await activeScopeSnapshot(page)).activeScopeKey).toBe('loop-group:refine')
    await expect.poll(async () => (await activeScopeSnapshot(page)).selectedNodeIds).toEqual(['draft'])
    const child = await activeScopeSnapshot(page)
    expect(child.activeScopeKey).toBe('loop-group:refine')
    expect(child.selectedNodeIds).toEqual(['draft'])
    const promptField = page.locator('[data-field-pointer="/nodes/0/loop_group/nodes/0/prompt"]')
    await expect(promptField).toBeVisible()
    await expect(promptField).toHaveAttribute('data-field-id', /.+/)
    await expect(promptField.getByRole('textbox')).toBeFocused()

    const groupIssue = page.locator('[data-issue-key*="e2e_group_control"] button').first()
    await groupIssue.click()
    const group = await activeScopeSnapshot(page)
    expect(group.activeScopeKey).toBe('loop-group:refine')
    expect(group.selectedNodeIds).toEqual(['draft'])
    await expect(page.getByRole('textbox', { name: /Loop group Until Required/i })).toBeFocused()

    const yamlIssue = page.locator('[data-issue-key*="e2e_yaml_fallback"] button').first()
    await yamlIssue.click()
    await expect(page.getByRole('button', { name: 'YAML' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('textbox', { name: 'Definition YAML' })).toBeFocused()
    await expect(page.locator('[aria-label="Definition YAML"] .cm-activeLine')).toHaveText(
      'description: Repairable scoped findings with repeated child identifiers.',
    )
    expect(await yamlSelection(page)).toEqual(await expectedIssueSelection(page, 'e2e_yaml_fallback'))
    expect(String((await e2eSnapshot(page)).definitionText)).toContain('description: Repairable scoped findings')
  })

  test('shows an empty draft as blocked and makes its repair actions keyboard operable', async ({ page }) => {
    await openSeededPair(page, { scenario: 'loop-group-authoring', pairName: 'release-demo.yaml' })
    const beforeCreation = String((await e2eSnapshot(page)).definitionText)
    await page.getByRole('button', { name: 'Nodes', exact: true }).click()
    await page.getByRole('button', { name: 'Add Loop group node' }).click()
    await expect.poll(async () => (await activeScopeSnapshot(page)).activeScopeKey).toMatch(/^loop-group:/)
    const scopeKey = (await activeScopeSnapshot(page)).activeScopeKey
    expect(scopeKey?.startsWith('loop-group:')).toBe(true)
    const groupId = scopeKey!.slice('loop-group:'.length)
    const created = String((await e2eSnapshot(page)).definitionText)
    expect(created.slice(beforeCreation.length)).toBe(`  - id: ${groupId}\n    loop_group:\n      nodes: []\n`)
    await expect(page.getByRole('heading', { name: new RegExp(`${groupId} loop body`, 'i') })).toBeFocused()
    await expect(page.getByRole('button', { name: /Add First Node/i })).toBeEnabled()
    const empty = page.getByRole('region', { name: `Empty loop body for ${groupId}` })
    const editSettings = empty.getByRole('button', { name: 'Edit Group Settings' })
    await expect(editSettings).toBeEnabled()
    await expect(page.getByText(/Save and export remain blocked/i)).toBeVisible()
    await page.keyboard.press(modShortcut('s'))
    await expect(page.getByRole('alert')).toContainText(/Save blocked/i)
    await page.getByRole('button', { name: 'Explorer', exact: true }).click()
    const pair = page.getByRole('treeitem', { name: /release-demo\.yaml, paired workflow/i })
    await pair.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Export' }).click()
    const exportDialog = page.getByRole('dialog', { name: 'Export workflow' })
    await expect(exportDialog).toContainText('Resolve structural issues before export.')
    await exportDialog.getByRole('button', { name: 'Close' }).click()
    await page.getByRole('button', { name: /Add First Node/i }).click()
    const addDialog = page.getByRole('dialog', { name: 'Add node' })
    await addDialog.getByRole('option', { name: /Prompt/ }).click()
    const first = page.locator('.svelte-flow__node[data-id="prompt"]')
    await expect(first).toBeAttached()
    expect(String((await e2eSnapshot(page)).definitionText)).toContain('nodes: [{ id: prompt, prompt: "" }]')
    const currentSettings = page.getByRole('button', { name: 'Edit Group Settings' }).first()
    await currentSettings.focus()
    await expect(currentSettings).toBeFocused()
    await currentSettings.click()
    await page.getByRole('tab', { name: 'Advanced' }).click()
    const untilControl = page.locator('[data-field-pointer="/nodes/3/loop_group/until"]')
    const until = untilControl.getByRole('textbox')
    await until.fill('complete')
    await untilControl.getByRole('button', { name: /Apply Loop group Until$/ }).click()
    await expect
      .poll(async () => String((await e2eSnapshot(page)).definitionText))
      .toContain(
        `  - id: ${groupId}\n    loop_group:\n      nodes: [{ id: prompt, prompt: "" }]\n      until: complete`,
      )
    const maximumControl = page.locator('[data-field-pointer="/nodes/3/loop_group/max_iterations"]')
    const maximum = maximumControl.getByRole('spinbutton')
    await maximum.fill('4')
    await expect(maximum).toHaveValue('4')
    await maximumControl.getByRole('button', { name: /Apply Loop group Max iterations$/ }).click()
    await expect
      .poll(async () => String((await e2eSnapshot(page)).definitionText))
      .toContain(`nodes: [{ id: prompt, prompt: "" }]\n      until: complete\n      max_iterations: 4`)
    await expect
      .poll(async () => {
        const snapshot = await e2eSnapshot(page)
        return snapshot.analysisDefinitionRevision === snapshot.definitionRevision
      })
      .toBe(true)
    await first.focus()
    await page.keyboard.press('Enter')
    await page.getByRole('tab', { name: 'General' }).click()
    const promptControl = page.locator('[data-field-pointer$="/loop_group/nodes/0/prompt"]')
    const prompt = promptControl.getByRole('textbox')
    await prompt.fill('Repair the empty body.')
    await promptControl.getByRole('button', { name: /^Apply .* Prompt$/ }).click()
    await expect(page.locator('[data-issue-key]')).toHaveCount(0)
    const repaired = String((await e2eSnapshot(page)).definitionText)
    const repairedCompanion = String((await e2eSnapshot(page)).companionText)
    await page.keyboard.press(modShortcut('s'))
    await page.getByRole('button', { name: 'Explorer', exact: true }).click()
    await page.getByRole('treeitem', { name: /other\.yaml, paired workflow/i }).click()
    await page.getByRole('treeitem', { name: /release-demo\.yaml, paired workflow/i }).click()
    await expect.poll(async () => String((await e2eSnapshot(page)).definitionText)).toBe(repaired)
    expect(String((await e2eSnapshot(page)).companionText)).toBe(repairedCompanion)
    await expect(page.getByRole('heading', { name: new RegExp(`${groupId} loop body`, 'i') })).toBeVisible()
    await page.locator('.svelte-flow__node[data-id="prompt"]').focus()
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: 'More canvas actions' }).click()
    await page.getByRole('menuitem', { name: 'Delete Selection' }).click()
    await page
      .getByRole('dialog', { name: 'Delete selected nodes' })
      .getByRole('button', { name: 'Delete nodes' })
      .click()
    await expect(page.getByRole('region', { name: `Empty loop body for ${groupId}` })).toBeVisible()
    expect(String((await e2eSnapshot(page)).definitionText)).toContain('until: complete')
    expect(String((await e2eSnapshot(page)).definitionText)).toContain('max_iterations: 4')
  })

  test('isolates an oversized body while root and a small sibling remain visual', async ({ page }) => {
    await openSeededPair(page, { scenario: 'loop-group-oversized-body', pairName: 'release-demo.yaml' })
    const before = await e2eSnapshot(page)
    await expectSingleMountedScope(page, 'root')
    await page
      .locator('.svelte-flow__node[data-id="large-group"]')
      .getByRole('button', { name: 'Open loop body' })
      .click()
    await expect(page.getByText(/visual canvas supports at most 250 nodes and 500 edges/i)).toBeVisible()
    await expect(page.locator('.svelte-flow')).toHaveCount(0)
    await page.getByRole('tab', { name: 'Problems', exact: true }).click()
    const capacityIssue = page.locator('[data-issue-key*="visual_capacity_exceeded"]')
    await capacityIssue.getByRole('button', { name: /Open documentation/i }).click()
    await expect(page.getByRole('region', { name: 'Documentation', exact: true })).toBeVisible()
    await page.getByRole('button', { name: /Back to Workflow/i }).click()
    await capacityIssue.locator('button').first().click()
    await expect(page.getByRole('button', { name: 'YAML' })).toHaveAttribute('aria-pressed', 'true')
    expect(await yamlSelection(page)).toEqual(await expectedIssueSelection(page, 'visual_capacity_exceeded'))
    expect((await activeScopeSnapshot(page)).activeScopeKey).toBe('loop-group:large-group')
    await page.getByRole('button', { name: 'Back to root workflow' }).click()
    await page
      .getByRole('group', { name: 'Editor mode' })
      .locator(':scope > button')
      .filter({ hasText: /^Visual$/ })
      .click()
    await page
      .locator('.svelte-flow__node[data-id="small-group"]')
      .getByRole('button', { name: 'Open loop body' })
      .click()
    await expectSingleMountedScope(page, 'loop-group:small-group')
    await page.keyboard.press(modShortcut('s'))
    const after = await e2eSnapshot(page)
    expect(after.definitionText).toBe(before.definitionText)
    expect(after.companionText).toBe(before.companionText)
  })

  test('keeps scoped controls accessible under compact, reduced-motion, and forced-color modes', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' })
    await page.setViewportSize({ width: 1024, height: 700 })
    await openSeededPair(page, { scenario: 'loop-group-state-restoration', pairName: 'release-demo.yaml' })
    const compound = page.locator('.svelte-flow__node[data-id="polish"]')
    await expect(compound).toHaveAccessibleName(/polish.*2 body nodes.*maximum 3 iterations.*primary output review/i)
    await expect(compound.getByText('Group output: review')).toBeVisible()
    await expect(compound.locator('[data-port="input"]')).toHaveAccessibleName('Dependencies entering polish')
    await expect(compound.locator('[data-port="output"]')).toHaveAccessibleName('Dependencies leaving polish')
    const openBody = page
      .locator('.svelte-flow__node[data-id="polish"]')
      .getByRole('button', { name: 'Open loop body' })
    await openBody.focus()
    await expectVisibleFocusCue(openBody)
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: /polish loop body/i })).toBeFocused()
    await page.getByRole('tab', { name: 'References', exact: true }).click()
    await expect(page.getByRole('region', { name: 'References for polish' })).toContainText(
      'Copy works at any time. Insert adds a token to a compatible Inspector text field.',
    )
    const copyCurrent = page.getByRole('button', { name: /^Copy / }).first()
    await copyCurrent.focus()
    await expectVisibleFocusCue(copyCurrent)
    await page.keyboard.press('Enter')
    await expect(page.locator('[aria-label="References for polish"] [role="status"]')).toContainText(
      /copied|could not be copied/i,
    )
    const finalCopyAction = page.getByRole('button', { name: /^Copy / }).last()
    await finalCopyAction.focus()
    await expectVisibleFocusCue(finalCopyAction)
    await page.keyboard.press('Enter')
    const bodyReview = page.locator('.svelte-flow__node[data-id="review"]')
    await expect(bodyReview).toHaveAttribute('aria-label', /prompt node review in loop group polish/i)
    await expect(bodyReview.locator('[data-port="input"]')).toHaveAccessibleName('Dependencies entering review')
    await expect(bodyReview.locator('[data-port="output"]')).toHaveAccessibleName('Dependencies leaving review')
    await expectExactWorkbenchGeometry(page)
    const bounded = await page.evaluate(() => {
      const toolbar = document.querySelector<HTMLElement>('[aria-label="Canvas tools"]')!
      const problems = document.querySelector<HTMLElement>('[data-scroll-frame="auxiliary"]')!
      const referenceScroller = document.querySelector<HTMLElement>('[data-scroll-owner="references"]')!
      return {
        toolbarBottom: toolbar.getBoundingClientRect().bottom,
        problemsTop: problems.getBoundingClientRect().top,
        problemsBottom: problems.getBoundingClientRect().bottom,
        referenceScrollerBottom: referenceScroller.getBoundingClientRect().bottom,
      }
    })
    expect(bounded.toolbarBottom).toBeLessThanOrEqual(bounded.problemsTop)
    expect(bounded.problemsBottom).toBeLessThanOrEqual(700)
    expect(bounded.referenceScrollerBottom).toBeLessThanOrEqual(bounded.problemsBottom)
    const addNode = page.getByRole('button', { name: 'Add Node' })
    await addNode.focus()
    await expectVisibleFocusCue(addNode)
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: 'Add node' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Add node' })).toHaveCount(0)
    await page.getByRole('tab', { name: 'Problems', exact: true }).click()
    const firstProblemAction = page.locator('[data-issue-key*="e2e_state_advisory_"] button').first()
    await firstProblemAction.focus()
    await expectVisibleFocusCue(firstProblemAction)
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await activeScopeSnapshot(page)).selectedNodeIds).toEqual(['draft'])
    await page.keyboard.press('Escape')
    const nodesActivity = page.getByRole('button', { name: 'Nodes', exact: true })
    await nodesActivity.focus()
    await expectVisibleFocusCue(nodesActivity)
    await page.keyboard.press('Enter')
    await expect(page.getByRole('region', { name: 'Nodes', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(nodesActivity).toBeFocused()
    const review = page.locator('.svelte-flow__node[data-id="review"]')
    await review.focus()
    await expectVisibleFocusCue(review, review.locator('.workflow-node'))
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await activeScopeSnapshot(page)).selectedNodeIds).toEqual(['review'])
    await expect(review.getByRole('button', { name: 'Inspector for review' })).toHaveAttribute('aria-expanded', 'true')
    const selectedCue = await review.locator('.workflow-node').evaluate((element) => {
      const style = getComputedStyle(element)
      return { outlineStyle: style.outlineStyle, outlineWidth: Number.parseFloat(style.outlineWidth) }
    })
    expect(selectedCue.outlineStyle).not.toBe('none')
    expect(selectedCue.outlineWidth).toBeGreaterThan(0)
    const prompt = page.getByRole('textbox', { name: /Prompt Required/i })
    await expect(prompt).toHaveAccessibleName(/Prompt Required/i)
    await prompt.focus()
    await expectVisibleFocusCue(prompt)
    await page.keyboard.press('End')
    await page.getByRole('tab', { name: 'References', exact: true }).focus()
    await page.keyboard.press('Enter')
    const insertCurrent = page.getByRole('button', { name: 'Insert $draft.output' })
    await insertCurrent.focus()
    await expectVisibleFocusCue(insertCurrent)
    await page.keyboard.press('Enter')
    await expect(prompt).toHaveValue('Review the body outputs.$draft.output')
    await review.focus()
    await page.keyboard.press('e')
    await expect(page.getByText(/create edge from review/i)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByText(/create edge from review/i)).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(prompt).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect.poll(async () => (await activeScopeSnapshot(page)).selectedNodeIds).toEqual([])
    const groupSettings = page.getByRole('button', { name: 'Edit Group Settings' })
    await groupSettings.focus()
    await expectVisibleFocusCue(groupSettings)
    await page.keyboard.press('Enter')
    await expect(page.getByText('polish', { exact: true }).last()).toBeVisible()
    const back = page.getByRole('button', { name: 'Back to root workflow' })
    await back.focus()
    await expectVisibleFocusCue(back)
    await page.keyboard.press('Enter')
    await expect(page.locator('.svelte-flow__node[data-id="polish"]')).toBeFocused()
    const advancedFocus = page.getByRole('button', { name: 'More canvas actions' })
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => {
            document.querySelector<HTMLElement>('[aria-label="More canvas actions"]')?.focus()
            requestAnimationFrame(() => resolve())
          }),
        ),
    )
    await expectVisibleFocusCue(advancedFocus)
    const beforeSave = String((await e2eSnapshot(page)).definitionText)
    await page.keyboard.press(modShortcut('s'))
    expect(String((await e2eSnapshot(page)).definitionText)).toBe(beforeSave)
    await openBody.focus()
    await page.keyboard.press('Enter')
    await page.locator('.svelte-flow__node[data-id="review"]').focus()
    await page.keyboard.press('Enter')
    await page.setViewportSize({ width: 512, height: 350 })
    const compactInspectorScroller = page.locator('[data-scroll-owner="inspector"]')
    await page.getByRole('tab', { name: 'Problems', exact: true }).focus()
    await page.keyboard.press('Enter')
    const compactProblemsScroller = page.locator('[data-scroll-owner="problems"]')
    await compactInspectorScroller.evaluate((element) => (element.scrollTop = element.scrollHeight))
    await compactProblemsScroller.evaluate((element) => (element.scrollTop = element.scrollHeight))
    await expect.poll(() => compactInspectorScroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    await expect.poll(() => compactProblemsScroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    await page.keyboard.press('Escape')
    await page.getByRole('tab', { name: 'References', exact: true }).click()
    const motion = await page
      .locator(
        '[data-testid="graph-scope-header"], [aria-label="References for polish"], .workflow-node, .graph-canvas',
      )
      .evaluateAll((elements) =>
        elements.map((element) => {
          const style = getComputedStyle(element)
          return { animation: style.animationDuration, transition: style.transitionDuration }
        }),
      )
    expect(motion.length).toBeGreaterThanOrEqual(3)
    expect(
      motion.every((value) =>
        [value.animation, value.transition].every((durations) =>
          durations.split(',').every((duration) => duration.trim() === '' || Number.parseFloat(duration) === 0),
        ),
      ),
      JSON.stringify(motion),
    ).toBe(true)
    await expectExactWorkbenchGeometry(page)
    const compactFrames = await page.evaluate(() => {
      const frames = [...document.querySelectorAll<HTMLElement>('[data-scroll-frame]')]
      return frames.map((frame) => ({
        name: frame.dataset.scrollFrame,
        top: frame.getBoundingClientRect().top,
        bottom: frame.getBoundingClientRect().bottom,
        height: frame.getBoundingClientRect().height,
      }))
    })
    expect(compactFrames.length).toBeGreaterThan(0)
    expect(compactFrames.every(({ top, bottom, height }) => top >= 0 && bottom <= 350 && height >= 0)).toBe(true)

    await openSeededPair(page, { scenario: 'loop-group-empty-draft', pairName: 'release-demo.yaml' })
    await page.locator('.svelte-flow__node[data-id="empty"]').focus()
    await page.keyboard.press('Enter')
    const emptyState = page.getByRole('region', { name: 'Empty loop body for empty' })
    const emptyCue = await emptyState.evaluate((element) => {
      const style = getComputedStyle(element)
      return { borderStyle: style.borderStyle, borderWidth: style.borderWidth }
    })
    expect(emptyCue.borderStyle).not.toBe('none')
    expect(emptyCue.borderWidth).not.toBe('0px')
    const emptyMotion = await emptyState.locator(':scope, :scope *').evaluateAll((elements) =>
      elements.map((element) => {
        const style = getComputedStyle(element)
        return [style.animationDuration, style.transitionDuration]
      }),
    )
    expect(
      emptyMotion
        .flat()
        .every((durations) =>
          durations.split(',').every((duration) => duration.trim() === '' || Number.parseFloat(duration) === 0),
        ),
    ).toBe(true)
    const addFirst = emptyState.getByRole('button', { name: 'Add First Node' })
    await addFirst.focus()
    await expectVisibleFocusCue(addFirst)
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: 'Add node' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Add node' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect.poll(async () => (await activeScopeSnapshot(page)).activeScopeKey).toBe('root')
    await expect(page.locator('.svelte-flow__node[data-id="empty"]')).toBeFocused()
  })

  performanceTest('keeps hidden scopes idle during scoped gestures and navigation', async ({ page, browserName }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    if (browserName === 'chromium') {
      await page.addInitScript(() => {
        const entries: Array<{ startTime: number; duration: number }> = []
        const observer = new PerformanceObserver((list) => {
          entries.push(...list.getEntries().map(({ startTime, duration }) => ({ startTime, duration })))
        })
        observer.observe({ type: 'longtask' })
        Object.defineProperty(window, '__LOOP_GROUP_LONG_TASKS__', { value: { entries, observer } })
      })
    }
    await openSeededPair(page, { scenario: 'loop-group-scoped-capacity', pairName: 'release-demo.yaml' })
    await settleRenderer(page)
    await expect
      .poll(async () => page.evaluate(() => window.__WORKFLOW_STUDIO_E2E__!.projectionScopes().length))
      .toBe(4)
    await page.evaluate(() =>
      window.__WORKFLOW_STUDIO_E2E__!.prepareScopedConnection('loop-group:root-000', 'body-0-003', 'body-0-004'),
    )
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            window
              .__WORKFLOW_STUDIO_E2E__!.projectionScopes()
              .find(({ scopeKey }) => scopeKey === 'loop-group:root-000')?.edgeCount,
        ),
      )
      .toBe(499)
    if (browserName === 'chromium') {
      await page.evaluate(() => {
        const state = (window as unknown as { __LOOP_GROUP_LONG_TASKS__: LongTaskState }).__LOOP_GROUP_LONG_TASKS__
        state.entries.splice(0)
      })
    }
    await resetEditorMetrics(page)
    await expectSingleMountedScope(page, 'root')
    await expect(page.locator('.svelte-flow__node[data-id="body-0-003"]')).toHaveCount(0)
    await expect(page.locator('.svelte-flow__node[data-id="body-1-003"]')).toHaveCount(0)
    const rootStart = await page.evaluate(() => window.__WORKFLOW_STUDIO_E2E__!.persistedScopeLayout('root'))
    const rootDragStart = await prepareNodeDrag(page, 'root-001')
    const rootDragPhase = await beginLongTaskPhase(page, browserName)
    await performNodeDrag(page, rootDragStart, { x: 110, y: 120 }, async () => {
      const metrics = await editorMetrics(page)
      expectNoPointerAuthorityWork(metrics)
      expect(metrics.pointerMoves).toBeGreaterThan(0)
    })
    await expectNoLongTasks(page, browserName, 'root node drag', rootDragPhase)
    await expect
      .poll(async () => page.evaluate(() => window.__WORKFLOW_STUDIO_E2E__!.persistedScopeLayout('root').saveCount))
      .toBe(rootStart.saveCount + 1)
    await resetEditorMetrics(page)

    const rootInteractionPhase = await beginLongTaskPhase(page, browserName)
    const flowViewport = page.locator('.svelte-flow__viewport')
    const rootTransform = await flowViewport.getAttribute('style')
    await page.getByRole('button', { name: 'More canvas actions' }).click()
    await page.getByRole('menuitem', { name: 'Zoom In' }).click()
    await expect.poll(() => flowViewport.getAttribute('style')).not.toBe(rootTransform)

    const beforePan = (await activeScopeSnapshot(page)).viewport!
    const pane = page.locator('.svelte-flow__pane')
    const paneBox = await pane.boundingBox()
    if (!paneBox) throw new Error('The root canvas has no panning geometry.')
    const wheelZoom = (await activeScopeSnapshot(page)).viewport!.zoom
    await page.mouse.move(paneBox.x + paneBox.width / 2, paneBox.y + paneBox.height / 2)
    await page.mouse.wheel(0, -240)
    await expect.poll(async () => (await activeScopeSnapshot(page)).viewport?.zoom).not.toBe(wheelZoom)
    await page.evaluate(() => window.__WORKFLOW_STUDIO_E2E__!.flushRecoveryPersistence())
    await resetEditorMetrics(page)
    await page.keyboard.down('Space')
    await page.mouse.move(paneBox.x + paneBox.width / 2, paneBox.y + paneBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(paneBox.x + paneBox.width / 2 + 24, paneBox.y + paneBox.height / 2 + 18, { steps: 5 })
    expectNoPointerAuthorityWork(await editorMetrics(page))
    await page.mouse.up()
    await page.keyboard.up('Space')
    await expect.poll(async () => (await activeScopeSnapshot(page)).viewport).not.toEqual(beforePan)

    await page.locator('.svelte-flow__node[data-id="root-004"]').focus()
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await activeScopeSnapshot(page)).selectedNodeIds).toEqual(['root-004'])
    await page.getByRole('region', { name: 'Workflow graph' }).focus()
    await page.keyboard.press('Escape')
    await expect.poll(async () => (await activeScopeSnapshot(page)).selectedNodeIds).toEqual([])
    await page.evaluate(() => window.__WORKFLOW_STUDIO_E2E__!.flushRecoveryPersistence())
    await resetEditorMetrics(page)
    const [marqueeA, marqueeB, marqueeViewport] = await Promise.all([
      page.locator('.svelte-flow__node[data-id="root-003"]').boundingBox(),
      page.locator('.svelte-flow__node[data-id="root-004"]').boundingBox(),
      page.getByTestId('workflow-canvas-viewport').boundingBox(),
    ])
    if (!marqueeA || !marqueeB || !marqueeViewport) throw new Error('The root marquee targets have no geometry.')
    const marqueeStart = {
      x: Math.max(marqueeViewport.x + 2, Math.min(marqueeA.x, marqueeB.x) - 8),
      y: Math.max(marqueeViewport.y + 2, Math.min(marqueeA.y, marqueeB.y) - 8),
    }
    const marqueeEnd = {
      x: Math.min(
        marqueeViewport.x + marqueeViewport.width - 2,
        Math.max(marqueeA.x + marqueeA.width, marqueeB.x + marqueeB.width) + 8,
      ),
      y: Math.min(
        marqueeViewport.y + marqueeViewport.height - 2,
        Math.max(marqueeA.y + marqueeA.height, marqueeB.y + marqueeB.height) + 8,
      ),
    }
    await page.keyboard.down('Shift')
    await page.mouse.move(marqueeStart.x, marqueeStart.y)
    await page.mouse.down()
    await page.mouse.move(marqueeEnd.x, marqueeEnd.y, { steps: 6 })
    expectNoPointerAuthorityWork(await editorMetrics(page))
    await page.mouse.up()
    await page.keyboard.up('Shift')
    await expect.poll(async () => (await activeScopeSnapshot(page)).selectedNodeIds.length).toBeGreaterThan(0)
    await expectNoLongTasks(page, browserName, 'root pan, zoom, and selection', rootInteractionPhase)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'More canvas actions' }).click()
    await page.getByRole('menuitem', { name: 'Fit Graph' }).click()
    await page.evaluate(() => window.__WORKFLOW_STUDIO_E2E__!.flushRecoveryPersistence())
    const rootBefore = await page.evaluate(() => window.__WORKFLOW_STUDIO_E2E__!.persistedScopeLayout('root'))
    await resetEditorMetrics(page)
    const openBody = page
      .locator('.svelte-flow__node[data-id="root-000"]')
      .getByRole('button', { name: 'Open loop body' })
    await expect(openBody).toBeVisible()
    const openBodyBox = await openBody.boundingBox()
    if (!openBodyBox) throw new Error('The root loop-group action has no pointer geometry.')
    const bodyEntryPhase = await beginLongTaskPhase(page, browserName)
    await page.mouse.click(openBodyBox.x + openBodyBox.width / 2, openBodyBox.y + openBodyBox.height / 2)
    await expect(page.getByTestId('workflow-canvas')).toHaveAttribute('data-scope-key', 'loop-group:root-000')
    await expect(page.getByRole('heading', { name: /root-000 loop body/i })).toBeVisible()
    await expectNoLongTasks(page, browserName, 'body entry', bodyEntryPhase)
    await expectSingleMountedScope(page, 'loop-group:root-000')
    await expect(page.locator('.svelte-flow__node[data-id="root-003"]')).toHaveCount(0)
    await expect(page.locator('.svelte-flow__node[data-id="body-1-003"]')).toHaveCount(0)
    await expect.poll(() => page.locator('.svelte-flow__node').count()).toBeLessThanOrEqual(20)
    expectNoPointerAuthorityWork(await editorMetrics(page))
    await page.getByRole('tab', { name: 'Problems', exact: true }).click()
    await expect(page.locator('[data-issue-key*="e2e_capacity_advisory_"]')).toHaveCount(20)
    const capacityProblems = page.locator('[data-scroll-owner="problems"]')
    const problemsScrollPhase = await beginLongTaskPhase(page, browserName)
    await capacityProblems.evaluate((element) => (element.scrollTop = element.scrollHeight))
    await expect.poll(() => capacityProblems.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    await expectNoLongTasks(page, browserName, 'Problems scroll', problemsScrollPhase)

    const beforeValidRevision = (await activeScopeSnapshot(page)).definitionRevision
    await resetEditorMetrics(page)
    const validPortDrag = await preparePortDrag(page, 'body-0-003', 'body-0-004')
    const validConnectionPhase = await beginLongTaskPhase(page, browserName)
    let validReleasePhase: number | null = null
    await performPortDrag(
      page,
      validPortDrag,
      async () => {
        expectNoPointerAuthorityWork(await editorMetrics(page))
        await expectNoLongTasks(page, browserName, 'valid body connection pointer move', validConnectionPhase)
        validReleasePhase = await beginLongTaskPhase(page, browserName)
      },
      2,
    )
    await expect.poll(async () => (await activeScopeSnapshot(page)).definitionRevision).toBe(beforeValidRevision + 1)
    expect((await editorMetrics(page)).yamlTransactions).toBe(1)
    await expectNoLongTasks(page, browserName, 'valid body connection release', validReleasePhase)
    await page.evaluate(() => window.__WORKFLOW_STUDIO_E2E__!.flushRecoveryPersistence())

    const beforeRejectedRevision = (await activeScopeSnapshot(page)).definitionRevision
    await resetEditorMetrics(page)
    const rejectedPortDrag = await preparePortDrag(page, 'body-0-004', 'body-0-003')
    await page.evaluate(() => window.__WORKFLOW_STUDIO_E2E__!.flushRecoveryPersistence())
    await resetEditorMetrics(page)
    const rejectedConnectionPhase = await beginLongTaskPhase(page, browserName)
    await performPortDrag(
      page,
      rejectedPortDrag,
      async () => expectNoPointerAuthorityWork(await editorMetrics(page)),
      2,
    )
    await expect(page.getByRole('status', { name: 'Canvas authoring feedback' })).toContainText(/cycle/i)
    expect((await activeScopeSnapshot(page)).definitionRevision).toBe(beforeRejectedRevision)
    expect((await editorMetrics(page)).yamlTransactions).toBe(0)
    await expectNoLongTasks(page, browserName, 'rejected body connection', rejectedConnectionPhase)
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            window
              .__WORKFLOW_STUDIO_E2E__!.projectionScopes()
              .find(({ scopeKey }) => scopeKey === 'loop-group:root-000')?.edgeCount,
        ),
      )
      .toBe(500)
    await page.evaluate(() => window.__WORKFLOW_STUDIO_E2E__!.flushRecoveryPersistence())

    await page.locator('.svelte-flow__node[data-id="body-0-003"]').focus()
    await page.keyboard.press('Enter')
    const prompt = page.getByRole('textbox', { name: /Nodes Item 4 Prompt Required/i })
    const beforeInspectorRevision = (await activeScopeSnapshot(page)).definitionRevision
    await resetEditorMetrics(page)
    const inspectorPhase = await beginLongTaskPhase(page, browserName)
    await prompt.fill('Updated through the bounded body Inspector.')
    await page.getByRole('button', { name: /Apply .* Item 4 Prompt$/ }).click()
    await expect
      .poll(async () => (await activeScopeSnapshot(page)).definitionRevision)
      .toBe(beforeInspectorRevision + 1)
    expect((await editorMetrics(page)).yamlTransactions).toBe(1)
    await expectNoLongTasks(page, browserName, 'body Inspector commit', inspectorPhase)
    await page.evaluate(() => window.__WORKFLOW_STUDIO_E2E__!.flushRecoveryPersistence())

    const boundedPanels = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('[data-scroll-frame]')].map((element) => {
        const bounds = element.getBoundingClientRect()
        return { top: bounds.top, bottom: bounds.bottom, height: bounds.height }
      }),
    )
    expect(boundedPanels.length).toBeGreaterThan(0)
    const viewportHeight = page.viewportSize()?.height ?? 0
    expect(boundedPanels.every(({ top, bottom, height }) => top >= 0 && bottom <= viewportHeight && height >= 0)).toBe(
      true,
    )

    const siblingBefore = await page.evaluate(() =>
      window.__WORKFLOW_STUDIO_E2E__!.persistedScopeLayout('loop-group:root-001'),
    )
    const bodyBefore = await page.evaluate(() =>
      window.__WORKFLOW_STUDIO_E2E__!.persistedScopeLayout('loop-group:root-000'),
    )
    await resetEditorMetrics(page)
    const bodyDragStart = await prepareNodeDrag(page, 'body-0-003')
    const bodyDragPhase = await beginLongTaskPhase(page, browserName)
    await performNodeDrag(
      page,
      bodyDragStart,
      { x: 20, y: 20 },
      async () => {
        const metrics = await editorMetrics(page)
        expectNoPointerAuthorityWork(metrics)
        expect(metrics.pointerMoves).toBeGreaterThan(0)
      },
      2,
    )
    await expectNoLongTasks(page, browserName, 'body node drag', bodyDragPhase)
    await expect
      .poll(async () =>
        page.evaluate(() => window.__WORKFLOW_STUDIO_E2E__!.persistedScopeLayout('loop-group:root-000').saveCount),
      )
      .toBe(bodyBefore.saveCount + 1)
    const bodyAfter = await page.evaluate(() =>
      window.__WORKFLOW_STUDIO_E2E__!.persistedScopeLayout('loop-group:root-000'),
    )
    expect(bodyAfter.scope?.nodePositions['body-0-003']).not.toEqual(bodyBefore.scope?.nodePositions['body-0-003'])
    expect((await page.evaluate(() => window.__WORKFLOW_STUDIO_E2E__!.persistedScopeLayout('root'))).scope).toEqual(
      rootBefore.scope,
    )
    expect(
      (await page.evaluate(() => window.__WORKFLOW_STUDIO_E2E__!.persistedScopeLayout('loop-group:root-001'))).scope,
    ).toEqual(siblingBefore.scope)

    const bodyViewportBefore = await page.evaluate(() =>
      window.__WORKFLOW_STUDIO_E2E__!.persistedScopeLayout('loop-group:root-000'),
    )
    await resetEditorMetrics(page)
    const bodyInteractionPhase = await beginLongTaskPhase(page, browserName)
    const bodyTransform = await flowViewport.getAttribute('style')
    await page.getByRole('button', { name: 'More canvas actions' }).click()
    await page.getByRole('menuitem', { name: 'Zoom In' }).click()
    await expect.poll(() => flowViewport.getAttribute('style')).not.toBe(bodyTransform)
    const bodyPanPoint = await pane.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      for (let y = Math.ceil(bounds.top); y < Math.floor(bounds.bottom); y += 4) {
        for (let x = Math.ceil(bounds.left); x < Math.floor(bounds.right); x += 4) {
          if (document.elementFromPoint(x, y) === element) return { x, y }
        }
      }
      return null
    })
    if (!bodyPanPoint) throw new Error('The body canvas has no truthful panning target.')
    await page.mouse.click(bodyPanPoint.x, bodyPanPoint.y)
    const beforeBodyPan = (await activeScopeSnapshot(page)).viewport
    await page.keyboard.down('Space')
    await page.mouse.move(bodyPanPoint.x, bodyPanPoint.y)
    await page.mouse.down()
    await page.mouse.move(bodyPanPoint.x + 24, bodyPanPoint.y + 18, { steps: 5 })
    expectNoPointerAuthorityWork(await editorMetrics(page))
    await page.mouse.up()
    await page.keyboard.up('Space')
    await expect.poll(async () => (await activeScopeSnapshot(page)).viewport).not.toEqual(beforeBodyPan)
    await expect
      .poll(async () =>
        page.evaluate(() => window.__WORKFLOW_STUDIO_E2E__!.persistedScopeLayout('loop-group:root-000').saveCount),
      )
      .toBe(bodyViewportBefore.saveCount + 1)
    expect((await editorMetrics(page)).layoutSaves).toBe(1)
    await expectNoLongTasks(page, browserName, 'body pan and zoom', bodyInteractionPhase)

    const beforeBack = await e2eSnapshot(page)
    await resetEditorMetrics(page)
    const backPhase = await beginLongTaskPhase(page, browserName)
    await page.getByRole('button', { name: 'Back to root workflow' }).click()
    await expectSingleMountedScope(page, 'root')
    expectNoPointerAuthorityWork(await editorMetrics(page))
    const afterBack = await e2eSnapshot(page)
    expect(afterBack.definitionText).toBe(beforeBack.definitionText)
    expect(afterBack.companionText).toBe(beforeBack.companionText)
    await expectNoLongTasks(page, browserName, 'Back to root', backPhase)

    await resetEditorMetrics(page)
    const reentryPhase = await beginLongTaskPhase(page, browserName)
    await page.locator('.svelte-flow__node[data-id="root-000"]').focus()
    await page.keyboard.press('Enter')
    await expectSingleMountedScope(page, 'loop-group:root-000')
    expectNoPointerAuthorityWork(await editorMetrics(page))
    const afterReentry = await e2eSnapshot(page)
    expect(afterReentry.definitionText).toBe(beforeBack.definitionText)
    expect(afterReentry.companionText).toBe(beforeBack.companionText)
    await expectNoLongTasks(page, browserName, 'body re-entry', reentryPhase)
    if (browserName === 'chromium')
      await page.evaluate(() =>
        (
          window as unknown as { __LOOP_GROUP_LONG_TASKS__: LongTaskState }
        ).__LOOP_GROUP_LONG_TASKS__.observer.disconnect(),
      )
  })
})
