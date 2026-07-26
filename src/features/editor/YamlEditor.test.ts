import { render } from '@testing-library/svelte'
import { tick } from 'svelte'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { DocumentRevision } from '$src/lib/documents/types'
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

  it('publishes user CodeMirror transactions immediately and suppresses external replacement loops', async () => {
    const onTextChange = vi.fn()
    const { component, rerender } = render(YamlEditor, {
      document: 'definition',
      text: 'name: Flow\n',
      revision,
      analysis: null,
      nodes: [],
      onTextChange,
    })
    const view = component.getView()

    view.dispatch({ changes: { from: 6, to: 10, insert: 'Release' } })
    expect(onTextChange).toHaveBeenCalledOnce()
    expect(onTextChange).toHaveBeenLastCalledWith('name: Release\n')

    await rerender({
      document: 'definition',
      text: 'name: External\n',
      revision: { ...revision, definitionRevision: 1 },
      analysis: null,
      nodes: [],
      onTextChange,
    })
    await tick()

    expect(component.getView()).toBe(view)
    expect(view.state.doc.toString()).toBe('name: External\n')
    expect(onTextChange).toHaveBeenCalledOnce()
  })

  it('focuses a selected graph node range and selects the node under the YAML cursor without bouncing', async () => {
    const { component } = render(YamlEditor, {
      document: 'definition',
      text: 'name: Flow\nnodes:\n  - id: collect\n    command: run\n',
      revision,
      analysis: null,
      nodes: [{ id: 'collect', source: { path: '/nodes/0', start: 20, end: 53 } }],
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

  it('updates a hidden editor selection without stealing focus from the canvas surface', async () => {
    const canvasControl = document.body.appendChild(document.createElement('button'))
    canvasControl.focus()
    render(YamlEditor, {
      document: 'definition',
      text: 'name: Flow\nnodes:\n  - id: collect\n',
      revision,
      analysis: null,
      nodes: [{ id: 'collect', source: { path: '/nodes/0', start: 20, end: 39 } }],
      focusOnSelection: false,
      onTextChange: () => undefined,
    })

    setCanvasSelection(['collect'])
    await tick()

    expect(canvasControl).toHaveFocus()
    canvasControl.remove()
  })
})
