import { fireEvent, render, screen } from '@testing-library/svelte'
import { tick } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '$src/app/App.svelte'
import type { WorkspaceTreeEntry } from '$src/lib/workspace/types'
import { showActivity } from '$src/stores/shell'
import { clearWorkspace, loadWorkspaceEntries, selectWorkspaceEntry, workspace } from '$src/stores/workspace'
import Explorer from './Explorer.svelte'

const tree: readonly WorkspaceTreeEntry[] = [
  {
    kind: 'folder',
    id: 'folder:flows',
    name: 'flows',
    relativePath: 'flows',
    children: [
      {
        kind: 'workflow',
        id: 'workflow:workspace-1:flows/paired.yaml',
        name: 'paired.yaml',
        relativePath: 'flows/paired.yaml',
        definitionPath: 'flows/paired.yaml',
        companionPath: 'flows/paired.hermes.yaml',
        state: 'paired',
        readOnly: false,
      },
      {
        kind: 'workflow',
        id: 'workflow:workspace-1:flows/legacy.yml',
        name: 'legacy.yml',
        relativePath: 'flows/legacy.yml',
        definitionPath: 'flows/legacy.yml',
        companionPath: null,
        state: 'legacy',
        readOnly: false,
      },
    ],
  },
  {
    kind: 'folder',
    id: 'folder:resources',
    name: 'Resources',
    relativePath: 'resources',
    children: [
      {
        kind: 'orphan-companion',
        id: 'orphan:workspace-1:resources/orphan.hermes.yaml',
        name: 'orphan.hermes.yaml',
        relativePath: 'resources/orphan.hermes.yaml',
        companionPath: 'resources/orphan.hermes.yaml',
        state: 'orphan',
        readOnly: true,
      },
    ],
  },
]

