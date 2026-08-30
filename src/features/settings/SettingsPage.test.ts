import { fireEvent, render, screen } from '@testing-library/svelte'
import { createRawSnippet } from 'svelte'
import { describe, expect, it } from 'vitest'
import SettingsPage from './SettingsPage.svelte'

const content = (label: string) =>
  createRawSnippet(() => ({
    render: () => `<p>${label}</p>`,
  }))

function renderSettings() {
  return render(SettingsPage, {
    appearance: content('Appearance content'),
    contracts: content('Contract content'),
    updates: content('Update content'),
    about: content('About content'),
  })
}

describe('SettingsPage', () => {
  it('renders four categories with exactly one visible panel', async () => {
    renderSettings()

    const appearanceTab = screen.getByRole('tab', { name: 'Appearance' })
    expect(appearanceTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel', { name: 'Appearance' })).toHaveTextContent('Appearance content')

    await fireEvent.click(screen.getByRole('tab', { name: 'Workflow Contracts' }))

    expect(screen.getByRole('tabpanel', { name: 'Workflow Contracts' })).toHaveTextContent('Contract content')
    expect(screen.queryByRole('tabpanel', { name: 'Appearance' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
  })

  it('moves focus and selection with ArrowLeft, ArrowRight, Home, and End', async () => {
    renderSettings()

    const appearance = screen.getByRole('tab', { name: 'Appearance' })
    const contracts = screen.getByRole('tab', { name: 'Workflow Contracts' })
    const updates = screen.getByRole('tab', { name: 'Updates' })
    const about = screen.getByRole('tab', { name: 'About' })

    appearance.focus()
    await fireEvent.keyDown(appearance, { key: 'ArrowRight' })
    expect(contracts).toHaveFocus()
    expect(contracts).toHaveAttribute('aria-selected', 'true')

    await fireEvent.keyDown(contracts, { key: 'ArrowLeft' })
    expect(appearance).toHaveFocus()
    expect(appearance).toHaveAttribute('aria-selected', 'true')

    await fireEvent.keyDown(appearance, { key: 'ArrowLeft' })
    expect(about).toHaveFocus()
    expect(about).toHaveAttribute('aria-selected', 'true')

    await fireEvent.keyDown(about, { key: 'Home' })
    expect(appearance).toHaveFocus()

    await fireEvent.keyDown(appearance, { key: 'End' })
    expect(about).toHaveFocus()
    expect(screen.getByRole('tabpanel', { name: 'About' })).toHaveTextContent('About content')
    expect(updates).toHaveAttribute('aria-selected', 'false')
  })
})
