import { fireEvent, render, screen } from '@testing-library/svelte'
import { undo } from '@codemirror/commands'
import { tick } from 'svelte'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { DocumentAnalysis, DocumentRevision, WorkflowPairText } from '$src/lib/documents/types'
import { clearCanvasState, setCanvasSelection } from '$src/stores/canvas'
import { acknowledgeProblemFocus, $problemFocus } from '$src/stores/documents'
import { showYamlDocument } from '$src/stores/shell'
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

  afterEach(() => {
    clearCanvasState()
    showYamlDocument('definition')
    acknowledgeProblemFocus()
  })

  it('keeps one editor and its undo history alive across Visual, Split, and YAML modes', async () => {
    const { component, rerender } = render(EditorModes, {
      pair,
      revision,
      analysis: null,
      projection: null,
      mode: 'yaml',
      syncOrigins: { definition: 'user', companion: 'user' },
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
      syncOrigins: { definition: 'user', companion: 'user' },
      onTextChange: () => undefined,
    })
    await rerender({
      pair: { ...pair, definition: { ...pair.definition, text: 'name: Release\n', revision: 1 } },
      revision: { ...revision, definitionRevision: 1 },
      analysis: null,
      projection: null,
      mode: 'split',
      syncOrigins: { definition: 'user', companion: 'user' },
      onTextChange: () => undefined,
    })

    expect(component.getView('definition')).toBe(definition)
    expect(undo(definition)).toBe(true)
    expect(definition.state.doc.toString()).toBe('name: Flow\n')
  })

  it('resets definition disk history without disturbing companion user history', async () => {
    const { component, rerender } = render(EditorModes, {
      pair,
      revision,
      analysis: null,
      projection: null,
      mode: 'yaml',
      syncOrigins: { definition: 'user', companion: 'user' },
      onTextChange: () => undefined,
    })
    const definition = component.getView('definition')
    const companion = component.getView('companion')
    definition.dispatch({ changes: { from: 6, to: 10, insert: 'Unsaved' } })
    companion.dispatch({ changes: { from: 24, to: 37, insert: 'archon-2026-07' } })

    await rerender({
      pair: {
        ...pair,
        definition: { ...pair.definition, text: 'name: Disk\n', revision: 1 },
        companion: {
          ...pair.companion!,
          text: 'language_compatibility: archon-2026-07\n',
          revision: 1,
        },
      },
      revision: { ...revision, definitionRevision: 1, companionRevision: 1 },
      analysis: null,
      projection: null,
      mode: 'yaml',
      syncOrigins: { definition: 'disk', companion: 'user' },
      onTextChange: () => undefined,
    })
    await tick()

    expect(undo(definition)).toBe(false)
    expect(undo(companion)).toBe(true)
    expect(companion.state.doc.toString()).toBe(pair.companion!.text)
  })

  it('keeps a hidden definition visual undo isolated from companion history without feedback', async () => {
    showYamlDocument('companion')
    const onTextChange = vi.fn()
    const companionText = 'language_compatibility: archon-2026-07\n'
    const { component, rerender } = render(EditorModes, {
      pair,
      revision,
      analysis: null,
      projection: null,
      mode: 'yaml',
      syncOrigins: { definition: 'user', companion: 'user' },
      onTextChange,
    })
    const definition = component.getView('definition')
    const companion = component.getView('companion')
    definition.dispatch({ changes: { from: 6, to: 10, insert: 'Release' } })
    companion.dispatch({ changes: { from: 24, to: 37, insert: 'archon-2026-07' } })
    onTextChange.mockClear()

    await rerender({
      pair: {
        ...pair,
        definition: { ...pair.definition, text: 'name: Deploy\n', revision: 2 },
        companion: { ...pair.companion!, text: companionText, revision: 1 },
      },
      revision: { ...revision, definitionRevision: 2, companionRevision: 1 },
      analysis: null,
      projection: null,
      mode: 'yaml',
      syncOrigins: { definition: 'visual', companion: 'user' },
      onTextChange,
    })
    await tick()

    expect(onTextChange).not.toHaveBeenCalled()
    expect(undo(definition)).toBe(true)
    expect(definition.state.doc.toString()).toBe('name: Release\n')
    expect(companion.state.doc.toString()).toBe(companionText)
    expect(onTextChange).toHaveBeenCalledOnce()
    expect(onTextChange).toHaveBeenLastCalledWith('definition', 'name: Release\n')

    expect(undo(companion)).toBe(true)
    expect(companion.state.doc.toString()).toBe(pair.companion!.text)
    expect(definition.state.doc.toString()).toBe('name: Release\n')
    expect(onTextChange).toHaveBeenCalledTimes(2)
    expect(onTextChange).toHaveBeenLastCalledWith('companion', pair.companion!.text)
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

  it('uses roving tabs with stable IDs and complete arrow, Home, and End navigation', async () => {
    render(EditorModes, {
      pair,
      revision,
      analysis: null,
      projection: null,
      mode: 'yaml',
      onTextChange: () => undefined,
    })
    const definition = screen.getByRole('tab', { name: 'Definition YAML' })
    expect(definition).toHaveAttribute('aria-selected', 'true')
    expect(definition).toHaveAttribute('data-variant', 'ghost')
    const companion = screen.getByRole('tab', { name: 'Companion YAML' })
    expect(companion).toHaveAttribute('data-variant', 'ghost')
    const definitionId = definition.id
    const companionId = companion.id

    expect(definition).toHaveAttribute('tabindex', '0')
    expect(companion).toHaveAttribute('tabindex', '-1')
    expect(screen.getByRole('tabpanel', { name: 'Definition YAML' })).toHaveAttribute('aria-labelledby', definitionId)
    await fireEvent.keyDown(definition, { key: 'ArrowRight' })
    expect(companion).toHaveFocus()
    expect(companion).toHaveAttribute('tabindex', '0')
    await fireEvent.keyDown(companion, { key: 'Home' })
    expect(definition).toHaveFocus()
    await fireEvent.keyDown(definition, { key: 'End' })
    expect(companion).toHaveFocus()
    await fireEvent.keyDown(companion, { key: 'ArrowLeft' })
    expect(definition).toHaveFocus()
    expect(definition.id).toBe(definitionId)
    expect(companion.id).toBe(companionId)
  })

  it('never focuses the hidden definition editor while the companion tab is active', async () => {
    showYamlDocument('companion')
    const analysis = editorAnalysis()
    const { component } = render(EditorModes, {
      pair,
      revision,
      analysis,
      projection: analysis.projection as never,
      mode: 'yaml',
      onTextChange: () => undefined,
    })
    const companion = component.getView('companion')
    companion.focus()
    setCanvasSelection(['collect'])
    await tick()

    expect(companion.contentDOM).toHaveFocus()
    expect(component.getView('definition').contentDOM).not.toHaveFocus()
  })

  it('ignores and clears a problem focus request for a different workflow identity', async () => {
    $problemFocus.set({
      issue: {
        code: 'wrong_workflow',
        layer: 'syntax',
        severity: 'error',
        blocking: true,
        message: 'Wrong workflow.',
        document: 'definition',
        line: 1,
        column: 2,
      },
      targetRevision: { ...revision, workflowId: 'workflow:workspace:other.yaml' },
      requested: true,
      requestRevision: 91,
    })
    const { component } = render(EditorModes, {
      pair,
      revision,
      analysis: null,
      projection: null,
      mode: 'yaml',
      onTextChange: () => undefined,
    })
    await tick()

    expect(component.getView('definition').state.selection.main.head).toBe(0)
    expect($problemFocus.get()).toMatchObject({ issue: null, targetRevision: null, requested: false })
  })
})

function editorAnalysis(): DocumentAnalysis {
  return {
    ...revision,
    issues: [],
    structurallyValid: true,
    projection: {
      name: 'Flow',
      description: '',
      profile: 'hermes-legacy',
      nodes: [
        {
          id: 'collect',
          kind: 'command',
          value: 'run',
          dependsOn: [],
          options: {},
          source: { path: '/nodes/0', start: 0, end: 10 },
        },
      ],
      edges: [],
      definition: {},
      companion: null,
    },
  }
}
