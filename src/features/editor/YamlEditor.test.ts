import { render } from '@testing-library/svelte'
import { insertNewlineAndIndent, undo } from '@codemirror/commands'
import { tick } from 'svelte'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { DocumentAnalysis, DocumentRevision } from '$src/lib/documents/types'
import type { WorkflowProjection } from '$src/lib/projection/types'
import { clearCanvasState, setCanvasSelection, $canvasSelection } from '$src/stores/canvas'
import YamlEditor from './YamlEditor.svelte'

const revision: DocumentRevision = {
  workflowId: 'workflow:workspace:flow.yaml',
  pairGeneration: 0,
  definitionPath: 'flow.yaml',
  companionPath: null,
  definitionRevision: 0,
  companionRevision: null,
  contractDigest: `sha256:${'1'.repeat(64)}`,
}

const nodes = [{ id: 'collect', source: { path: '/nodes/0', start: 20, end: 53 } }]

function currentAnalysis(overrides: Partial<DocumentAnalysis> = {}): DocumentAnalysis {
  return {
    ...revision,
    issues: [],
    structurallyValid: true,
    projection: {
      name: 'Flow',
      description: '',
      profile: 'hermes-legacy',
      nodes: nodes.map((node) => ({ ...node, kind: 'command', value: 'run', dependsOn: [], options: {} })),
      edges: [],
      definition: {},
      companion: null,
    },
    ...overrides,
  }
}

