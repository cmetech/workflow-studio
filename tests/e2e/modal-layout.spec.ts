import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  EXACT_GEOMETRIES,
  e2eSnapshot,
  expectExactWorkbenchGeometry,
  openSeededPair,
  replaceDefinitionYaml,
  type ExactGeometry,
} from './support'

const DIRTY_YAML = `name: Release demo
description: Unsaved modal conflict fixture.
nodes:
  - id: prepare
    prompt: Prepare the release notes.
  - id: publish
    command: /publish
    depends_on: [prepare]
`

async function assertRealResponsiveModal(
  page: Page,
  dialog: Locator,
  reachableAction: Locator,
  geometry: ExactGeometry,
  options: { injectOverflowFixture?: boolean } = {},
): Promise<void> {
  await expect(dialog).toBeVisible()
  expect(await dialog.evaluate((node) => node.matches(':modal'))).toBe(true)

  const backgroundControl = page.getByRole('button', { name: 'Explorer', exact: true })
  expect(
    await backgroundControl.evaluate((element) => {
      element.focus()
      return document.activeElement === element
    }),
  ).toBe(false)

  await page.setViewportSize(geometry.viewport)
  const body = dialog.locator('[data-modal-body]')
  const footer = dialog.locator('[data-modal-actions]')
  await expect(body).toBeVisible()
  if (options.injectOverflowFixture !== false) {
    await body.evaluate((element) => {
      const fixture = document.createElement('div')
      fixture.dataset.modalOverflowFixture = 'true'
      for (let index = 0; index < 24; index += 1) {
        const line = document.createElement('p')
        line.textContent = `Long modal reflow fixture ${index + 1}: ${'content-aware-workbench-'.repeat(6)}`
        fixture.append(line)
      }
      element.append(fixture)
    })
  }

  const before = await dialog.evaluate((element) => {
    const modalBody = element.querySelector<HTMLElement>('[data-modal-body]')!
    const shell = element.querySelector<HTMLElement>('.modal-shell')!
    const modalFooter = element.querySelector<HTMLElement>('[data-modal-actions]')
    return {
      windowX: window.scrollX,
      windowY: window.scrollY,
      documentScrollTop: document.documentElement.scrollTop,
      pageBodyScrollTop: document.body.scrollTop,
      dialogScrollTop: element.scrollTop,
      shellScrollTop: shell.scrollTop,
      footerScrollTop: modalFooter?.scrollTop ?? 0,
      bodyScrollTop: modalBody.scrollTop,
      bodyScrollHeight: modalBody.scrollHeight,
      bodyClientHeight: modalBody.clientHeight,
    }
  })
  expect(before.bodyScrollHeight).toBeGreaterThan(before.bodyClientHeight)
  expect(before).toMatchObject({
    windowX: 0,
    windowY: 0,
    documentScrollTop: 0,
    pageBodyScrollTop: 0,
    dialogScrollTop: 0,
    shellScrollTop: 0,
    footerScrollTop: 0,
    bodyScrollTop: 0,
  })
  await expect(reachableAction).toBeVisible()
  const [actionBoxBefore, viewportHeight] = await Promise.all([
    reachableAction.boundingBox(),
    page.evaluate(() => innerHeight),
  ])
  expect(actionBoxBefore).not.toBeNull()
  expect(actionBoxBefore!.y).toBeGreaterThanOrEqual(0)
  expect(actionBoxBefore!.y + actionBoxBefore!.height).toBeLessThanOrEqual(viewportHeight)

  await expect(footer).toHaveCount(1)
  await expect(footer).toBeVisible()
  const footerBoxBefore = await footer.boundingBox()
  expect(footerBoxBefore).not.toBeNull()
  expect(footerBoxBefore!.y + footerBoxBefore!.height).toBeLessThanOrEqual(viewportHeight)

  await body.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  const after = await dialog.evaluate((element) => {
    const modalBody = element.querySelector<HTMLElement>('[data-modal-body]')!
    const shell = element.querySelector<HTMLElement>('.modal-shell')!
    const modalFooter = element.querySelector<HTMLElement>('[data-modal-actions]')
    return {
      windowX: window.scrollX,
      windowY: window.scrollY,
      documentScrollTop: document.documentElement.scrollTop,
      pageBodyScrollTop: document.body.scrollTop,
      dialogScrollTop: element.scrollTop,
      shellScrollTop: shell.scrollTop,
      footerScrollTop: modalFooter?.scrollTop ?? 0,
      bodyScrollTop: modalBody.scrollTop,
    }
  })
  expect(after.bodyScrollTop).toBeGreaterThan(0)
  expect(after).toMatchObject({
    windowX: before.windowX,
    windowY: before.windowY,
    documentScrollTop: before.documentScrollTop,
    pageBodyScrollTop: before.pageBodyScrollTop,
    dialogScrollTop: before.dialogScrollTop,
    shellScrollTop: before.shellScrollTop,
    footerScrollTop: before.footerScrollTop,
  })

  await expect(reachableAction).toBeVisible()
  const actionBoxAfter = await reachableAction.boundingBox()
  expect(actionBoxAfter).not.toBeNull()
  expect(actionBoxAfter!.y).toBeGreaterThanOrEqual(0)
  expect(actionBoxAfter!.y + actionBoxAfter!.height).toBeLessThanOrEqual(viewportHeight)

  await expect(footer).toBeVisible()
  const footerBoxAfter = await footer.boundingBox()
  expect(footerBoxAfter).not.toBeNull()
  expect(footerBoxAfter!.y).toBeCloseTo(footerBoxBefore!.y, 0)
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await expectExactWorkbenchGeometry(page)
}

