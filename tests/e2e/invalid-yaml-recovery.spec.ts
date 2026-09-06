import { expect, test } from '@playwright/test'
import { e2eSnapshot, openSeededPair, replaceDefinitionYaml } from './support'

const VALID_RECOVERY = `name: Recovered release
description: The valid projection returns after syntax recovery.
nodes:
  - id: recovered
    prompt: Continue safely.
`

const SAVED_YAML = `name: Save and revert fixture
description: Preserve the exact saved workflow text.
nodes:
  - id: prepare
    prompt: Prepare the release notes.
  - id: publish
    command: /publish
    depends_on: [prepare]
`

const RECOVERY_YAML = SAVED_YAML.replace(
  'description: Preserve the exact saved workflow text.',
  'description: Restore this exact recovery draft before reverting.',
)

test('keeps the last graph read-only, blocks save, and recovers from invalid YAML', async ({ page }) => {
  await openSeededPair(page)
  await replaceDefinitionYaml(page, 'name: [broken')
  await page.getByRole('button', { name: 'Split', exact: true }).click()

  await expect(page.getByText(/Last valid graph shown read-only/i)).toBeVisible()
  await expect(page.getByRole('status', { name: 'Document save status' })).toHaveText('Unsaved changes')
  await expect(page.getByRole('button', { name: 'Save workflow' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Revert to saved YAML' })).toBeEnabled()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+S' : 'Control+S')
  await expect(page.getByRole('alert').filter({ hasText: /Save blocked/i })).toBeVisible()

  await replaceDefinitionYaml(page, VALID_RECOVERY)
  await page.getByRole('button', { name: 'Split', exact: true }).click()
  await expect(page.getByText(/Last valid graph shown read-only/i)).toBeHidden()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+S' : 'Control+S')
  await expect.poll(async () => (await e2eSnapshot(page)).definitionText).toBe(VALID_RECOVERY)
})

test('reverts exact recovered text and delegates a changed disk to the conflict dialog', async ({ page }) => {
  await openSeededPair(page, { scenario: 'document-controls-recovery' })
  const recovery = page.getByRole('dialog', { name: 'Recover unsaved workflow?' })
  await recovery.getByRole('button', { name: 'Recover' }).click()

  await expect(page.getByRole('status', { name: 'Document save status' })).toHaveText('Unsaved changes')
  await expect.poll(async () => (await e2eSnapshot(page)).definitionText).toBe(RECOVERY_YAML)
  await page.getByRole('button', { name: 'Revert to saved YAML' }).click()
  const confirmation = page.getByRole('dialog', { name: 'Revert to saved YAML?' })
  await expect(confirmation.getByText(/reload the exact version currently saved on disk/i)).toBeVisible()
  await confirmation.getByRole('button', { name: 'Revert changes' }).click()

  await expect.poll(async () => (await e2eSnapshot(page)).definitionText).toBe(SAVED_YAML)
  await expect(page.getByRole('status', { name: 'Document save status' })).toHaveText('Saved')

  const localText = SAVED_YAML.replace(
    'description: Preserve the exact saved workflow text.',
    'description: Keep this local edit during conflict resolution.',
  )
  await replaceDefinitionYaml(page, localText)
  await expect(page.getByRole('status', { name: 'Document save status' })).toHaveText('Unsaved changes')
  await page.evaluate(() => window.__WORKFLOW_STUDIO_E2E__!.stageExternalDefinitionChange())
  await page.getByRole('button', { name: 'Revert to saved YAML' }).click()
  await page
    .getByRole('dialog', { name: 'Revert to saved YAML?' })
    .getByRole('button', { name: 'Revert changes' })
    .click()

  await expect(page.getByRole('dialog', { name: 'Workflow changed on disk' })).toBeVisible()
  await expect.poll(async () => (await e2eSnapshot(page)).definitionText).toBe(localText)
})
