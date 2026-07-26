import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import type { ValidationIssue } from '$src/lib/documents/types'
import ProblemsPanel from './ProblemsPanel.svelte'

const issues: readonly ValidationIssue[] = [
  {
    code: 'required',
    layer: 'contract',
    severity: 'error',
    blocking: true,
    message: 'A required node field is missing.',
    document: 'definition',
    path: '/tasks/build',
    nodeId: 'build',
  },
  {
    code: 'provider_missing',
    layer: 'operational',
    severity: 'warning',
    blocking: false,
    message: 'Provider is not configured.',
    document: 'companion',
    path: '/providers/release',
  },
]

describe('ProblemsPanel', () => {
  it('groups by file and layer, exposes blocking status, and announces only the summary politely', async () => {
    const execute = vi.fn(async () => undefined)
    const { container } = render(ProblemsPanel, {
      issues,
      paths: { definition: 'flows/release.yaml', companion: 'flows/release.hermes.yaml' },
      execute,
    })

    expect(screen.getByRole('heading', { name: 'Problems' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'flows/release.yaml' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Contract' })).toBeVisible()
    expect(screen.getByText('Blocks save and export')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Operational' })).toBeVisible()
    expect(screen.getByText('Advisory')).toBeVisible()
    expect(container.querySelectorAll('[aria-live="polite"]')).toHaveLength(1)
    expect(screen.getByText('2 problems, 1 blocking')).toHaveAttribute('aria-live', 'polite')

    await fireEvent.click(screen.getByRole('button', { name: /A required node field is missing/ }))
    expect(execute).toHaveBeenCalledWith('problems.focus.definition.required.build', {
      surface: 'global',
      canMutate: false,
      hasSelection: true,
    })
  })
})
