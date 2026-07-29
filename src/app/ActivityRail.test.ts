import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import ActivityRail from './ActivityRail.svelte'
import { showActivity } from '$src/stores/shell'

describe('ActivityRail', () => {
  it('exposes the offline Documentation activity and activates it', async () => {
    showActivity('explorer')
    render(ActivityRail)

    const documentation = screen.getByRole('button', { name: 'Documentation' })
    await fireEvent.click(documentation)

    expect(documentation).toHaveAttribute('aria-pressed', 'true')
  })
})
