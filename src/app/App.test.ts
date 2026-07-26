import { fireEvent, render, screen } from '@testing-library/svelte'
import { tick } from 'svelte'
import { afterEach, describe, expect, it } from 'vitest'
import { applyBrandTheme, loadBundledBrand } from '$src/lib/branding/load-brand'
import { showActivity, showEditorMode } from '$src/stores/shell'
import App from './App.svelte'

describe('App', () => {
  afterEach(() => {
    showActivity('explorer')
    showEditorMode('visual')
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
