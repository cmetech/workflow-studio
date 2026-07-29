import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import type { FormField } from '$src/lib/forms/types'
import Inspector from './Inspector.svelte'

const fields: readonly FormField[] = [
  {
    id: 'prompt.node.id',
    label: 'Node ID',
    description: 'Unique node identifier.',
    fieldPath: 'nodes[].id',
    pathTemplate: ['nodes', '$node', 'id'],
    document: 'definition',
    nodeKinds: ['prompt'],
    widget: 'text',
    section: 'General',
    order: 1,
    status: 'supported',
    examples: ['prepare'],
    schema: { type: 'string' },
    required: true,
    hasDefault: false,
    constraints: {},
  },
  {
    id: 'prompt.node.when',
    label: 'When',
    description: 'Condition expression.',
    fieldPath: 'nodes[].when',
    pathTemplate: ['nodes', '$node', 'when'],
    document: 'definition',
    nodeKinds: ['prompt'],
    widget: 'textarea',
    section: 'Execution',
    order: 2,
    status: 'supported',
    examples: ["$prepare.output.status == 'ready'"],
    schema: { type: 'string' },
    required: false,
    hasDefault: false,
    constraints: {},
  },
]

describe('Inspector', () => {
  it('renders accessible roving tabs and field semantics from contract descriptors', async () => {
    render(Inspector, { fields, values: { 'prompt.node.id': 'review' }, selectionLabel: 'review' })

    const tabs = screen.getAllByRole('tab')
    expect(tabs.map(({ textContent }) => textContent)).toEqual(['General', 'Execution', 'Advanced', 'Docs'])
    expect(screen.getByRole('textbox', { name: /node id.*required/i })).toHaveAttribute('aria-required', 'true')
    expect(screen.getByText('Unique node identifier.')).toHaveAttribute('id')

    tabs[0]!.focus()
    await fireEvent.keyDown(tabs[0]!, { key: 'End' })
    expect(tabs[3]).toHaveFocus()
    expect(tabs[3]).toHaveAttribute('aria-selected', 'true')
    await fireEvent.keyDown(tabs[3]!, { key: 'Home' })
    expect(tabs[0]).toHaveFocus()
  })

  it('does not commit a text draft on blur or selection change and commits only explicit Apply', async () => {
    const onCommit = vi.fn()
    const { rerender } = render(Inspector, {
      fields,
      values: { 'prompt.node.id': 'review' },
      selectionLabel: 'review',
      bindingIdentity: 'workflow:0:0:review',
      onCommit,
    })
    const input = screen.getByRole('textbox', { name: /node id.*required/i })

    await fireEvent.input(input, { target: { value: 'renamed' } })
    await fireEvent.blur(input)
    expect(onCommit).not.toHaveBeenCalled()

    await rerender({
      fields,
      values: { 'prompt.node.id': 'other' },
      selectionLabel: 'other',
      bindingIdentity: 'workflow:0:0:other',
      onCommit,
    })
    expect(onCommit).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: /node id.*required/i })).toHaveValue('other')

    await fireEvent.input(screen.getByRole('textbox', { name: /node id.*required/i }), {
      target: { value: 'other-renamed' },
    })
    await fireEvent.click(screen.getByRole('button', { name: /apply node id/i }))
    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ field: fields[0], value: 'other-renamed' }))
  })

  it('shows a multi-selection summary and disables stale or read-only mutations', () => {
    const { rerender } = render(Inspector, {
      fields,
      values: {},
      selectionLabel: '2 nodes',
      selectionCount: 2,
    })
    expect(screen.getByText(/2 nodes selected/i)).toBeVisible()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()

    void rerender({
      fields,
      values: { 'prompt.node.id': 'review' },
      selectionLabel: 'review',
      selectionCount: 1,
      disabledReason: 'The YAML projection is stale.',
    })
    expect(screen.getByRole('textbox', { name: /node id/i })).toBeDisabled()
    expect(screen.getByText('The YAML projection is stale.')).toBeVisible()
  })
})
