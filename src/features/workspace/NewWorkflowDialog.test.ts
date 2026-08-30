import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte'
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
    const dialog = screen.getByRole('dialog', { name: 'New Workflow' })
    expect(dialog.tagName).toBe('DIALOG')
    expect(dialog.querySelector('[data-modal-body]')).not.toBeNull()
    expect(dialog.querySelector('[data-modal-actions]')).not.toBeNull()
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

  it('uses the supplied active same-profile contract rather than the first sorted version', () => {
    const inactive = {
      ...contract,
      contract_digest: `sha256:${'0'.repeat(64)}` as `sha256:${string}`,
      node_kinds: [{ ...contract.node_kinds[0]!, id: 'inactive' }],
    }
    const active = {
      ...contract,
      contract_digest: `sha256:${'f'.repeat(64)}` as `sha256:${string}`,
      node_kinds: [{ ...contract.node_kinds[0]!, id: 'active' }],
    }
    render(NewWorkflowDialog, {
      contracts: [inactive, active],
      activeContract: () => active,
    })

    expect(screen.getByRole('combobox', { name: 'First node kind' })).toHaveValue('active')
  })

  it('does not select either same-profile contract when the active resolver is ambiguous', () => {
    const lexicalFirst = { ...contract, contract_digest: `sha256:${'0'.repeat(64)}` as `sha256:${string}` }
    const lexicalLast = { ...contract, contract_digest: `sha256:${'f'.repeat(64)}` as `sha256:${string}` }
    render(NewWorkflowDialog, {
      contracts: [lexicalFirst, lexicalLast],
      activeContract: () => undefined,
    })

    expect(within(screen.getByRole('combobox', { name: 'Profile' })).queryAllByRole('option')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Create Workflow' })).toBeDisabled()
  })

  it('focuses the first field and restores its opener when Escape dismisses the modal', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const onCancel = vi.fn()
    render(NewWorkflowDialog, { contracts: [contract], onCancel, opener })

    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveFocus())
    await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(opener).toHaveFocus()
    opener.remove()
  })

  it('restores the retained opener after successful creation closes the modal', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const onCreate = vi.fn(async () => undefined)
    render(NewWorkflowDialog, { contracts: [contract], onCreate, opener })
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Review' } })
    await fireEvent.input(screen.getByLabelText('Description'), { target: { value: 'Review changes' } })
    await fireEvent.input(screen.getByLabelText('First node ID'), { target: { value: 'review' } })
    await fireEvent.input(screen.getByLabelText('Prompt text'), { target: { value: 'Inspect' } })

    await fireEvent.click(screen.getByRole('button', { name: 'Create Workflow' }))
    expect(onCreate).toHaveBeenCalledTimes(1)
    expect(opener).toHaveFocus()
    opener.remove()
  })
})
