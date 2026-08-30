import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { tick } from 'svelte'
import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceEntry } from '$src/lib/workspace/types'
import QuickOpen from './QuickOpen.svelte'

const entries: readonly WorkspaceEntry[] = [
  {
    kind: 'workflow',
    id: 'one',
    name: 'Release.yaml',
    relativePath: 'flows/Release.yaml',
    definitionPath: 'flows/Release.yaml',
    companionPath: null,
    state: 'legacy',
    readOnly: false,
  },
  {
    kind: 'workflow',
    id: 'two',
    name: 'Deploy.yaml',
    relativePath: 'ops/Deploy.yaml',
    definitionPath: 'ops/Deploy.yaml',
    companionPath: null,
    state: 'legacy',
    readOnly: false,
  },
  {
    kind: 'orphan-companion',
    id: 'orphan',
    name: 'Orphan.hermes.yaml',
    relativePath: 'ops/Orphan.hermes.yaml',
    companionPath: 'ops/Orphan.hermes.yaml',
    state: 'orphan',
    readOnly: false,
  },
]

describe('QuickOpen', () => {
  it('keeps forward and reverse Tab focus within the overlay', async () => {
    render(QuickOpen, { entries })
    await tick()
    const dialog = screen.getByRole('dialog', { name: 'Quick Open' })
    const search = screen.getByRole('combobox', { name: 'Quick Open workflows' })
    const lastResult = screen.getAllByRole('option').at(-1)!

    expect(dialog.tagName).toBe('DIALOG')
    expect(dialog.querySelector('[data-modal-body]')).not.toBeNull()
    expect(search).toHaveFocus()
    lastResult.focus()
    await fireEvent.keyDown(lastResult, { key: 'Tab' })
    expect(search).toHaveFocus()
    await fireEvent.keyDown(search, { key: 'Tab', shiftKey: true })
    expect(lastResult).toHaveFocus()
  })

  it('captures and restores the focused opener when Escape closes the overlay', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const onClose = vi.fn()
    render(QuickOpen, { entries, onClose })
    await tick()

    await fireEvent.keyDown(screen.getByRole('combobox', { name: 'Quick Open workflows' }), { key: 'Escape' })

    expect(onClose).toHaveBeenCalledOnce()
    expect(opener).toHaveFocus()
    opener.remove()
  })

  it('restores an explicit opener after a workflow is opened successfully', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const onOpen = vi.fn().mockResolvedValue(undefined)
    render(QuickOpen, { entries, onOpen, opener })
    await tick()

    await fireEvent.keyDown(screen.getByRole('combobox', { name: 'Quick Open workflows' }), { key: 'Enter' })

    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ definitionPath: 'flows/Release.yaml' }))
    await vi.waitFor(() => expect(opener).toHaveFocus())
    opener.remove()
  })

  it('restores the retained opener when the overlay unmounts', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const view = render(QuickOpen, { entries, opener })
    await tick()

    view.unmount()

    await waitFor(() => expect(opener).toHaveFocus())
    opener.remove()
  })

  it('filters path metadata without a content reader and opens the selected result from the keyboard', async () => {
    const onOpen = vi.fn()
    render(QuickOpen, { entries, onOpen })
    const search = screen.getByRole('combobox', { name: 'Quick Open workflows' })
    await fireEvent.input(search, { target: { value: 'ops' } })
    expect(screen.queryByRole('option', { name: /Release/ })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Deploy/ })).toBeVisible()
    await fireEvent.keyDown(search, { key: 'Enter' })
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ definitionPath: 'ops/Deploy.yaml' }))
  })

  it('lists workflow pairs only and exposes the active option with aria-activedescendant', async () => {
    render(QuickOpen, { entries })
    const search = screen.getByRole('combobox', { name: 'Quick Open workflows' })
    expect(screen.queryByRole('option', { name: /Orphan/ })).not.toBeInTheDocument()
    const first = screen.getAllByRole('option')[0]
    expect(first).toHaveAttribute('id')
    expect(search).toHaveAttribute('aria-activedescendant', first?.id)
    await fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(search).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[1]?.id)
  })
})
