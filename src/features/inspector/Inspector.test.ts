import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import type { FormField } from '$src/lib/forms/types'
import type { DocumentationIndex } from '$src/lib/docs/types'
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

const optionalDefaultField: FormField = {
  ...fields[0]!,
  id: 'prompt.node.model',
  label: 'Model',
  fieldPath: 'nodes[].model',
  pathTemplate: ['nodes', '$node', 'model'],
  concretePath: ['nodes', 1, 'model'],
  required: false,
  hasDefault: true,
  defaultValue: 'fast',
}

const enumField: FormField = {
  ...fields[1]!,
  id: 'prompt.node.mode',
  label: 'Mode',
  fieldPath: 'nodes[].mode',
  pathTemplate: ['nodes', '$node', 'mode'],
  concretePath: ['nodes', 1, 'mode'],
  widget: 'enum',
  constraints: { enum: [1, '1', false] },
}

describe('Inspector', () => {
  it('renders accessible roving tabs and field semantics from contract descriptors', async () => {
    render(Inspector, { fields, values: { 'prompt.node.id': 'review' }, selectionLabel: 'review' })

    const tabs = screen.getAllByRole('tab')
    expect(screen.getByLabelText('Workflow inspector')).toBeVisible()
    expect(tabs.map(({ textContent }) => textContent)).toEqual(['General', 'Execution', 'Advanced', 'Docs'])
    expect(tabs.every((tab) => tab.getAttribute('data-variant') === 'ghost')).toBe(true)
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

  it('distinguishes inherited and explicit defaults and resets a draft without committing or deleting', async () => {
    const onCommit = vi.fn()
    const { rerender } = render(Inspector, {
      fields: [optionalDefaultField],
      values: {},
      selectionLabel: 'review',
      selectionNodeId: 'review',
      onCommit,
    })
    expect(screen.getByText('inherited default: fast')).toBeVisible()

    await rerender({
      fields: [optionalDefaultField],
      values: { [optionalDefaultField.id]: 'fast' },
      selectionLabel: 'review',
      selectionNodeId: 'review',
      onCommit,
    })
    expect(screen.getByText('explicit default: fast')).toBeVisible()
    const input = screen.getByRole('textbox', { name: 'Model' })
    await fireEvent.input(input, { target: { value: 'draft' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Reset Model draft' }))
    expect(screen.getByRole('textbox', { name: 'Model' })).toHaveValue('fast')
    expect(onCommit).not.toHaveBeenCalled()

    await fireEvent.click(screen.getByRole('button', { name: 'Remove Model' }))
    expect(onCommit).toHaveBeenCalledWith({ field: optionalDefaultField, remove: true })
  })

  it('routes the enum absent choice to removal and preserves non-string enum value types', async () => {
    const onCommit = vi.fn()
    render(Inspector, {
      fields: [enumField],
      values: { [enumField.id]: 1 },
      selectionLabel: 'review',
      selectionNodeId: 'review',
      onCommit,
    })
    await fireEvent.click(screen.getByRole('tab', { name: 'Execution' }))
    const select = screen.getByRole('combobox', { name: 'Mode' })

    await fireEvent.change(select, { target: { value: '1' } })
    expect(onCommit).toHaveBeenLastCalledWith({ field: enumField, value: '1' })
    await fireEvent.change(select, { target: { value: '__absent__' } })
    expect(onCommit).toHaveBeenLastCalledWith({ field: enumField, remove: true })
  })

  it('shows issues only for the selected node exact canonical field path', () => {
    const contextualField = { ...fields[0]!, concretePath: ['nodes', 1, 'id'] }
    render(Inspector, {
      fields: [contextualField],
      values: { [contextualField.id]: 'review' },
      selectionLabel: 'review',
      selectionNodeId: 'review',
      issues: [
        {
          code: 'wrong-node',
          layer: 'contract',
          severity: 'error',
          blocking: true,
          message: 'Collect ID issue.',
          document: 'definition',
          path: '/nodes/0/id',
          nodeId: 'collect',
          field: 'id',
        },
        {
          code: 'selected-node',
          layer: 'contract',
          severity: 'error',
          blocking: true,
          message: 'Review ID issue.',
          document: 'definition',
          path: '/nodes/1/id',
          nodeId: 'review',
          field: 'id',
        },
      ],
    })

    expect(screen.getByText('Review ID issue.')).toBeVisible()
    expect(screen.queryByText('Collect ID issue.')).not.toBeInTheDocument()
  })

  it('opens only the requested canonical field topic when Docs is targeted', async () => {
    const documentationIndex: DocumentationIndex = {
      topics: [],
      byId: new Map([
        [
          'field:prompt.node.when',
          {
            id: 'field:prompt.node.when',
            kind: 'field' as const,
            title: 'When',
            description: 'When docs.',
            body: '',
            examples: [],
            status: 'supported',
            profile: 'archon-2026-07',
            fieldPaths: ['nodes[].when'],
          },
        ],
      ]),
      searchText: new Map(),
      tokenIndex: new Map(),
    }
    render(Inspector, {
      fields: [
        { ...fields[0]!, id: 'prompt.node.id@/nodes/0/id' },
        { ...fields[1]!, id: 'prompt.node.when@/nodes/0/when' },
      ],
      values: {},
      selectionLabel: 'review',
      documentationIndex,
      documentationTopicId: 'field:prompt.node.when',
    })
    await fireEvent.click(screen.getByRole('tab', { name: 'Docs' }))

    expect(screen.getByLabelText('When documentation')).toBeVisible()
    expect(screen.queryByLabelText('Node ID documentation')).not.toBeInTheDocument()
  })

  it('selects the focused materialized field topic for the Docs tab', async () => {
    const onDocumentationTopic = vi.fn()
    render(Inspector, {
      fields: [
        { ...fields[0]!, id: 'prompt.node.id@/nodes/0/id' },
        { ...fields[1]!, id: 'prompt.node.when@/nodes/0/when' },
      ],
      values: { 'prompt.node.when@/nodes/0/when': 'ready' },
      selectionLabel: 'review',
      onDocumentationTopic,
    })
    await fireEvent.click(screen.getByRole('tab', { name: 'Execution' }))
    await fireEvent.focusIn(screen.getByRole('textbox', { name: 'When' }))

    expect(onDocumentationTopic).toHaveBeenCalledWith('field:prompt.node.when')
  })
})
