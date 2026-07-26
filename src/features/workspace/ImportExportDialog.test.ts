import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import ImportExportDialog from './ImportExportDialog.svelte'

describe('ImportExportDialog', () => {
  it('shows structural blockers and never offers export while blocked', () => {
    render(ImportExportDialog, { mode: 'export', blockingIssues: ['Dependency cycle'] })
    expect(screen.getByRole('alert')).toHaveTextContent('Dependency cycle')
    expect(screen.queryByRole('button', { name: 'Export YAML Pair' })).not.toBeInTheDocument()
  })

  it('names the exact YAML pair in collision confirmation and excludes application data', async () => {
    const onConfirm = vi.fn()
    render(ImportExportDialog, {
      mode: 'export',
      paths: ['/exports/flow.yaml', '/exports/flow.hermes.yaml'],
      collision: true,
      onConfirm,
    })
    expect(screen.getByText('/exports/flow.yaml')).toBeVisible()
    expect(screen.getByText('/exports/flow.hermes.yaml')).toBeVisible()
    expect(screen.queryByText(/layout|settings|contract|brand/i)).not.toBeInTheDocument()
    await fireEvent.click(screen.getByRole('button', { name: 'Replace YAML Pair' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})
