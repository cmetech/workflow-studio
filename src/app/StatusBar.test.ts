import { render, screen } from '@testing-library/svelte'
import { afterEach, describe, expect, it } from 'vitest'
import { resetGitState, setGitInspection } from '$src/stores/git'
import StatusBar from './StatusBar.svelte'
import { setUpdateStateForTest } from '$src/stores/updates'
import packageMetadata from '../../package.json'

describe('StatusBar', () => {
  afterEach(() => {
    resetGitState()
    setUpdateStateForTest(null)
  })

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

    expect(screen.getByRole('status', { name: 'Application status' })).toHaveTextContent('YAML: pending')
    expect(screen.getByRole('status', { name: 'Application status' })).toHaveTextContent('DAG: pending')
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

  it('reports the package version for neutral updater states and preserves active update labels', async () => {
    const { rerender } = render(StatusBar)
    expect(screen.getByText(`Version: ${packageMetadata.version}`)).toBeVisible()

    setUpdateStateForTest({ phase: 'current' })
    await rerender({})
    expect(screen.getByText(`Version: ${packageMetadata.version}`)).toBeVisible()

    setUpdateStateForTest({ phase: 'offline' })
    await rerender({})
    expect(screen.getByText(`Version: ${packageMetadata.version}`)).toBeVisible()

    setUpdateStateForTest({ phase: 'available', version: '2.0.1' })
    await rerender({})
    expect(screen.getByText('Update Available: 2.0.1')).toBeVisible()

    setUpdateStateForTest({ phase: 'downloading', downloadedBytes: 1_024, totalBytes: 4_096 })
    await rerender({})
    expect(screen.getByText('Updating: 1.0 KiB / 4.0 KiB')).toBeVisible()

    setUpdateStateForTest({ phase: 'restart-required' })
    await rerender({})
    expect(screen.getByText('Update: Restart Required')).toBeVisible()

    setUpdateStateForTest({ phase: 'failed' })
    await rerender({})
    expect(screen.getByText('Update: Failed')).toBeVisible()
  })

  it('keeps Git and version visible while naming secondary YAML and DAG status in one disclosure', () => {
    const { container } = render(StatusBar)

    expect(screen.getByText('Git: no workspace')).toBeVisible()
    expect(screen.getByText(`Version: ${packageMetadata.version}`)).toBeVisible()
    const disclosure = screen.getByRole('group', { name: 'More application status' })
    expect(disclosure).toHaveTextContent('YAML: pending')
    expect(disclosure).toHaveTextContent('DAG: pending')
    expect(container.querySelectorAll('[data-secondary-status]')).toHaveLength(2)
  })
})
