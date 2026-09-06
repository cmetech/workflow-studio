import { fireEvent, render, screen, within } from '@testing-library/svelte'
import { createRawSnippet } from 'svelte'
import { describe, expect, it, vi } from 'vitest'
import AuxiliaryPanel from './AuxiliaryPanel.svelte'

const problems = createRawSnippet(() => ({ render: () => '<p>Problem details</p>' }))
const references = createRawSnippet(() => ({ render: () => '<p>Reference suggestions</p>' }))

const props = { problems, references, issueCount: 3, blockingCount: 1, activeTab: 'problems' as const }

describe('AuxiliaryPanel', () => {
  it('exposes linked tabs, one active panel, and visible issue counts on either tab', async () => {
    const onTabChange = vi.fn()
    const { rerender } = render(AuxiliaryPanel, { ...props, onTabChange })
    const list = screen.getByRole('tablist', { name: 'Workflow details' })
    const problemsTab = within(list).getByRole('tab', { name: /Problems/ })
    const referencesTab = within(list).getByRole('tab', { name: 'References' })
    expect(problemsTab).toHaveAttribute('aria-selected', 'true')
    expect(problemsTab).toHaveAttribute('tabindex', '0')
    expect(referencesTab).toHaveAttribute('tabindex', '-1')
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', problemsTab.getAttribute('aria-controls'))
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', problemsTab.id)
    expect(screen.getByText('Problem details')).toBeVisible()
    expect(screen.queryByText('Reference suggestions')).not.toBeInTheDocument()
    await fireEvent.click(referencesTab)
    expect(onTabChange).toHaveBeenLastCalledWith('references')
    await rerender({ ...props, onTabChange, activeTab: 'references' })
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', referencesTab.id)
    expect(screen.getByText('Reference suggestions')).toBeVisible()
    expect(screen.getByText('3 problems, 1 blocking')).toBeVisible()
    expect(screen.queryByText('Problem details')).not.toBeInTheDocument()
  })

  it.each([
    ['ArrowRight', 'Problems', 'References', 'references'],
    ['ArrowLeft', 'Problems', 'References', 'references'],
    ['ArrowRight', 'References', 'Problems', 'problems'],
    ['ArrowLeft', 'References', 'Problems', 'problems'],
    ['Home', 'References', 'Problems', 'problems'],
    ['End', 'Problems', 'References', 'references'],
  ])('moves focus and activates with %s from %s', async (key, from, to, tab) => {
    const onTabChange = vi.fn()
    render(AuxiliaryPanel, { ...props, onTabChange, activeTab: from === 'Problems' ? 'problems' : 'references' })
    const start = screen.getByRole('tab', { name: from })
    start.focus()
    await fireEvent.keyDown(start, { key })
    expect(screen.getByRole('tab', { name: to })).toHaveFocus()
    expect(onTabChange).toHaveBeenLastCalledWith(tab)
  })

  it('falls back to Problems when References content is absent', () => {
    render(AuxiliaryPanel, { problems, issueCount: 0, blockingCount: 0, activeTab: 'references', onTabChange: vi.fn() })
    expect(screen.queryByRole('tab', { name: 'References' })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Problems' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Problem details')).toBeVisible()
  })

  it('restores and publishes independent scroll positions on tab and scope changes', async () => {
    const onProblemsScroll = vi.fn()
    const onReferencesScroll = vi.fn()
    const common = {
      ...props,
      onTabChange: vi.fn(),
      onProblemsScroll,
      onReferencesScroll,
      problemsScroll: 17,
      referencesScroll: 43,
    }
    const { rerender } = render(AuxiliaryPanel, common)
    let panel = screen.getByRole('tabpanel')
    expect(panel.scrollTop).toBe(17)
    panel.scrollTop = 29
    await fireEvent.scroll(panel)
    expect(onProblemsScroll).toHaveBeenLastCalledWith(29)
    expect(onReferencesScroll).not.toHaveBeenCalled()
    await rerender({ ...common, activeTab: 'references' })
    panel = screen.getByRole('tabpanel')
    expect(panel.scrollTop).toBe(43)
    panel.scrollTop = 61
    await fireEvent.scroll(panel)
    expect(onReferencesScroll).toHaveBeenLastCalledWith(61)
    await rerender({ ...common, activeTab: 'references', referencesScroll: 83 })
    expect(screen.getByRole('tabpanel').scrollTop).toBe(83)
  })
})
