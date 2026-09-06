import { render } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import approvedMarkSource from '../../../brands/loop24/mark.svg?raw'
import Loop24Mark from './Loop24Mark.svelte'

describe('Loop24Mark', () => {
  it('reproduces the approved bundled tile and glyph geometry with semantic colors', () => {
    const approved = new DOMParser().parseFromString(approvedMarkSource, 'image/svg+xml').documentElement
    const { container } = render(Loop24Mark)
    const rendered = container.querySelector('svg')!

    expect(rendered.getAttribute('viewBox')).toBe(approved.getAttribute('viewBox'))
    expect(rendered.querySelector('[data-loop24-tile]')?.getAttribute('width')).toBe(
      approved.querySelector('rect')?.getAttribute('width'),
    )
    expect(rendered.querySelector('[data-loop24-tile]')?.getAttribute('height')).toBe(
      approved.querySelector('rect')?.getAttribute('height'),
    )
    expect([...rendered.querySelectorAll('[data-loop24-glyph]')].map((path) => path.getAttribute('d'))).toEqual(
      [...approved.querySelectorAll('path')].map((path) => path.getAttribute('d')),
    )
    expect(rendered.querySelector('[data-loop24-tile]')).toHaveStyle('fill: var(--color-accent-contrast)')
    expect(rendered.querySelectorAll('[data-loop24-glyph]')).toHaveLength(3)
    for (const glyph of rendered.querySelectorAll('[data-loop24-glyph]')) {
      expect(glyph).toHaveStyle('fill: var(--color-accent)')
    }
  })
})
