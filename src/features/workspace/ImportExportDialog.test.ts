import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import ImportExportDialog from './ImportExportDialog.svelte'

describe('ImportExportDialog', () => {
  it('shows structural blockers and never offers export while blocked', () => {
    render(ImportExportDialog, { mode: 'export', blockingIssues: ['Dependency cycle'] })
    expect(screen.getByRole('alert')).toHaveTextContent('Dependency cycle')
    expect(screen.queryByRole('button', { name: 'Export YAML Pair' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toHaveAttribute('data-variant', 'secondary')
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
    expect(screen.getByRole('button', { name: 'Replace YAML Pair' })).toHaveAttribute('data-variant', 'danger')
    await fireEvent.click(screen.getByRole('button', { name: 'Replace YAML Pair' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('traps modal dismissal to Escape or the backdrop and restores the opener', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const onCancel = vi.fn()
    const view = render(ImportExportDialog, { mode: 'import', onCancel, opener })

    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(opener).toHaveFocus()

    const backdrop = view.container.querySelector('[data-dialog-backdrop]')
    expect(backdrop).not.toBeNull()
    await fireEvent.click(backdrop!)
    expect(onCancel).toHaveBeenCalledTimes(2)
    opener.remove()
  })

  it.each([
    ['import', 'Import YAML Pair'],
    ['export', 'Export YAML Pair'],
  ] as const)('restores the retained opener after successful %s confirmation', async (mode, label) => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const onConfirm = vi.fn(async () => undefined)
    render(ImportExportDialog, { mode, onConfirm, opener })

    expect(screen.getByRole('button', { name: label })).toHaveAttribute('data-variant', 'primary')
    await fireEvent.click(screen.getByRole('button', { name: label }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(opener).toHaveFocus()
    opener.remove()
  })
})
