import { fireEvent, render, screen } from '@testing-library/svelte'
import { tick } from 'svelte'
import { afterEach, describe, expect, it } from 'vitest'
import { applyBrandTheme, loadBundledBrand } from '$src/lib/branding/load-brand'
import { showActivity, showEditorMode } from '$src/stores/shell'
import { clearWorkspace, loadWorkspaceEntries } from '$src/stores/workspace'
import { $documentSession, closeDocumentSession, openDocumentSession } from '$src/stores/documents'
import { $documentWorkspace } from '$src/features/documents/document-workspace-controller'
import App from './App.svelte'

describe('App', () => {
  afterEach(() => {
    showActivity('explorer')
    showEditorMode('visual')
    clearWorkspace()
    closeDocumentSession()
    $documentWorkspace.set({
      conflict: null,
      recoveryOffers: [],
      saveOutcome: null,
      analysisError: null,
      missingChange: null,
    })
    document.documentElement.removeAttribute('data-brand')
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('style')
  })

  it('offers a workspace action without requiring Hermes', () => {
    const { container } = render(App)
    expect(screen.getByRole('heading', { name: 'LOOP24 Workflow Studio' })).toBeVisible()
    expect(container.querySelector('.brand-lockup img')).toHaveAttribute('alt', '')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Open Folder' })).toHaveLength(2)
    expect(
      screen.getAllByRole('button', { name: 'Open Folder' }).every((button) => !button.hasAttribute('disabled')),
    ).toBe(true)
    expect(screen.queryByText(/connect to hermes/i)).not.toBeInTheDocument()
  })

  it('visibly disables contract-dependent creation when no validated production contract is bundled', async () => {
    render(App)

    expect(await screen.findByText(/no validated production authoring contract is bundled/i)).toBeVisible()
    expect(screen.getByRole('button', { name: 'New Workflow' })).toBeDisabled()
  })

  it('opens existing YAML without a production contract and reports analysis as blocking', async () => {
    loadWorkspaceEntries('browser-workspace', 'Workspace', [
      { relativePath: 'examples/hello.yaml', kind: 'file', size: 1, modifiedAt: '0', symlink: 'none', readOnly: false },
    ])
    render(App)
    await fireEvent.click(screen.getByRole('treeitem', { name: /hello.yaml/i }))

    expect(await screen.findByText(/workflow analysis is unavailable/i)).toBeVisible()
    expect(screen.getByText(/1 blocking/i)).toBeVisible()
  })

  it('renders a structured blocked save outcome for the active document', async () => {
    loadWorkspaceEntries('browser-workspace', 'Workspace', [
      { relativePath: 'examples/hello.yaml', kind: 'file', size: 1, modifiedAt: '0', symlink: 'none', readOnly: false },
    ])
    render(App)
    await fireEvent.click(screen.getByRole('treeitem', { name: /hello.yaml/i }))
    await screen.findByText(/workflow analysis is unavailable/i)
    const activePair = $documentSession.get().pair
    expect(activePair).not.toBeNull()

    $documentWorkspace.set({
      conflict: null,
      recoveryOffers: [],
      analysisError: null,
      missingChange: null,
      saveOutcome: {
        status: 'blocked',
        pair: activePair!,
        issues: [],
        reason: 'analysis_missing_or_stale',
      },
    })
    await tick()

    expect(screen.getByRole('alert')).toHaveTextContent('Save blocked: analysis_missing_or_stale')
  })

  it('surfaces a dirty active file removed outside the application', async () => {
    openDocumentSession(
      {
        workflowId: 'workflow:workspace:flow.yaml',
        generation: 0,
        savedGeneration: 0,
        definition: {
          id: 'workflow:workspace:flow.yaml:definition',
          kind: 'definition',
          path: 'flow.yaml',
          text: 'name: dirty\n',
          revision: 1,
          savedRevision: 0,
          diskHash: 'a'.repeat(64),
        },
        companion: null,
      },
      `sha256:${'0'.repeat(64)}`,
    )
    $documentWorkspace.set({
      ...$documentWorkspace.get(),
      missingChange: { kind: 'remove', paths: ['flow.yaml'], dirty: true },
    })
    render(App)

    expect(screen.getByText(/unsaved workflow file missing after external remove: flow.yaml/i)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Keep Mine / Recreate' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Close and Recover Later' })).toBeEnabled()
  })

  it('keeps the Explorer header and import affordance visible for an opened empty workspace', () => {
    loadWorkspaceEntries('empty', 'Empty', [])
    render(App)

    expect(screen.getByRole('complementary', { name: 'Workspace panel' })).toContainElement(
      screen.getByRole('heading', { name: 'Explorer' }),
    )
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled()
    expect(screen.queryAllByRole('treeitem')).toHaveLength(0)
  })

  it('passes the selected read-only workflow context into context-menu enablement', async () => {
    loadWorkspaceEntries('workspace', 'Workspace', [
      {
        relativePath: 'readonly.yaml',
        kind: 'file',
        size: 1,
        modifiedAt: '0',
        symlink: 'none',
        readOnly: true,
      },
    ])
    render(App)

    await fireEvent.contextMenu(screen.getByRole('treeitem', { name: /readonly.yaml, legacy workflow, read only/i }))
    expect(screen.getByRole('menuitem', { name: 'Open' })).toBeEnabled()
    expect(screen.getByRole('menuitem', { name: 'Duplicate Pair' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Create Companion' })).toBeDisabled()
  })

  it('renders the approved five-region workbench and updates the active activity accessibly', async () => {
    render(App)

    expect(screen.getByRole('navigation', { name: 'Activities' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Explorer' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('complementary', { name: 'Workspace panel' })).toBeEmptyDOMElement()
    expect(screen.getByRole('region', { name: 'Workflow editor' })).toContainElement(
      screen.getByRole('region', { name: 'Open workspace drop zone' }),
    )
    expect(screen.getByRole('complementary', { name: 'Inspector' })).toBeEmptyDOMElement()
    expect(screen.getByRole('status')).toBeVisible()

    await fireEvent.click(screen.getByRole('button', { name: 'Nodes' }))
    await tick()

    expect(screen.getByRole('button', { name: 'Nodes' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Explorer' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('uses an accessible button group to select the editor mode', async () => {
    render(App)

    expect(screen.getByRole('group', { name: 'Editor mode' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Visual' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'YAML' })).toHaveAttribute('aria-pressed', 'false')

    await fireEvent.click(screen.getByRole('button', { name: 'YAML' }))
    await tick()

    expect(screen.getByRole('button', { name: 'Visual' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'YAML' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('applies the selected light theme across the shell chrome', () => {
    applyBrandTheme(loadBundledBrand(), 'light')
    render(App)

    expect(document.documentElement.style.getPropertyValue('--color-yaml-gutter')).toBe('#ECE8D7')
    expect(document.documentElement.style.getPropertyValue('--color-node-selected')).toBe('#FFF4B8')
    expect(screen.getByRole('navigation', { name: 'Activities' }).style.backgroundColor).toBe(
      'var(--color-yaml-gutter)',
    )
    expect(screen.getByRole('status').style.backgroundColor).toBe('var(--color-node-selected)')
  })
})
