import { fireEvent, render, screen } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetGitState, setGitInspection } from '$src/stores/git'
import GitView from './GitView.svelte'

describe('GitView', () => {
  afterEach(resetGitState)

  it('shows branch, pair status, both diffs, and chronological history', () => {
    setGitInspection({
      pair: { definitionPath: 'flow.yaml', companionPath: null },
      repository: { root: '/repo', branch: 'main', detachedHead: null },
      status: {
        entries: [{ path: 'flow.yaml', index: 'M', worktree: '.', untracked: false }],
      },
      diff: { working: 'working diff', index: 'index diff' },
      history: [
        {
          oid: '0123456789abcdef',
          shortOid: '0123456789ab',
          authorName: 'Ada',
          authoredAt: '2026-07-29T10:00:00Z',
          subject: 'Update pair',
        },
      ],
    })

    render(GitView, { props: { onSelectCommit: vi.fn() } } as never)

    expect(screen.getByText('Branch: main')).toBeVisible()
    expect(screen.getByText('M. flow.yaml')).toBeVisible()
    expect(screen.getByText('working diff')).toBeVisible()
    expect(screen.getByText('index diff')).toBeVisible()
    expect(screen.getByRole('button', { name: /Update pair/ })).toBeVisible()
  })

  it('requests and renders exact historical contents read-only', async () => {
    const onSelectCommit = vi.fn(async () => ({
      oid: '0123456789abcdef',
      definition: 'name: historical\n',
      companion: 'language_compatibility: hermes-legacy\n',
    }))
    setGitInspection({
      pair: { definitionPath: 'flow.yaml', companionPath: 'flow.hermes.yaml' },
      repository: { root: '/repo', branch: null, detachedHead: '0123456789ab' },
      status: { entries: [] },
      diff: { working: '', index: '' },
      history: [
        {
          oid: '0123456789abcdef',
          shortOid: '0123456789ab',
          authorName: 'Ada',
          authoredAt: '2026-07-29T10:00:00Z',
          subject: 'Historical pair',
        },
      ],
    })
    render(GitView, { props: { onSelectCommit } } as never)

    expect(screen.getByText('Detached: 0123456789ab')).toBeVisible()
    await fireEvent.click(screen.getByRole('button', { name: /Historical pair/ }))

    expect(await screen.findByLabelText('Historical definition')).toHaveTextContent('name: historical')
    expect(screen.getByLabelText('Historical companion')).toHaveTextContent('language_compatibility: hermes-legacy')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(onSelectCommit).toHaveBeenCalledWith('0123456789abcdef')
  })

  it('clears and generation-gates historical preview when the pair changes', async () => {
    const onSelectCommit = vi.fn(async () => ({
      oid: 'aaaaaaaa',
      definition: 'name: A\n',
      companion: null,
    }))
    setGitInspection({
      pair: { definitionPath: 'a.yaml', companionPath: null },
      repository: { root: '/repo-a', branch: 'main', detachedHead: null },
      status: { entries: [] },
      diff: { working: '', index: '' },
      history: [
        {
          oid: 'aaaaaaaa',
          shortOid: 'aaaaaaaa',
          authorName: 'Ada',
          authoredAt: '2026-07-29T10:00:00Z',
          subject: 'A',
        },
      ],
    })
    render(GitView, { props: { onSelectCommit } } as never)
    await fireEvent.click(screen.getByRole('button', { name: /A/ }))
    expect(await screen.findByLabelText('Historical definition')).toHaveTextContent('name: A')

    setGitInspection({
      pair: { definitionPath: 'b.yaml', companionPath: null },
      repository: { root: '/repo-b', branch: 'main', detachedHead: null },
      status: { entries: [] },
      diff: { working: '', index: '' },
      history: [],
    })
    await vi.waitFor(() => expect(screen.queryByLabelText('Historical definition')).not.toBeInTheDocument())
  })

  it('distinguishes no repository from a loading or failed inspection', () => {
    setGitInspection({
      repository: null,
      status: { entries: [] },
      diff: { working: '', index: '' },
      history: [],
    })

    render(GitView, { props: { onSelectCommit: vi.fn() } } as never)

    expect(screen.getByText('This workspace is not a Git repository.')).toBeVisible()
  })
})
