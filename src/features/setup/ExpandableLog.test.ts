import { fireEvent, render } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import { tick } from 'svelte'
import ExpandableLog from './ExpandableLog.svelte'

describe('ExpandableLog', () => {
  it('scrolls after rendering only when the user was already near the bottom', async () => {
    const { container, rerender } = render(ExpandableLog, { props: { expanded: true, lines: ['one'] } })
    const log = container.querySelector<HTMLElement>('[data-setup-log]')!
    Object.defineProperties(log, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 180 },
      scrollTop: { configurable: true, writable: true, value: 75 },
    })
    const scrollTo = vi.fn()
    log.scrollTo = scrollTo

    await rerender({ expanded: true, lines: ['one', 'two'] })
    await tick()
    expect(scrollTo).toHaveBeenCalledWith({ top: 180, behavior: 'auto' })

    scrollTo.mockClear()
    log.scrollTop = 10
    await fireEvent.scroll(log)
    await rerender({ expanded: true, lines: ['one', 'two', 'three'] })
    await tick()
    expect(scrollTo).not.toHaveBeenCalled()
  })
})
