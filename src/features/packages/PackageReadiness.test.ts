import { fireEvent, render, screen, within } from '@testing-library/svelte'
import { expect, it, vi } from 'vitest'
import type { PackageAnalysis } from '$src/lib/packages/readiness'
import PackageReadiness from './PackageReadiness.svelte'
const analysis: PackageAnalysis = {
  ready: false,
  findings: [],
  blockers: [
    {
      code: 'package_artifact_invalid',
      path: 'scripts/run.py',
      line: 3,
      column: 4,
      message: 'Unexpected token',
      severity: 'blocking',
    },
  ],
  advisories: [
    {
      code: 'runtime_unverified',
      path: '',
      message: 'Runtime availability is destination-dependent.',
      severity: 'advisory',
    },
  ],
  references: { references: [], inlineScripts: [], findings: [], unreferencedPaths: [], forNode: () => [] },
  executionSurface: { workflowPaths: ['main.yaml'], artifactPaths: ['scripts/run.py'], inlineScripts: [] },
}
it('keeps blocking findings separate from destination advisories and opens the named artifact', async () => {
  const open = vi.fn(),
    help = vi.fn()
  render(PackageReadiness, { analysis, onOpenArtifact: open, onHelp: help })
  expect(within(screen.getByRole('region', { name: 'Blocking findings' })).getByText('Unexpected token')).toBeVisible()
  expect(
    within(screen.getByRole('region', { name: 'Destination-dependent advisories' })).getByText(
      'Runtime availability is destination-dependent.',
    ),
  ).toBeVisible()
  await fireEvent.click(screen.getByRole('button', { name: 'Open scripts/run.py:3:4' }))
  expect(open).toHaveBeenCalledWith('scripts/run.py', 3, 4)
  await fireEvent.click(screen.getByRole('button', { name: 'Read readiness guidance' }))
  expect(help).toHaveBeenCalledWith('guide:package-readiness#blocking-findings')
})
it('does not present absent validation as ready', () => {
  render(PackageReadiness, { analysis: null })
  expect(screen.getByRole('status')).toHaveTextContent('Validation required')
})
