import { fireEvent, render, screen } from '@testing-library/svelte'
import { tick } from 'svelte'
import { afterEach, describe, expect, it } from 'vitest'
import { showActivity, showEditorMode } from '$src/stores/shell'
import App from './App.svelte'

describe('App', () => {
  afterEach(() => {
    showActivity('explorer')
    showEditorMode('visual')
  })

  it('offers a workspace action without requiring Hermes', () => {
    render(App)
    expect(screen.getByRole('heading', { name: 'Workflow Studio' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Open Folder' })).toBeEnabled()
    expect(screen.queryByText(/connect to hermes/i)).not.toBeInTheDocument()
  })

  it('renders the approved five-region workbench and updates the active activity accessibly', async () => {
    render(App)

    expect(screen.getByRole('navigation', { name: 'Activities' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Explorer' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('complementary', { name: 'Workspace panel' })).toBeEmptyDOMElement()
    expect(screen.getByRole('region', { name: 'Workflow editor' })).toBeEmptyDOMElement()
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
})
