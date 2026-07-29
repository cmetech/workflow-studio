import { fireEvent, render, screen, within } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import DiffView from './DiffView.svelte'

describe('DiffView', () => {
  it('switches each exact Git patch between unified and side-by-side presentations', async () => {
    render(DiffView, {
      props: {
        diff: {
          working: '@@ -1 +1 @@\n-name: before\n+name: after\n',
          index: '@@ -1 +1 @@\n description: stable\n',
        },
      },
    } as never)

    expect(screen.getByRole('button', { name: 'Unified diff' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('-name: before', { exact: false })).toBeVisible()

    await fireEvent.click(screen.getByRole('button', { name: 'Side-by-side diff' }))

    const working = screen.getByRole('table', { name: 'Working tree side-by-side diff' })
    expect(within(working).getByRole('columnheader', { name: 'Before' })).toBeVisible()
    expect(within(working).getByText('name: before')).toBeVisible()
    expect(within(working).getByText('name: after')).toBeVisible()
    expect(screen.getByRole('table', { name: 'Index side-by-side diff' })).toBeVisible()
  })
})
