import { render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import App from './App.svelte'

describe('App', () => {
  it('offers a workspace action without requiring Hermes', () => {
    render(App)
    expect(screen.getByRole('heading', { name: 'Workflow Studio' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Open Folder' })).toBeEnabled()
    expect(screen.queryByText(/connect to hermes/i)).not.toBeInTheDocument()
  })
})
