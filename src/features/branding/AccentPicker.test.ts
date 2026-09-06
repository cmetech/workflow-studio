import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import AccentPicker from './AccentPicker.svelte'

const props = () => ({
  accent: null,
  fallbackAccent: '#5145CD',
  onAccent: vi.fn(),
  onReset: vi.fn(),
})

describe('AccentPicker', () => {
  it('normalizes a typed six-digit color and disables Apply for invalid input', async () => {
    const current = props()
    render(AccentPicker, current)

    await fireEvent.click(screen.getByRole('button', { name: 'Choose custom accent' }))
    const input = screen.getByRole('textbox', { name: 'Hex accent' })
    const apply = screen.getByRole('button', { name: 'Apply accent' })

    await fireEvent.input(input, { target: { value: '#123' } })
    expect(apply).toBeDisabled()

    await fireEvent.input(input, { target: { value: 'fad22d' } })
    expect(apply).toBeEnabled()
    await fireEvent.click(apply)

    expect(current.onAccent).toHaveBeenCalledWith('#FAD22D')
    expect(screen.queryByRole('dialog', { name: 'Custom accent' })).not.toBeInTheDocument()
  })

  it('synchronizes the native color input and resets to the selected palette', async () => {
    const current = { ...props(), accent: '#123456' }
    render(AccentPicker, current)

    await fireEvent.click(screen.getByRole('button', { name: 'Choose custom accent' }))
    const nativePicker = screen.getByLabelText('Accent color')
    await fireEvent.input(nativePicker, { target: { value: '#32c48d' } })
    expect(screen.getByRole('textbox', { name: 'Hex accent' })).toHaveValue('#32C48D')

    await fireEvent.click(screen.getByRole('button', { name: 'Reset to selected palette' }))
    expect(current.onReset).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog', { name: 'Custom accent' })).not.toBeInTheDocument()
  })

  it('closes on Escape and restores focus to its trigger', async () => {
    render(AccentPicker, props())
    const trigger = screen.getByRole('button', { name: 'Choose custom accent' })
    await fireEvent.click(trigger)

    const dialog = screen.getByRole('dialog', { name: 'Custom accent' })
    await fireEvent.keyDown(dialog, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Custom accent' })).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('closes when a pointer press occurs outside the picker', async () => {
    render(AccentPicker, props())
    await fireEvent.click(screen.getByRole('button', { name: 'Choose custom accent' }))
    expect(screen.getByRole('dialog', { name: 'Custom accent' })).toBeVisible()

    await fireEvent.pointerDown(document.body)

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Custom accent' })).not.toBeInTheDocument())
  })
})
