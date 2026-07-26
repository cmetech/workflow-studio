import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import type { AuthoringContract } from '$src/lib/contract/types'
import NewWorkflowDialog from './NewWorkflowDialog.svelte'

const contract = {
  profile: 'hermes-legacy',
  definition_schema: {
    type: 'object',
    properties: {
      nodes: {
        type: 'array',
        items: { type: 'object', required: ['id', 'prompt'], properties: { id: {}, prompt: {} } },
      },
    },
  },
  semantic_rules: [
    {
      status: 'supported',
      applicability: { profiles: ['hermes-legacy'], documents: ['definition'] },
      parameters: { nodes_path: 'nodes', id_field: 'id', dependencies_field: 'depends_on' },
    },
  ],
  node_kinds: [
    {
      id: 'prompt',
      label: 'Prompt',
      status: 'supported',
      field_path: 'nodes[].prompt',
      applicability: { profiles: ['hermes-legacy'], documents: ['definition'] },
      fields: [{ id: 'prompt-value', label: 'Prompt text', status: 'supported', field_path: 'nodes[].prompt' }],
    },
  ],
} as unknown as AuthoringContract

describe('NewWorkflowDialog', () => {
  it('renders profile/kind/required values from active contracts and submits only a complete form', async () => {
    const onCreate = vi.fn()
    render(NewWorkflowDialog, { contracts: [contract], onCreate })
    const create = screen.getByRole('button', { name: 'Create Workflow' })
    expect(create).toBeDisabled()
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Review' } })
    await fireEvent.input(screen.getByLabelText('Description'), { target: { value: 'Review changes' } })
    await fireEvent.input(screen.getByLabelText('First node ID'), { target: { value: 'review' } })
    await fireEvent.input(screen.getByLabelText('Prompt text'), { target: { value: 'Inspect the patch' } })
    expect(create).toBeEnabled()
    await fireEvent.click(create)
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: 'hermes-legacy',
        firstNodeKind: 'prompt',
        firstNodeValues: { 'prompt-value': 'Inspect the patch' },
      }),
    )
  })

  it('focuses the first field and restores its opener when Escape dismisses the modal', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const onCancel = vi.fn()
    render(NewWorkflowDialog, { contracts: [contract], onCancel, opener })

    expect(screen.getByLabelText('Name')).toHaveFocus()
    await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(opener).toHaveFocus()
    opener.remove()
  })
})
