import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import type { ValidationIssue } from '$src/lib/documents/types'
import ProblemsPanel from './ProblemsPanel.svelte'
import { $problemFocus } from '$src/stores/documents'
import { listCommands } from '$src/lib/commands/registry'

const issues: readonly ValidationIssue[] = [
  {
    code: 'required',
    layer: 'contract',
    severity: 'error',
    blocking: true,
    message: 'A required node field is missing.',
    document: 'definition',
    path: '/tasks/build',
    nodeId: 'build',
  },
  {
    code: 'provider_missing',
    layer: 'operational',
    severity: 'warning',
    blocking: false,
    message: 'Provider is not configured.',
    document: 'companion',
    path: '/providers/release',
  },
]

describe('ProblemsPanel', () => {
  it('publishes scroll changes and restores the active scope offset', async () => {
    const onScroll = vi.fn()
    const { container, rerender } = render(ProblemsPanel, {
      issues,
      paths: { definition: 'flow.yaml', companion: 'flow.hermes.yaml' },
      scrollTop: 17,
      onScroll,
    })
    const owner = container.querySelector<HTMLElement>('[data-scroll-owner="problems"]')!
    expect(owner.scrollTop).toBe(17)
    owner.scrollTop = 29
    await fireEvent.scroll(owner)
    expect(onScroll).toHaveBeenLastCalledWith(29)
    await rerender({
      issues,
      paths: { definition: 'flow.yaml', companion: 'flow.hermes.yaml' },
      scrollTop: 43,
      onScroll,
    })
    expect(owner.scrollTop).toBe(43)
  })

  it('filters counted validation layers while preserving issue actions and the standalone summary', async () => {
    const { container } = render(ProblemsPanel, {
      issues,
      paths: { definition: 'flows/release.yaml', companion: 'flows/release.hermes.yaml' },
    })

    expect(screen.getByRole('heading', { name: 'Problems' })).toBeVisible()
    const layerTabs = screen.getByRole('tablist', { name: 'Validation layers' })
    expect(within(layerTabs).getByRole('tab', { name: 'Syntax 0' })).toBeVisible()
    expect(within(layerTabs).getByRole('tab', { name: 'Contract 1' })).toHaveAttribute('aria-selected', 'true')
    expect(within(layerTabs).getByRole('tab', { name: 'Semantic 0' })).toBeVisible()
    expect(within(layerTabs).getByRole('tab', { name: 'Compatibility 0' })).toBeVisible()
    expect(within(layerTabs).getByRole('tab', { name: 'Operational 1' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'flows/release.yaml' })).toBeVisible()
    expect(screen.getByText('Blocks save and export')).toBeVisible()
    expect(screen.queryByText('Provider is not configured.')).not.toBeInTheDocument()
    expect(container.querySelectorAll('[aria-live="polite"]')).toHaveLength(1)
    expect(screen.getByText('2 problems, 1 blocking')).toHaveAttribute('aria-live', 'polite')

    await fireEvent.click(screen.getByRole('button', { name: /A required node field is missing/ }))
    expect(listCommands().some((command) => command.id === 'problems.focus')).toBe(true)
    expect($problemFocus.get()).toMatchObject({
      issue: { code: 'required', document: 'definition', nodeId: 'build' },
      requested: true,
    })

    await fireEvent.click(within(layerTabs).getByRole('tab', { name: 'Operational 1' }))
    expect(screen.queryByText('A required node field is missing.')).not.toBeInTheDocument()
    expect(screen.getByText('Provider is not configured.')).toBeVisible()
    expect(screen.getByText('Advisory')).toBeVisible()

    await fireEvent.click(within(layerTabs).getByRole('tab', { name: 'Syntax 0' }))
    expect(screen.getByText('No syntax problems.')).toBeVisible()
  })

  it.each([
    ['ArrowRight', 'Contract 1', 'Semantic 0'],
    ['ArrowLeft', 'Contract 1', 'Syntax 0'],
    ['ArrowDown', 'Contract 1', 'Semantic 0'],
    ['ArrowUp', 'Contract 1', 'Syntax 0'],
    ['Home', 'Contract 1', 'Syntax 0'],
    ['End', 'Contract 1', 'Operational 1'],
  ])('moves layer selection and focus with %s', async (key, from, to) => {
    render(ProblemsPanel, {
      issues,
      paths: { definition: 'flow.yaml', companion: 'flow.hermes.yaml' },
    })

    const start = screen.getByRole('tab', { name: from })
    start.focus()
    await fireEvent.keyDown(start, { key })

    expect(screen.getByRole('tab', { name: to })).toHaveFocus()
    expect(screen.getByRole('tab', { name: to })).toHaveAttribute('aria-selected', 'true')
  })

  it('updates the default layer as analysis arrives but preserves an explicit selection', async () => {
    const { rerender } = render(ProblemsPanel, {
      issues: [],
      paths: { definition: 'flow.yaml', companion: 'flow.hermes.yaml' },
    })

    expect(screen.getByRole('tab', { name: 'Syntax 0' })).toHaveAttribute('aria-selected', 'true')
    await rerender({
      issues: [issues[1]!],
      paths: { definition: 'flow.yaml', companion: 'flow.hermes.yaml' },
    })
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Operational 1' })).toHaveAttribute('aria-selected', 'true'),
    )

    await rerender({
      issues: [issues[0]!],
      paths: { definition: 'flow.yaml', companion: 'flow.hermes.yaml' },
    })
    expect(screen.getByRole('tab', { name: 'Operational 0' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('No operational problems.')).toBeVisible()

    await fireEvent.click(screen.getByRole('tab', { name: 'Syntax 0' }))
    await rerender({
      issues: [issues[1]!],
      paths: { definition: 'flow.yaml', companion: 'flow.hermes.yaml' },
    })
    expect(screen.getByRole('tab', { name: 'Syntax 0' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('No syntax problems.')).toBeVisible()
    expect(screen.queryByText('Provider is not configured.')).not.toBeInTheDocument()
  })

  it('focuses the main row even with documentation and exposes Docs as a separate action', async () => {
    const onDocumentation = vi.fn()
    const execute = vi.fn()
    render(ProblemsPanel, {
      issues: [{ ...issues[0]!, documentationId: 'field:prompt.node.prompt' }],
      paths: { definition: 'flow.yaml', companion: null },
      onDocumentation,
      execute,
    })

    const opener = screen.getByRole('button', { name: /^node build:.*required node field/i })
    await fireEvent.click(opener)
    expect(execute).toHaveBeenCalledWith('problems.focus', expect.anything())
    expect(onDocumentation).not.toHaveBeenCalled()
    const docs = screen.getByRole('button', { name: /open documentation for a required node field/i })
    await fireEvent.click(docs)
    expect(onDocumentation).toHaveBeenCalledWith('field:prompt.node.prompt', docs)
  })

  it('qualifies repeated child IDs by workflow and group and keeps duplicate ordinals stable within each fingerprint', async () => {
    const scoped = {
      ...issues[0]!,
      code: 'scoped',
      message: 'Child output is unavailable.',
      nodeId: 'child',
      path: '/nodes/0/loop_group/nodes/0/prompt',
      field: 'prompt',
      scopeKey: 'loop-group:first' as const,
      groupId: 'first',
    }
    const { container, rerender } = render(ProblemsPanel, {
      issues: [scoped, { ...scoped, scopeKey: 'loop-group:second', groupId: 'second' }],
      paths: { definition: 'flow.yaml', companion: null },
      workflowName: 'Scoped',
    })
    expect(screen.getByRole('button', { name: /workflow scoped.*first.*child.*prompt/i })).toBeVisible()
    expect(screen.getByRole('button', { name: /workflow scoped.*second.*child.*prompt/i })).toBeVisible()
    const before = [...container.querySelectorAll('li')].map((item) => item.getAttribute('data-issue-key'))
    await rerender({
      issues: [{ ...issues[0]!, code: 'other', message: 'Earlier unrelated issue.' }, scoped, { ...scoped }],
      paths: { definition: 'flow.yaml', companion: null },
      workflowName: 'Scoped',
    })
    const after = [...container.querySelectorAll('li')].map((item) => item.getAttribute('data-issue-key'))
    expect(after.slice(-2)).toEqual([before[0], `${before[0]!.replace(/,0\]$/, ',1]')}`])
  })

  it('renders byte-identical diagnostics as independent focus targets in its bounded groups scroller', () => {
    const duplicate = {
      ...issues[0]!,
      code: 'duplicate_id',
      message: 'Duplicate node identifier.',
      path: '/nodes/1/id',
      line: 8,
      column: 5,
    }
    const { container } = render(ProblemsPanel, {
      issues: [duplicate, { ...duplicate }],
      paths: { definition: 'flow.yaml', companion: null },
    })

    expect(screen.getAllByRole('button', { name: /Duplicate node identifier/i })).toHaveLength(2)
    expect(container.querySelector('.problems')).toHaveAttribute('data-scroll-frame', 'problems')
    expect(container.querySelector('.groups')).toHaveAttribute('data-scroll-owner', 'problems')
  })

  it('leaves summary and scrolling to its host without losing scoped identity or duplicate ordinals', () => {
    const duplicate = {
      ...issues[0]!,
      code: 'scoped_duplicate',
      message: 'Scoped duplicate issue.',
      scopeKey: 'loop-group:release' as const,
      groupId: 'release',
      nodeId: 'child',
    }
    const { container } = render(ProblemsPanel, {
      hosted: true,
      issues: [duplicate, { ...duplicate }],
      paths: { definition: 'flow.yaml', companion: null },
      workflowName: 'Hosted flow',
    })

    expect(screen.queryByRole('heading', { name: 'Problems' })).not.toBeInTheDocument()
    expect(screen.queryByText('2 problems, 2 blocking')).not.toBeInTheDocument()
    expect(container.querySelector('.problems')).not.toHaveAttribute('data-scroll-frame')
    expect(container.querySelector('.groups')).not.toHaveAttribute('data-scroll-owner')
    expect(screen.getAllByRole('button', { name: /workflow Hosted flow, group release, node child/i })).toHaveLength(2)
    expect([...container.querySelectorAll('li')].map((item) => item.getAttribute('data-issue-key'))).toEqual([
      expect.stringMatching(/,0\]$/),
      expect.stringMatching(/,1\]$/),
    ])
  })
})