describe('Explorer', () => {
  afterEach(() => {
    clearWorkspace()
    showActivity('explorer')
  })

  it('renders a labeled tree with distinct paired, legacy, orphan, and read-only states', async () => {
    render(Explorer, { tree })
    await tick()

    expect(screen.getByRole('heading', { name: 'Explorer' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'New Workflow' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Import' })).toBeVisible()
    expect(screen.getByRole('tree', { name: 'Workspace workflows' })).toBeVisible()
    expect(screen.getByRole('treeitem', { name: 'flows folder' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('treeitem', { name: 'paired.yaml, paired workflow' })).toBeVisible()
    expect(screen.getByRole('treeitem', { name: 'legacy.yml, legacy workflow' })).toBeVisible()
    expect(screen.getByRole('treeitem', { name: 'orphan.hermes.yaml, orphan companion, read only' })).toBeVisible()
    expect(screen.getAllByRole('treeitem').every((item) => item.getAttribute('data-variant') === 'ghost')).toBe(true)
    expect(screen.getByText('+ policy')).toBeVisible()
    expect(screen.getByText('legacy')).toBeVisible()
    expect(screen.getByText('orphan')).toBeVisible()
    expect(screen.getByText('read only')).toBeVisible()
  })

  it('uses roving focus and arrow navigation through expanded folders', async () => {
    render(Explorer, { tree })
    await tick()

    const flows = screen.getByRole('treeitem', { name: 'flows folder' })
    const paired = screen.getByRole('treeitem', { name: 'paired.yaml, paired workflow' })
    const legacy = screen.getByRole('treeitem', { name: 'legacy.yml, legacy workflow' })

    expect(flows).toHaveAttribute('tabindex', '0')
    expect(paired).toHaveAttribute('tabindex', '-1')

    flows.focus()
    await fireEvent.keyDown(flows, { key: 'ArrowDown' })
    expect(paired).toHaveFocus()

    await fireEvent.keyDown(paired, { key: 'ArrowDown' })
    expect(legacy).toHaveFocus()

    await fireEvent.keyDown(legacy, { key: 'ArrowLeft' })
    expect(flows).toHaveFocus()
  })

  it('exposes root and nested positions within each sibling group', async () => {
    render(Explorer, { tree })
    await tick()

    expect(screen.getByRole('treeitem', { name: 'flows folder' })).toHaveAttribute('aria-posinset', '1')
    expect(screen.getByRole('treeitem', { name: 'flows folder' })).toHaveAttribute('aria-setsize', '2')
    expect(screen.getByRole('treeitem', { name: 'Resources folder' })).toHaveAttribute('aria-posinset', '2')
    expect(screen.getByRole('treeitem', { name: 'Resources folder' })).toHaveAttribute('aria-setsize', '2')

    expect(screen.getByRole('treeitem', { name: 'paired.yaml, paired workflow' })).toHaveAttribute('aria-posinset', '1')
    expect(screen.getByRole('treeitem', { name: 'paired.yaml, paired workflow' })).toHaveAttribute('aria-setsize', '2')
    expect(screen.getByRole('treeitem', { name: 'legacy.yml, legacy workflow' })).toHaveAttribute('aria-posinset', '2')
    expect(screen.getByRole('treeitem', { name: 'legacy.yml, legacy workflow' })).toHaveAttribute('aria-setsize', '2')
    expect(screen.getByRole('treeitem', { name: 'orphan.hermes.yaml, orphan companion, read only' })).toHaveAttribute(
      'aria-posinset',
      '1',
    )
    expect(screen.getByRole('treeitem', { name: 'orphan.hermes.yaml, orphan companion, read only' })).toHaveAttribute(
      'aria-setsize',
      '1',
    )
  })

  it('moves from a nested item to the first and last visible tree items with Home and End', async () => {
    render(Explorer, { tree })
    await tick()

    const flows = screen.getByRole('treeitem', { name: 'flows folder' })
    const legacy = screen.getByRole('treeitem', { name: 'legacy.yml, legacy workflow' })
    const orphan = screen.getByRole('treeitem', {
      name: 'orphan.hermes.yaml, orphan companion, read only',
    })

    legacy.focus()
    await fireEvent.keyDown(legacy, { key: 'Home' })
    expect(flows).toHaveFocus()

    legacy.focus()
    await fireEvent.keyDown(legacy, { key: 'End' })
    expect(orphan).toHaveFocus()
  })

  it('collapses, expands, and moves to the first child with arrow keys', async () => {
    render(Explorer, { tree })
    await tick()

    const flows = screen.getByRole('treeitem', { name: 'flows folder' })
    flows.focus()

    await fireEvent.keyDown(flows, { key: 'ArrowLeft' })
    expect(flows).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('treeitem', { name: 'paired.yaml, paired workflow' })).not.toBeInTheDocument()

    await fireEvent.keyDown(flows, { key: 'ArrowRight' })
    expect(flows).toHaveAttribute('aria-expanded', 'true')

    await fireEvent.keyDown(flows, { key: 'ArrowRight' })
    expect(screen.getByRole('treeitem', { name: 'paired.yaml, paired workflow' })).toHaveFocus()
  })

  it('opens workflow leaves with Enter and does not load file contents to render', async () => {
    const onOpen = vi.fn()
    render(Explorer, { tree, onOpen })
    await tick()

    const paired = screen.getByRole('treeitem', { name: 'paired.yaml, paired workflow' })
    paired.focus()
    await fireEvent.keyDown(paired, { key: 'Enter' })

    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ definitionPath: 'flows/paired.yaml' }))
  })

  it('opens a workflow context request from the keyboard without reading content', async () => {
    const onContext = vi.fn()
    render(Explorer, { tree, onContext })
    await tick()

    const paired = screen.getByRole('treeitem', { name: 'paired.yaml, paired workflow' })
    paired.focus()
    await fireEvent.keyDown(paired, { key: 'F10', shiftKey: true })

    expect(onContext).toHaveBeenCalledWith(expect.objectContaining({ definitionPath: 'flows/paired.yaml' }))
  })

  it('renders workspace scan metadata through the approved shell panel', async () => {
    loadWorkspaceEntries('workspace-1', 'Project', [
      {
        relativePath: 'flows/release.yaml',
        kind: 'file',
        size: 120,
        modifiedAt: '2026-07-25T12:00:00.000Z',
        symlink: 'none',
        readOnly: false,
      },
    ])

    render(App)
    expect(await screen.findByRole('complementary', { name: 'Workspace panel' })).toContainElement(
      screen.getByRole('tree', { name: 'Workspace workflows' }),
    )
    expect(screen.getByRole('treeitem', { name: 'release.yaml, legacy workflow' })).toBeVisible()
  })

  it('preserves an active entry atomically when the same workspace scan still contains it', () => {
    const release = {
      relativePath: 'release.yaml',
      kind: 'file' as const,
      size: 120,
      modifiedAt: '2026-07-25T12:00:00.000Z',
      symlink: 'none' as const,
      readOnly: false,
    }
    loadWorkspaceEntries('workspace-1', 'Project', [release])
    selectWorkspaceEntry('workflow:workspace-1:release.yaml')

    loadWorkspaceEntries('workspace-1', 'Project', [
      release,
      {
        relativePath: 'new.yaml',
        kind: 'file',
        size: 80,
        modifiedAt: '2026-07-25T12:01:00.000Z',
        symlink: 'none',
        readOnly: false,
      },
    ])

    expect(workspace.get().activeEntryId).toBe('workflow:workspace-1:release.yaml')
  })
})
