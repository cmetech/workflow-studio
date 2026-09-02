import { fireEvent, render, screen, within } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import DocumentationOverview from './DocumentationOverview.svelte'

describe('DocumentationOverview', () => {
  it('starts with the approved reading path and task-led destinations instead of exhaustive reference topics', async () => {
    const onSelectTopic = vi.fn()
    render(DocumentationOverview, { onSelectTopic, onBrowseReference: vi.fn() })

    expect(screen.getByText(/Build and edit Hermes workflows locally/i)).toBeVisible()
    const startHere = screen.getByRole('region', { name: 'Start here' })
    expect(
      within(startHere)
        .getAllByRole('button')
        .map((button) => button.textContent?.trim()),
    ).toEqual(['Quick Start', 'Workflow pairs', 'DAG dependencies', 'Problems and validation', 'Keyboard shortcuts'])
    expect(screen.getByRole('button', { name: /Fix a validation problem/i })).toBeVisible()
    expect(screen.queryByText('Context', { selector: 'strong' })).not.toBeInTheDocument()

    await fireEvent.click(screen.getByRole('button', { name: /Fix a validation problem/i }))
    expect(onSelectTopic).toHaveBeenCalledWith('guide:problems-and-validation', expect.any(HTMLElement))
  })

  it('opens a filtered reference group from each concept-level browse entry point', async () => {
    const onBrowseReference = vi.fn()
    render(DocumentationOverview, { onSelectTopic: vi.fn(), onBrowseReference })

    await fireEvent.click(screen.getByRole('button', { name: /Common node settings/i }))
    expect(onBrowseReference).toHaveBeenCalledWith('common-node-settings', expect.any(HTMLElement))
  })
})
