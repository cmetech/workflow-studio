import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { expect, it, vi } from 'vitest'
import type { PackageAnalysis } from '$src/lib/packages/readiness'
import type { PreparePackageView } from './prepare-package-view'
import PreparePackageDialog from './PreparePackageDialog.svelte'

const analysis: PackageAnalysis = {
  ready: true,
  findings: [],
  blockers: [],
  advisories: [],
  references: { references: [], inlineScripts: [], findings: [], unreferencedPaths: [], forNode: () => [] },
  executionSurface: { workflowPaths: [], artifactPaths: [], inlineScripts: [] },
}
const versionView: PreparePackageView = {
  step: 'version',
  analysis,
  changes: [],
  includedPaths: ['workflow-package.json'],
  trustChanges: [],
  suggestedVersion: '1.0.1',
  suggestionReasons: ['Supporting resource changed'],
}
const props = () => ({
  packageId: 'sample',
  currentVersion: '1.0.0',
  onValidate: vi.fn(),
  onAcceptReview: vi.fn(),
  onPrepare: vi.fn(),
  onCommit: vi.fn(),
  onCancel: vi.fn(),
  onHelp: vi.fn(),
})

it('requires validation and leaves step transitions to the controller', async () => {
  const callbacks = props()
  render(PreparePackageDialog, { ...callbacks, view: { step: 'validate' } })
  await fireEvent.click(screen.getByRole('button', { name: 'Validate package' }))
  expect(callbacks.onValidate).toHaveBeenCalledOnce()
  expect(screen.queryByLabelText('Version')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Prepare local version' })).toBeNull()
})

it('preserves the reviewed version and message after a rejected local commit', async () => {
  const callbacks = props()
  callbacks.onCommit.mockRejectedValue(new Error('HEAD changed. Review again.'))
  const rendered = render(PreparePackageDialog, { ...callbacks, view: versionView })
  await fireEvent.input(screen.getByLabelText('Version'), { target: { value: '2.0.0' } })
  await fireEvent.input(screen.getByLabelText('Commit message'), { target: { value: 'Prepare sample 2.0.0' } })
  await rendered.rerender({
    ...callbacks,
    view: {
      ...versionView,
      finalPreview: { diff: '+version: 2.0.0', version: '2.0.0', message: 'Prepare sample 2.0.0' },
    },
  })
  await fireEvent.click(screen.getByRole('button', { name: 'Commit local version' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('HEAD changed'))
  expect(callbacks.onCommit).toHaveBeenCalledWith({ version: '2.0.0', message: 'Prepare sample 2.0.0' })
  expect(screen.getByLabelText('Version')).toHaveValue('2.0.0')
  expect(screen.getByLabelText('Commit message')).toHaveValue('Prepare sample 2.0.0')
  expect(screen.queryByText('Prepared locally')).toBeNull()
})

it('prevents duplicate submission and cancellation during an in-flight commit', async () => {
  const callbacks = props()
  let finish!: () => void
  callbacks.onCommit.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  render(PreparePackageDialog, {
    ...callbacks,
    view: {
      ...versionView,
      finalPreview: { diff: '+version: 1.0.1', version: '1.0.1', message: 'Prepare sample 1.0.1' },
    },
  })
  await fireEvent.click(screen.getByRole('button', { name: 'Commit local version' }))
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  expect(callbacks.onCancel).not.toHaveBeenCalled()
  expect(callbacks.onCommit).toHaveBeenCalledOnce()
  finish()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled())
})

it('blocks review acceptance when analysis has blocking findings', () => {
  render(PreparePackageDialog, {
    ...props(),
    view: { ...versionView, step: 'review', analysis: { ...analysis, ready: false } },
  })
  expect(screen.getByRole('button', { name: 'Review version and commit' })).toBeDisabled()
})

it('reports only local preparation and opens the local handoff guide', async () => {
  const callbacks = props()
  render(PreparePackageDialog, {
    ...callbacks,
    view: { step: 'complete', version: '1.0.1', commitOid: 'abc123', includedPaths: ['workflow-package.json'] },
  })
  expect(screen.getByText('Prepared locally')).toBeVisible()
  expect(screen.getByText('abc123')).toBeVisible()
  expect(screen.queryByText(/^Published/)).toBeNull()
  await fireEvent.click(screen.getByRole('button', { name: 'Read Git handoff guidance' }))
  expect(callbacks.onHelp).toHaveBeenCalledWith('guide:publishing-packages-with-git')
})

it('requires an explicit final preview and invalidates commit whenever either draft changes', async () => {
  const callbacks = props()
  const rendered = render(PreparePackageDialog, { ...callbacks, view: versionView })
  expect(screen.getByRole('button', { name: 'Commit local version' })).toBeDisabled()
  await fireEvent.click(screen.getByRole('button', { name: 'Prepare preview' }))
  expect(callbacks.onPrepare).toHaveBeenCalledWith({ version: '1.0.1', message: 'Prepare sample 1.0.1' })
  expect(callbacks.onCommit).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Commit local version' })).toBeDisabled()
  await rendered.rerender({
    ...callbacks,
    view: {
      ...versionView,
      finalPreview: { version: '1.0.1', message: 'Prepare sample 1.0.1', diff: '+<script>exact diff</script>' },
    },
  })
  expect(screen.getByText('+<script>exact diff</script>')).toBeVisible()
  expect(document.querySelector('script')).toBeNull()
  expect(screen.getByRole('button', { name: 'Commit local version' })).toBeEnabled()
  await fireEvent.input(screen.getByLabelText('Version'), { target: { value: '1.0.2' } })
  expect(screen.getByRole('button', { name: 'Commit local version' })).toBeDisabled()
  await fireEvent.input(screen.getByLabelText('Version'), { target: { value: '1.0.1' } })
  await fireEvent.input(screen.getByLabelText('Commit message'), { target: { value: 'Different message' } })
  expect(screen.getByRole('button', { name: 'Commit local version' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Prepare preview' })).toBeEnabled()
})
