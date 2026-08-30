import { fireEvent, render, screen } from '@testing-library/svelte'
import { tick } from 'svelte'
import { describe, expect, it, vi } from 'vitest'
import type { NodeKindDescriptor } from '$src/lib/contract/types'
import AddNodePicker from './AddNodePicker.svelte'

function descriptor(
  id: string,
  description: string,
  status: NodeKindDescriptor['status'] = 'supported',
  profiles: NodeKindDescriptor['applicability']['profiles'] = ['hermes-legacy'],
): NodeKindDescriptor {
  return {
    id,
    label: id[0]!.toUpperCase() + id.slice(1),
    description,
    field_path: `nodes[].${id}`,
    applicability: { profiles, documents: ['definition'] },
    widget: 'text',
    section: 'general',
    order: id === 'command' ? 1 : 2,
    status,
    examples: [],
    fields: [],
  }
}

const descriptors = [
  descriptor('command', 'Run an agent command'),
  descriptor('prompt', 'Ask an agent for a response'),
  descriptor('loop', 'Repeat bounded work', 'deferred'),
  descriptor('approval', 'Request approval', 'supported', ['archon-2026-07']),
]

describe('AddNodePicker', () => {
  it('searches contract descriptors and exposes descriptions and active-profile status', async () => {
    render(AddNodePicker, { descriptors, profile: 'hermes-legacy' })
    const search = screen.getByRole('combobox', { name: 'Search node kinds' })
    await tick()

    const dialog = screen.getByRole('dialog', { name: 'Add node' })
    expect(dialog.tagName).toBe('DIALOG')
    expect(dialog.querySelector('[data-modal-actions]')).not.toBeNull()
    expect(search).toHaveFocus()
    expect(screen.getByRole('option', { name: /Command.*supported/i })).toHaveTextContent('Run an agent command')
    expect(screen.getByRole('option', { name: /Loop.*deferred/i })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('option', { name: /Approval.*not available/i })).toHaveAttribute('aria-disabled', 'true')

    await fireEvent.input(search, { target: { value: 'response' } })
    expect(screen.getByRole('option', { name: /Prompt/ })).toBeVisible()
    expect(screen.queryByRole('option', { name: /Command/ })).not.toBeInTheDocument()
  })

  it('chooses only a supported descriptor from keyboard navigation and restores the opener', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const onChoose = vi.fn()
    render(AddNodePicker, { descriptors, profile: 'hermes-legacy', onChoose, opener })
    await tick()
    const search = screen.getByRole('combobox', { name: 'Search node kinds' })

    await fireEvent.keyDown(search, { key: 'ArrowDown' })
    await fireEvent.keyDown(search, { key: 'Enter' })

    expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ id: 'prompt' }))
    expect(opener).toHaveFocus()
    opener.remove()
  })

  it('keeps Tab focus in the picker and closes with Escape', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const onClose = vi.fn()
    render(AddNodePicker, { descriptors, profile: 'hermes-legacy', onClose, opener })
    await tick()
    const dialog = screen.getByRole('dialog', { name: 'Add node' })
    const search = screen.getByRole('combobox', { name: 'Search node kinds' })
    const close = screen.getByRole('button', { name: 'Close node picker' })

    close.focus()
    await fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(search).toHaveFocus()
    await fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    expect(opener).toHaveFocus()
    opener.remove()
  })
})
