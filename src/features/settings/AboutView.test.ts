import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import AboutView from './AboutView.svelte'

describe('AboutView', () => {
  it('wraps host and contract identity and exposes startup/manual update controls', async () => {
    const check = vi.fn()
    const preference = vi.fn()
    render(AboutView, {
      props: {
        host: { appVersion: '0.1.0', os: 'linux', arch: 'x86_64' },
        contracts: [{ profile: 'archon-2026-07', schemaVersion: 1, digest: `sha256:${'a'.repeat(64)}` }],
        startupCheckEnabled: true,
        updateState: null,
        oncheck: check,
        onstartupchange: preference,
      },
    })
    expect(screen.getByText('0.1.0')).toBeVisible()
    expect(screen.getByText('linux / x86_64')).toBeVisible()
    expect(screen.getByText(`sha256:${'a'.repeat(64)}`)).toHaveClass('digest')
    await fireEvent.click(screen.getByRole('button', { name: 'Check for Updates' }))
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Check for updates at startup' }))
    expect(check).toHaveBeenCalledOnce()
    expect(preference).toHaveBeenCalledWith(false)
  })
})
