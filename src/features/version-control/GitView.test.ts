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

  it('compares current text and loads the accepted historical pair only through the draft callback', async () => {
    const snapshot = {
      oid: '0123456789abcdef',
      definition: 'name: historical\n',
      companion: 'profile: historical\n',
    }
    const onRestoreDraft = vi.fn(async () => undefined)
    setGitInspection({
      pair: { definitionPath: 'flow.yaml', companionPath: 'flow.hermes.yaml' },
      repository: { root: '/repo', branch: 'main', detachedHead: null },
      status: { entries: [] },
      diff: { working: '', index: '' },
      history: [
        {
          oid: snapshot.oid,
          shortOid: '0123456789ab',
          authorName: 'Ada',
          authoredAt: '2026-07-29T10:00:00Z',
          subject: 'Historical pair',
        },
      ],
    })
    render(GitView, {
      props: {
        onSelectCommit: vi.fn(async () => snapshot),
        currentDefinition: 'name: current\n',
        currentCompanion: 'profile: current\n',
        onRestoreDraft,
      },
    } as never)

    await fireEvent.click(screen.getByRole('button', { name: /Historical pair/ }))
    expect(await screen.findByLabelText('Current definition')).toHaveTextContent('name: current')
    expect(screen.getByLabelText('Historical definition')).toHaveTextContent('name: historical')
    await fireEvent.click(screen.getByRole('button', { name: 'Load as unsaved draft' }))

    expect(onRestoreDraft).toHaveBeenCalledWith(snapshot)
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

  it('requires the exact-root dialog before repository initialization', async () => {
    const onInitialize = vi.fn(async () => undefined)
    setGitInspection({ repository: null, status: { entries: [] }, diff: { working: '', index: '' }, history: [] })
    render(GitView, {
      props: { onSelectCommit: vi.fn(), workspaceRoot: '/selected/workspace', onInitialize },
    } as never)

    const opener = screen.getByRole('button', { name: 'Initialize Git repository' })
    await fireEvent.click(opener)
    expect(screen.getByText('/selected/workspace')).toBeVisible()
    await fireEvent.click(screen.getByRole('button', { name: 'Initialize repository' }))
    expect(onInitialize).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(opener).toHaveFocus()
  })

  it('opens create-version confirmation with the exact current pair and readiness', async () => {
    const onCreateVersion = vi.fn(async () => undefined)
    setGitInspection({
      pair: { definitionPath: 'flow.yaml', companionPath: 'flow.hermes.yaml' },
      repository: { root: '/repo', branch: 'main', detachedHead: null },
      status: { entries: [] },
      diff: { working: 'working pair diff', index: 'index pair diff' },
      history: [],
    })
    render(GitView, {
      props: {
        onSelectCommit: vi.fn(),
        versionReady: true,
        findings: ['Provider unavailable'],
        onCreateVersion,
        onSetIdentity: vi.fn(),
      },
    } as never)

    await fireEvent.click(screen.getByRole('button', { name: 'Create version…' }))
    expect(screen.getByText('flow.hermes.yaml')).toBeVisible()
    expect(screen.getByText('Provider unavailable')).toBeVisible()
    await fireEvent.input(screen.getByLabelText('Version message'), { target: { value: 'Checkpoint' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Create version' }))
    expect(onCreateVersion).toHaveBeenCalledWith('Checkpoint')
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('keeps committed warnings and unknown outcomes visible without permitting a retry', async () => {
    const onCreateVersion = vi
      .fn()
      .mockResolvedValueOnce({ status: 'committed', oid: 'a'.repeat(40), warnings: ['Refresh warning'] })
    setGitInspection({
      pair: { definitionPath: 'flow.yaml', companionPath: null },
      repository: { root: '/repo', branch: 'main', detachedHead: null },
      status: { entries: [] },
      diff: { working: 'pair diff', index: '' },
      history: [],
    })
    const { unmount } = render(GitView, {
      props: { onSelectCommit: vi.fn(), versionReady: true, onCreateVersion },
    } as never)
    await fireEvent.click(screen.getByRole('button', { name: 'Create version…' }))
    await fireEvent.input(screen.getByLabelText('Version message'), { target: { value: 'Checkpoint' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Create version' }))
    expect(await screen.findByRole('status')).toHaveTextContent(/committed.*refresh warning/i)
    expect(screen.queryByRole('button', { name: 'Create version' })).not.toBeInTheDocument()
    unmount()

    const unknownCreate = vi.fn(async () => ({
      status: 'unknown' as const,
      code: 'git_commit_outcome_unknown' as const,
      message: 'Inspect repository before retrying.',
    }))
    render(GitView, {
      props: { onSelectCommit: vi.fn(), versionReady: true, onCreateVersion: unknownCreate },
    } as never)
    await fireEvent.click(screen.getByRole('button', { name: 'Create version…' }))
    await fireEvent.input(screen.getByLabelText('Version message'), { target: { value: 'Checkpoint' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Create version' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/inspect repository before retry/i)
    await fireEvent.submit(screen.getByRole('dialog').querySelector('form')!)
    expect(unknownCreate).toHaveBeenCalledOnce()
  })
})
