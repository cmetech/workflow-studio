import { render, screen } from '@testing-library/svelte'
import { afterEach, describe, expect, it } from 'vitest'
import { resetGitState, setGitInspection } from '$src/stores/git'
import StatusBar from './StatusBar.svelte'

describe('StatusBar', () => {
  afterEach(resetGitState)

  it('reports the detected branch and pair change count', () => {
    setGitInspection({
      pair: { definitionPath: 'flow.yaml', companionPath: 'flow.hermes.yaml' },
      repository: { root: '/repo', branch: 'feature/workflow', detachedHead: null },
      status: {
        entries: [
          { path: 'flow.yaml', index: '.', worktree: 'M', untracked: false },
          { path: 'flow.hermes.yaml', index: '?', worktree: '?', untracked: true },
        ],
      },
      diff: { working: '', index: '' },
      history: [],
    })

    render(StatusBar)

    expect(screen.getByText('Git: feature/workflow · 2 pair changes')).toBeVisible()
  })

  it('reports detached and non-repository states explicitly', () => {
    setGitInspection({
      repository: { root: '/repo', branch: null, detachedHead: '0123456789ab' },
      status: { entries: [] },
      diff: { working: '', index: '' },
      history: [],
    })
    const { unmount } = render(StatusBar)
    expect(screen.getByText('Git: detached 0123456789ab')).toBeVisible()
    unmount()

    setGitInspection({
      repository: null,
      status: { entries: [] },
      diff: { working: '', index: '' },
      history: [],
    })
    render(StatusBar)
    expect(screen.getByText('Git: not a repository')).toBeVisible()
  })
})
