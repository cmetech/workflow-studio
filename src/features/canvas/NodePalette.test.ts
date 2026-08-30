import { fireEvent, render, screen } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NodeKindDescriptor, WorkflowProfile } from '$src/lib/contract/types'
import NodePalette, { NODE_KIND_DRAG_TYPE } from './NodePalette.svelte'

function descriptor(
  id: string,
  status: NodeKindDescriptor['status'],
  profiles: readonly WorkflowProfile[],
): NodeKindDescriptor {
  return {
    id,
    label: id[0]!.toUpperCase() + id.slice(1),
    description: `${id} description`,
    field_path: `nodes[].${id}`,
    applicability: { profiles, documents: ['definition'] },
    widget: 'text',
    section: 'Nodes',
    order: id === 'command' ? 1 : id === 'prompt' ? 2 : 3,
    status,
    examples: [],
    fields: [],
  }
}

const command = descriptor('command', 'supported', ['hermes-legacy', 'archon-2026-07'])
const prompt = descriptor('prompt', 'deferred', ['hermes-legacy'])
const bash = descriptor('bash', 'supported', ['archon-2026-07'])
const allDescriptors = ['command', 'prompt', 'bash', 'script', 'loop', 'approval', 'cancel'].map((id) =>
  descriptor(id, 'supported', ['hermes-legacy', 'archon-2026-07']),
)

describe('NodePalette', () => {
  afterEach(() => document.querySelectorAll('[data-node-drag-ghost]').forEach((node) => node.remove()))

  it('renders contract order, availability, descriptions, and discoverable keyboard chords', () => {
    render(NodePalette, { descriptors: [bash, prompt, command], profile: 'hermes-legacy' })

    expect(screen.getByRole('heading', { name: 'Nodes' })).toBeVisible()
    expect(screen.getAllByRole('button').map(({ textContent }) => textContent)).toEqual([
      expect.stringContaining('Command'),
      expect.stringContaining('Prompt'),
      expect.stringContaining('Bash'),
    ])
    expect(screen.getByRole('button', { name: /add command node/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /add command node/i })).toHaveAttribute('data-variant', 'secondary')
    expect(screen.getByRole('button', { name: /add command node/i })).toHaveTextContent('N C')
    expect(screen.getByRole('button', { name: /prompt node.*deferred/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /bash node.*not available in hermes-legacy/i })).toBeDisabled()
    expect(screen.getByText('command description')).toBeVisible()
  })

  it('uses the same semantic button for pointer and keyboard activation and never chooses disabled kinds', async () => {
    const onChoose = vi.fn()
    render(NodePalette, {
      descriptors: [command, prompt],
      profile: 'hermes-legacy',
      onChoose,
    })

    const available = screen.getByRole('button', { name: /add command node/i })
    expect(available.tagName).toBe('BUTTON')
    await fireEvent.click(available)
    await fireEvent.click(screen.getByRole('button', { name: /prompt node.*deferred/i }))

    expect(onChoose).toHaveBeenCalledTimes(1)
    expect(onChoose).toHaveBeenCalledWith(command)
  })

  it('publishes a contract kind through HTML drag data and cleans up its lightweight ghost', async () => {
    const setData = vi.fn()
    const setDragImage = vi.fn()
    const transfer = { effectAllowed: '', setData, setDragImage }
    render(NodePalette, { descriptors: [command], profile: 'hermes-legacy' })
    const button = screen.getByRole('button', { name: /add command node/i })

    await fireEvent.dragStart(button, { dataTransfer: transfer })

    expect(setData).toHaveBeenCalledWith(NODE_KIND_DRAG_TYPE, 'command')
    expect(transfer.effectAllowed).toBe('copy')
    expect(setDragImage).toHaveBeenCalledWith(expect.any(HTMLElement), 12, 12)
    expect(document.querySelector('[data-node-drag-ghost]')).not.toBeNull()

    await fireEvent.dragEnd(button, { dataTransfer: transfer })
    expect(document.querySelector('[data-node-drag-ghost]')).toBeNull()
  })

  it('keeps an explanatory non-empty activity when mutation is globally unavailable and rerenders by profile', async () => {
    const { rerender } = render(NodePalette, {
      descriptors: [command, bash],
      profile: 'hermes-legacy',
      disabledReason: 'A current valid authoring contract and YAML projection are required.',
    })

    expect(screen.getByRole('status')).toHaveTextContent('A current valid authoring contract')
    expect(screen.getAllByRole('button').every((button) => button.hasAttribute('disabled'))).toBe(true)

    await rerender({ descriptors: [command, bash], profile: 'archon-2026-07', disabledReason: undefined })
    expect(screen.getByRole('button', { name: /add bash node/i })).toBeEnabled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('keeps every published node kind inside the palette list scroll owner', () => {
    const { container } = render(NodePalette, {
      descriptors: allDescriptors,
      profile: 'hermes-legacy',
    })

    const list = container.querySelector('[data-node-palette-scroll]')
    const lastKind = screen.getByRole('button', { name: /add script node/i })
    expect(list).not.toBeNull()
    expect(list).toContainElement(lastKind)
    lastKind.focus()
    expect(lastKind).toHaveFocus()
  })
})
