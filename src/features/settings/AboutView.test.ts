import { render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import AboutView from './AboutView.svelte'

describe('AboutView', () => {
  it('wraps application, platform, and bundled contract identity without update controls', () => {
    render(AboutView, {
      props: {
        host: { appVersion: '0.1.0', os: 'linux', arch: 'x86_64' },
        contracts: [{ profile: 'archon-2026-07', schemaVersion: 1, digest: `sha256:${'a'.repeat(64)}` }],
      },
    })
    expect(screen.getByText('0.1.0')).toBeVisible()
    expect(screen.getByText('linux / x86_64')).toBeVisible()
    expect(screen.getByText(`sha256:${'a'.repeat(64)}`)).toHaveClass('digest')
    expect(screen.queryByRole('button', { name: 'Check for Updates' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Check for updates at startup' })).not.toBeInTheDocument()
  })
})
