import { fireEvent, render, screen } from '@testing-library/svelte'
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
