import { expect, test } from '@playwright/test'
import { openPackages, packageFiles, reviewLaptop, selectLaptop } from './package-support'
import { expectExactWorkbenchGeometry } from './support'

test('blocks missing packaged scripts while keeping destination advisories non-blocking', async ({ page }) => {
  await openPackages(page)
  await selectLaptop(page)
  await page.getByRole('button', { name: 'Validate Package', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Prepare Package', exact: true })).toBeEnabled()
  await expect(page.getByRole('region', { name: 'Package overview' })).toContainText('Destination-dependent advisories')
  const path = 'packages/laptop-diagnostic/workflows/laptop-diagnostic.yaml'
  const before = await packageFiles(page)
  await page.evaluate(({ path, text }) => window.__WORKFLOW_STUDIO_PACKAGE_E2E__!.change(path, text), {
    path,
    text: before[path]!.replaceAll('script: analyze-snapshot', 'script: missing-script'),
  })
  await selectLaptop(page)
  await page.getByRole('button', { name: 'Validate Package', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Prepare Package', exact: true })).toBeDisabled()
  await expect(page.getByRole('region', { name: 'Package overview' })).toContainText('missing-script')
})

test('rejects a shared-index change after the final diff was reviewed', async ({ page }) => {
  await openPackages(page)
  await reviewLaptop(page)
  await page.getByRole('button', { name: 'Prepare preview', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Commit local version', exact: true })).toBeEnabled()
  const path = '.well-known/hermes-workflows/index.json'
  const before = await packageFiles(page)
  await page.evaluate(({ path, text }) => window.__WORKFLOW_STUDIO_PACKAGE_E2E__!.change(path, text), {
    path,
    text: before[path]! + '\n',
  })
  await page.getByRole('button', { name: 'Commit local version', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Files changed after preview')
  await expect(page.getByRole('heading', { name: 'Prepared locally', exact: true })).not.toBeVisible()
  expect((await packageFiles(page))[path]).toBe(before[path]! + '\n')
})

test('requires the exact final diff before a local package commit', async ({ page }) => {
  // Includes review, two fresh captures, commit, narrow-layout checks and browser cleanup.
  test.setTimeout(30_000)
  await openPackages(page)
  await reviewLaptop(page)
  await expect(page.getByRole('button', { name: 'Commit local version', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Prepare preview', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Final local commit diff' })).toContainText(
    'scripts/analyze-snapshot.py',
  )
  expect(await page.evaluate(() => window.__WORKFLOW_STUDIO_PACKAGE_E2E__!.calls())).not.toContain(
    'gitCommitPackageVersion',
  )
  await page.getByRole('button', { name: 'Commit local version', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Prepared locally', exact: true })).toBeVisible()
  expect((await packageFiles(page))['.well-known/hermes-workflows/index.json']).toContain('1.0.1')
  await expect(page.getByRole('status', { name: 'Package preparation status' })).toContainText(
    'laptop-diagnostic 1.0.1',
  )
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await page.setViewportSize({ width: 512, height: 350 })
  await expectExactWorkbenchGeometry(page)
})

test('retains original generated metadata when preparation rolls back', async ({ page }) => {
  await openPackages(page)
  const before = await packageFiles(page)
  await reviewLaptop(page)
  await page.evaluate(() => window.__WORKFLOW_STUDIO_PACKAGE_E2E__!.failNextGeneratedWrite())
  await page.getByRole('button', { name: 'Prepare preview', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Injected generated-write failure')
  const after = await packageFiles(page)
  expect(after['packages/laptop-diagnostic/digests.json']).toBe(before['packages/laptop-diagnostic/digests.json'])
  expect(after['.well-known/hermes-workflows/index.json']).toBe(before['.well-known/hermes-workflows/index.json'])
  expect(await page.evaluate(() => window.__WORKFLOW_STUDIO_PACKAGE_E2E__!.calls())).not.toContain(
    'gitCommitPackageVersion',
  )
})
