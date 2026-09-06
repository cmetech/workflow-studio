import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import AppearanceSettings from './AppearanceSettings.svelte'

describe('AppearanceSettings', () => {
  it('changes palettes immediately with roving keyboard focus', async () => {
    const onColorTheme = vi.fn()
    render(AppearanceSettings, {
      mode: 'system',
      colorTheme: 'loop24-indigo',
      onMode: vi.fn(),
      onColorTheme,
    })

    expect(screen.getAllByRole('radio', { name: /LOOP24 Indigo|Ocean Blue|Emerald/ })).toHaveLength(3)
    expect(screen.getByRole('radio', { name: 'LOOP24 Indigo' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('radio', { name: 'Ocean Blue' })).toHaveAttribute('tabindex', '-1')

    await fireEvent.keyDown(screen.getByRole('radio', { name: 'LOOP24 Indigo' }), { key: 'ArrowRight' })

    expect(screen.getByRole('radio', { name: 'Ocean Blue' })).toHaveFocus()
    expect(onColorTheme).toHaveBeenCalledWith('ocean-blue')
  })

  it('changes brightness immediately with Home and End navigation', async () => {
    const onMode = vi.fn()
    render(AppearanceSettings, {
      mode: 'system',
      colorTheme: 'loop24-indigo',
      onMode,
      onColorTheme: vi.fn(),
    })

    const brightness = screen.getAllByRole('radio', { name: /System|Light|Dark/ })
    expect(brightness).toHaveLength(3)
    expect(screen.getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'true')

    await fireEvent.keyDown(screen.getByRole('radio', { name: 'System' }), { key: 'End' })

    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveFocus()
    expect(onMode).toHaveBeenCalledWith('dark')

    await fireEvent.keyDown(screen.getByRole('radio', { name: 'Dark' }), { key: 'Home' })
    expect(screen.getByRole('radio', { name: 'System' })).toHaveFocus()
    expect(onMode).toHaveBeenLastCalledWith('system')
  })

  it('selects a palette or brightness choice when clicked', async () => {
    const onMode = vi.fn()
    const onColorTheme = vi.fn()
    render(AppearanceSettings, {
      mode: 'light',
      colorTheme: 'ocean-blue',
      onMode,
      onColorTheme,
    })

    await fireEvent.click(screen.getByRole('radio', { name: 'Emerald' }))
    await fireEvent.click(screen.getByRole('radio', { name: 'Dark' }))

    expect(onColorTheme).toHaveBeenCalledWith('emerald')
    expect(onMode).toHaveBeenCalledWith('dark')
  })
})