function modalAtEveryExactGeometry(title: string, body: (page: Page, geometry: ExactGeometry) => Promise<void>): void {
  for (const geometry of EXACT_GEOMETRIES)
    test(`${title} at ${geometry.label}`, async ({ page }) => body(page, geometry))
}

modalAtEveryExactGeometry('New Workflow is a top-layer modal with reachable actions', async (page, geometry) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'New Workflow', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: 'New Workflow' })
  await assertRealResponsiveModal(page, dialog, dialog.getByRole('button', { name: 'Create Workflow' }), geometry)
})

modalAtEveryExactGeometry('Import is a top-layer modal with reachable actions', async (page, geometry) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Folder' }).first().click()
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Import workflow' })
  await assertRealResponsiveModal(page, dialog, dialog.getByRole('button', { name: 'Import YAML Pair' }), geometry)
})

modalAtEveryExactGeometry(
  'Quick Open is a top-layer modal with contained focus and scrollable results',
  async (page, geometry) => {
    await openSeededPair(page)
    await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+P`)
    const dialog = page.getByRole('dialog', { name: 'Quick Open' })
    await assertRealResponsiveModal(page, dialog, dialog.getByRole('button', { name: 'Close Quick Open' }), geometry)
  },
)

modalAtEveryExactGeometry(
  'External Change is a top-layer modal with persistent conflict actions',
  async (page, geometry) => {
    await openSeededPair(page)
    await replaceDefinitionYaml(page, DIRTY_YAML)
    await expect.poll(async () => (await e2eSnapshot(page)).definitionText).toBe(DIRTY_YAML)
    await page.evaluate(async () => window.__WORKFLOW_STUDIO_E2E__!.triggerExternalChange())
    const dialog = page.getByRole('dialog', { name: 'Workflow changed on disk' })
    await assertRealResponsiveModal(page, dialog, dialog.getByRole('button', { name: 'Compare' }), geometry)
  },
)

modalAtEveryExactGeometry('Recovery is a top-layer modal with persistent draft actions', async (page, geometry) => {
  await openSeededPair(page, '?scenario=recovery-modal')
  const dialog = page.getByRole('dialog', { name: 'Recover unsaved workflow?' })
  await assertRealResponsiveModal(page, dialog, dialog.getByRole('button', { name: 'Recover' }), geometry)
})

modalAtEveryExactGeometry(
  'Blocked Export is a top-layer modal with a reachable close action',
  async (page, geometry) => {
    await page.goto('/?scenario=export-blocking-modal')
    await page.getByRole('button', { name: 'Open Folder' }).first().click()
    const pair = page.getByRole('treeitem', { name: /release-demo\.yaml, paired workflow/i })
    await pair.click()
    await expect(page.getByRole('button', { name: /depends on missing node.*Blocks save and export/i })).toBeVisible()
    await pair.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Export' }).click()
    const dialog = page.getByRole('dialog', { name: 'Export workflow' })
    await expect(dialog).toContainText('Resolve structural issues before export.')
    await assertRealResponsiveModal(page, dialog, dialog.getByRole('button', { name: 'Close' }), geometry)
  },
)

modalAtEveryExactGeometry(
  'Export Collision is a top-layer modal with persistent replacement actions',
  async (page, geometry) => {
    await openSeededPair(page, '?scenario=export-collision-modal')
    await page.getByRole('treeitem', { name: /release-demo\.yaml, paired workflow/i }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Export' }).click()
    const dialog = page.getByRole('dialog', { name: 'Export workflow' })
    await expect(dialog).toContainText('These exact files already exist:')
    await assertRealResponsiveModal(page, dialog, dialog.getByRole('button', { name: 'Replace YAML Pair' }), geometry)
  },
)

modalAtEveryExactGeometry('Add Node is a top-layer modal with reachable contract choices', async (page, geometry) => {
  await openSeededPair(page)
  await page.getByRole('button', { name: 'Add Node' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add node' })
  await assertRealResponsiveModal(page, dialog, dialog.getByRole('button', { name: 'Close node picker' }), geometry)
})

test('Add Node Escape is owned by the modal before the compact workspace drawer', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Folder' }).first().click()
  await page.getByRole('button', { name: 'Explorer', exact: true }).click()
  await page.getByRole('treeitem', { name: /release-demo\.yaml, paired workflow/i }).click()
  await expect(page.getByRole('region', { name: 'Workflow graph' })).toBeVisible()
  const nodesActivity = page.getByRole('button', { name: 'Nodes', exact: true })
  await nodesActivity.click()
  const workspacePanel = page.locator('aside[aria-label="Workspace panel"]')
  await expect(workspacePanel).not.toHaveAttribute('inert')

  const addNodeButton = page.getByRole('button', { name: 'Add Node', exact: true })
  await addNodeButton.focus()
  await addNodeButton.evaluate((element) => (element as HTMLButtonElement).click())
  const dialog = page.getByRole('dialog', { name: 'Add node' })
  await expect(dialog).toBeVisible()
  await dialog.evaluate((element) => {
    element.addEventListener(
      'keydown',
      () => {
        document.body.dataset.modalEscapeOwned = 'true'
      },
      { capture: true, once: true },
    )
  })

  await page.keyboard.press('Escape')

  await expect(dialog).toBeHidden()
  await expect(page.locator('body')).toHaveAttribute('data-modal-escape-owned', 'true')
  await expect(workspacePanel).not.toHaveAttribute('inert')
  await expect(page.locator('.graph-canvas')).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(workspacePanel).toHaveAttribute('inert', '')
  await expect(nodesActivity).toBeFocused()
})

modalAtEveryExactGeometry('Delete is a top-layer modal with persistent impact actions', async (page, geometry) => {
  await openSeededPair(page)
  const prepare = page.getByRole('group', { name: 'prompt node prepare', exact: true })
  await prepare.focus()
  await prepare.press('Enter')
  await page.getByRole('button', { name: 'More canvas actions' }).click()
  await page.getByRole('menuitem', { name: 'Delete Selection' }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete selected nodes' })
  await assertRealResponsiveModal(page, dialog, dialog.getByRole('button', { name: 'Delete nodes' }), geometry)
})

modalAtEveryExactGeometry(
  'Command Palette is a top-layer modal with reachable search results',
  async (page, geometry) => {
    await openSeededPair(page)
    await page.keyboard.press('F1')
    const dialog = page.getByRole('dialog', { name: 'Command palette' })
    await assertRealResponsiveModal(
      page,
      dialog,
      dialog.getByRole('button', { name: 'Close command palette' }),
      geometry,
    )
  },
)

modalAtEveryExactGeometry(
  'Create Version is a top-layer modal with a reachable action after long content',
  async (page, geometry) => {
    await openSeededPair(page, '?scenario=long-create-version')
    await page.getByRole('button', { name: 'Git', exact: true }).click()
    await page
      .getByRole('button', { name: 'Create version…' })
      .evaluate((element) => (element as HTMLButtonElement).click())
    const dialog = page.getByRole('dialog', { name: 'Create local version' })
    const findingsHeading = dialog.getByRole('heading', { name: 'Warnings and advisories' })
    await expect(findingsHeading).toBeVisible()
    expect(await findingsHeading.locator('+ ul li').count()).toBeGreaterThanOrEqual(24)
    await expect(dialog.getByText('diff --git a/workflows/release-demo.yaml', { exact: false })).toBeVisible()
    await assertRealResponsiveModal(page, dialog, dialog.getByRole('button', { name: 'Create version' }), geometry, {
      injectOverflowFixture: false,
    })
  },
)

modalAtEveryExactGeometry(
  'Keyboard Shortcuts is a top-layer modal with a persistent close action',
  async (page, geometry) => {
    await openSeededPair(page)
    await page.keyboard.press('F1')
    await page.getByRole('combobox', { name: 'Search commands' }).fill('Keyboard Shortcuts')
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await assertRealResponsiveModal(
      page,
      dialog,
      dialog.getByRole('button', { name: 'Close keyboard shortcuts' }),
      geometry,
    )
  },
)

modalAtEveryExactGeometry(
  'Brand Preview is a top-layer modal with persistent preview actions',
  async (page, geometry) => {
    await openSeededPair(page)
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page
      .getByRole('button', { name: 'Import brand pack' })
      .evaluate((element) => (element as HTMLButtonElement).click())
    await page
      .getByRole('button', { name: 'Import brand pack' })
      .evaluate((element) => (element as HTMLButtonElement).click())
    await page
      .getByRole('button', { name: 'Preview Northstar Studio' })
      .evaluate((element) => (element as HTMLButtonElement).click())
    const dialog = page.getByRole('dialog', { name: 'Preview Northstar Studio' })
    await assertRealResponsiveModal(
      page,
      dialog,
      dialog.getByRole('button', { name: 'Activate Northstar Studio' }),
      geometry,
    )
  },
)

modalAtEveryExactGeometry(
  'Active Brand Removal is a top-layer modal with persistent revert actions',
  async (page, geometry) => {
    await page.goto('/?scenario=active-brand-removal-modal')
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Remove Northstar Studio' }).click()
    const dialog = page.getByRole('dialog', { name: 'Revert active brand' })
    await assertRealResponsiveModal(
      page,
      dialog,
      dialog.getByRole('button', { name: 'Revert to LOOP24 and remove' }),
      geometry,
    )
  },
)

modalAtEveryExactGeometry(
  'Initialize Repository is a top-layer modal with a persistent initialize action',
  async (page, geometry) => {
    await openSeededPair(page, '?scenario=initialize-repository-modal')
    await page.getByRole('button', { name: 'Git', exact: true }).click()
    await page.getByRole('button', { name: 'Initialize Git repository' }).click()
    const dialog = page.getByRole('dialog', { name: 'Initialize repository' })
    await assertRealResponsiveModal(
      page,
      dialog,
      dialog.getByRole('button', { name: 'Initialize repository' }),
      geometry,
    )
  },
)

modalAtEveryExactGeometry(
  'Repository Identity is a top-layer modal with a persistent save action',
  async (page, geometry) => {
    await openSeededPair(page, '?scenario=repository-identity-modal')
    await page.getByRole('button', { name: 'Git', exact: true }).click()
    await page.getByRole('button', { name: 'Configure identity…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Repository identity' })
    await assertRealResponsiveModal(
      page,
      dialog,
      dialog.getByRole('button', { name: 'Save repository identity' }),
      geometry,
    )
  },
)

modalAtEveryExactGeometry(
  'Setup is a top-layer modal with bounded progress content and persistent actions',
  async (page, geometry) => {
    await page.goto('/?scenario=setup-update')
    const dialog = page.getByRole('dialog', { name: 'Setting up LOOP24 Workflow Studio' })
    await expect(dialog.getByLabel('Setup output')).toHaveValue(/deterministic-setup-log-12/)
    await expect(dialog).toContainText('deeply nested offline resource verification path')
    await assertRealResponsiveModal(page, dialog, dialog.getByRole('button', { name: 'Retry' }), geometry)
  },
)

modalAtEveryExactGeometry(
  'Update is a top-layer modal with bounded logs and persistent actions',
  async (page, geometry) => {
    await page.goto('/?scenario=setup-update')
    await page
      .getByRole('dialog', { name: 'Setting up LOOP24 Workflow Studio' })
      .getByRole('button', { name: 'Retry' })
      .click()
    const dialog = page.getByRole('dialog', { name: 'Update Workflow Studio' })
    await expect(dialog.getByLabel('Update output')).toHaveValue(/deterministic-update-log-12/)
    await expect(dialog).toContainText('signed updater verification message')
    await assertRealResponsiveModal(page, dialog, dialog.getByRole('button', { name: 'Retry' }), geometry)
  },
)