describe('YamlEditor', () => {
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

  afterEach(() => clearCanvasState())

  it('maps visual changes through user history without echoing or producing hybrid YAML', async () => {
    const onTextChange = vi.fn()
    const { component, rerender } = render(YamlEditor, {
      document: 'definition',
      text: 'name: Flow\n',
      revision,
      analysis: null,
      nodes: [],
      syncOrigin: 'user',
      onTextChange,
    })
    const view = component.getView()

    view.dispatch({ changes: { from: 6, to: 10, insert: 'Release' } })
    expect(onTextChange).toHaveBeenCalledOnce()
    expect(onTextChange).toHaveBeenLastCalledWith('name: Release\n')

    await rerender({
      document: 'definition',
      text: 'name: Release\ndescription: Visual\n',
      revision: { ...revision, definitionRevision: 1 },
      analysis: null,
      nodes: [],
      syncOrigin: 'visual',
      onTextChange,
    })
    await tick()

    expect(component.getView()).toBe(view)
    expect(view.state.doc.toString()).toBe('name: Release\ndescription: Visual\n')
    expect(onTextChange).toHaveBeenCalledOnce()
    expect(undo(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('name: Flow\ndescription: Visual\n')
  })

  it('resets only this tab history for disk, recovery, and unknown whole-document replacements', async () => {
    const onTextChange = vi.fn()
    const { component, rerender } = render(YamlEditor, {
      document: 'definition',
      text: 'name: Flow\nnodes: []\n',
      revision,
      analysis: null,
      nodes: [],
      syncOrigin: 'user',
      onTextChange,
    })
    const view = component.getView()
    view.dispatch({ changes: { from: 6, to: 10, insert: 'Unsaved' } })

    await rerender({
      document: 'definition',
      text: 'name: Disk\nnodes:\n  - id: disk\n',
      revision: { ...revision, definitionRevision: 1 },
      analysis: null,
      nodes: [],
      syncOrigin: 'disk',
      onTextChange,
    })
    await tick()

    expect(view.state.doc.toString()).toBe('name: Disk\nnodes:\n  - id: disk\n')
    expect(undo(view)).toBe(false)
    expect(view.state.doc.toString()).not.toMatch(/Unsaved|hybrid/i)
    expect(onTextChange).toHaveBeenCalledOnce()
  })

  it('focuses a selected graph node range and selects the node under the YAML cursor without bouncing', async () => {
    const { component } = render(YamlEditor, {
      document: 'definition',
      text: 'name: Flow\nnodes:\n  - id: collect\n    command: run\n',
      revision,
      analysis: currentAnalysis(),
      nodes,
      onTextChange: () => undefined,
    })
    const view = component.getView()

    setCanvasSelection(['collect'])
    await tick()
    expect(view.state.selection.main).toMatchObject({ from: 20, to: 51 })

    view.dispatch({ selection: { anchor: 30 } })
    await tick()
    expect($canvasSelection.get()).toEqual(['collect'])

    view.dispatch({ selection: { anchor: 2 } })
    await tick()
    expect($canvasSelection.get()).toEqual([])
  })

  it('disables stale source ranges until accepted analysis matches the current text identity', async () => {
    const { component, rerender } = render(YamlEditor, {
      document: 'definition',
      text: 'name: Flow\nnodes:\n  - id: collect\n    command: run\n',
      revision,
      analysis: currentAnalysis(),
      nodes,
      onTextChange: () => undefined,
    })
    const view = component.getView()
    const insertedRevision = { ...revision, definitionRevision: 1 }
    await rerender({
      document: 'definition',
      text: '# inserted before node\nname: Flow\nnodes:\n  - id: collect\n    command: run\n',
      revision: insertedRevision,
      analysis: currentAnalysis(),
      nodes,
      syncOrigin: 'user',
      onTextChange: () => undefined,
    })
    setCanvasSelection(['collect'])
    await tick()
    expect(view.state.selection.main).toMatchObject({ from: 0, to: 0 })

    setCanvasSelection([])
    view.dispatch({ selection: { anchor: 25 } })
    expect($canvasSelection.get()).toEqual([])

    await rerender({
      document: 'definition',
      text: '# inserted before node\nname: Flow\nnodes:\n  - id: collect\n    command: run\n',
      revision: insertedRevision,
      analysis: currentAnalysis({
        ...insertedRevision,
        projection: {
          ...(currentAnalysis().projection as WorkflowProjection),
          nodes: [
            {
              id: 'collect',
              kind: 'command',
              value: 'run',
              dependsOn: [],
              options: {},
              source: { path: '/nodes/0', start: 43, end: 76 },
            },
          ],
        },
      }),
      nodes: [{ id: 'collect', source: { path: '/nodes/0', start: 43, end: 76 } }],
      syncOrigin: 'user',
      onTextChange: () => undefined,
    })
    setCanvasSelection([])
    setCanvasSelection(['collect'])
    await tick()
    expect(view.state.selection.main).toMatchObject({ from: 43, to: 74 })
  })

  it('updates a hidden editor selection without stealing focus from the canvas surface', async () => {
    const canvasControl = document.body.appendChild(document.createElement('button'))
    canvasControl.focus()
    render(YamlEditor, {
      document: 'definition',
      text: 'name: Flow\nnodes:\n  - id: collect\n',
      revision,
      analysis: currentAnalysis(),
      nodes,
      focusOnSelection: false,
      onTextChange: () => undefined,
    })

    setCanvasSelection(['collect'])
    await tick()

    expect(canvasControl).toHaveFocus()
    canvasControl.remove()
  })

  it('reactively blocks and restores CodeMirror typing through read-only compartments', async () => {
    const { component, rerender } = render(YamlEditor, {
      document: 'definition',
      text: 'name: Flow\n',
      revision,
      analysis: null,
      nodes: [],
      readOnly: false,
      onTextChange: () => undefined,
    })
    const view = component.getView()

    await rerender({
      document: 'definition',
      text: 'name: Flow\n',
      revision,
      analysis: null,
      nodes: [],
      readOnly: true,
      onTextChange: () => undefined,
    })
    await tick()
    expect(view.contentDOM).toHaveAttribute('contenteditable', 'false')
    expect(insertNewlineAndIndent(view)).toBe(false)
    expect(view.state.doc.toString()).toBe('name: Flow\n')

    await rerender({
      document: 'definition',
      text: 'name: Flow\n',
      revision,
      analysis: null,
      nodes: [],
      readOnly: false,
      onTextChange: () => undefined,
    })
    await tick()
    expect(view.contentDOM).toHaveAttribute('contenteditable', 'true')
    expect(insertNewlineAndIndent(view)).toBe(true)
    expect(view.state.doc.toString()).not.toBe('name: Flow\n')
  })

  it('clamps annotated problem focus to current text and focuses only the active document', () => {
    const { component } = render(YamlEditor, {
      document: 'definition',
      text: 'name: Flow\n',
      revision,
      analysis: null,
      nodes: [],
      active: true,
      onTextChange: () => undefined,
    })
    const view = component.getView()

    expect(
      component.focusProblem({
        code: 'out_of_range',
        layer: 'syntax',
        severity: 'error',
        blocking: true,
        message: 'Out of range.',
        document: 'definition',
        line: 99,
        column: 99,
      }),
    ).toBe(true)
    expect(view.state.selection.main.head).toBe(view.state.doc.length)
    expect(view.contentDOM).toHaveFocus()
  })
})
