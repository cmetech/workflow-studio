import { render, screen } from '@testing-library/svelte'
import { undo } from '@codemirror/commands'
import { tick } from 'svelte'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { DocumentRevision, WorkflowPairText } from '$src/lib/documents/types'
import EditorModes from './EditorModes.svelte'

const pair: WorkflowPairText = {
  workflowId: 'workflow:workspace:flow.yaml',
  generation: 0,
  savedGeneration: 0,
  definition: {
    id: 'definition',
    kind: 'definition',
    path: 'flow.yaml',
    text: 'name: Flow\n',
    revision: 0,
    savedRevision: 0,
    diskHash: null,
  },
  companion: {
    id: 'companion',
    kind: 'companion',
    path: 'flow.hermes.yaml',
    text: 'language_compatibility: hermes-legacy\n',
    revision: 0,
    savedRevision: 0,
    diskHash: null,
  },
}

const revision: DocumentRevision = {
  workflowId: pair.workflowId,
  pairGeneration: 0,
  definitionPath: pair.definition.path,
  companionPath: pair.companion!.path,
  definitionRevision: 0,
  companionRevision: 0,
  contractDigest: `sha256:${'1'.repeat(64)}`,
}

describe('EditorModes', () => {
  beforeAll(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    )
  })

  it('keeps one editor and its undo history alive across Visual, Split, and YAML modes', async () => {
    const { component, rerender } = render(EditorModes, {
      pair,
      revision,
      analysis: null,
      projection: null,
      mode: 'yaml',
      onTextChange: () => undefined,
    })
    const definition = component.getView('definition')
    definition.dispatch({ changes: { from: 6, to: 10, insert: 'Release' } })

    await rerender({
      pair: { ...pair, definition: { ...pair.definition, text: 'name: Release\n', revision: 1 } },
      revision: { ...revision, definitionRevision: 1 },
      analysis: null,
      projection: null,
      mode: 'visual',
      onTextChange: () => undefined,
    })
    await rerender({
      pair: { ...pair, definition: { ...pair.definition, text: 'name: Release\n', revision: 1 } },
      revision: { ...revision, definitionRevision: 1 },
      analysis: null,
      projection: null,
      mode: 'split',
      onTextChange: () => undefined,
    })

    expect(component.getView('definition')).toBe(definition)
    expect(undo(definition)).toBe(true)
    expect(definition.state.doc.toString()).toBe('name: Flow\n')
  })

  it('keeps definition and companion text, revisions, and histories independent', async () => {
    const onTextChange = vi.fn()
    const { component } = render(EditorModes, {
      pair,
      revision,
      analysis: null,
      projection: null,
      mode: 'yaml',
      onTextChange,
    })

    await screen.getByRole('tab', { name: /companion/i }).click()
    await tick()
    const companion = component.getView('companion')
    companion.dispatch({ changes: { from: 24, to: 37, insert: 'archon-2026-07' } })

    expect(onTextChange).toHaveBeenCalledWith('companion', 'language_compatibility: archon-2026-07\n')
    expect(component.getView('definition').state.doc.toString()).toBe('name: Flow\n')
    expect(screen.getByRole('tabpanel', { name: /companion/i })).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Companion YAML' })).toBeVisible()
  })
})
