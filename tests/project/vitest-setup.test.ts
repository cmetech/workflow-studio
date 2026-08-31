import { describe, expect, it } from 'vitest'

describe('Vitest browser API harness', () => {
  it('dispatches change events through a replaceable matchMedia onchange handler', () => {
    const query = window.matchMedia('(max-width: 1279px)')
    const calls: Array<{ handler: string; receiver: MediaQueryList; event: Event }> = []
    const first = function (this: MediaQueryList, event: MediaQueryListEvent): void {
      calls.push({ handler: 'first', receiver: this, event })
    }
    const second = function (this: MediaQueryList, event: MediaQueryListEvent): void {
      calls.push({ handler: 'second', receiver: this, event })
    }

    const firstEvent = new Event('change')
    query.onchange = first
    query.dispatchEvent(firstEvent)

    expect(calls).toEqual([{ handler: 'first', receiver: query, event: firstEvent }])

    const secondEvent = new Event('change')
    query.onchange = second
    query.dispatchEvent(secondEvent)

    expect(calls).toEqual([
      { handler: 'first', receiver: query, event: firstEvent },
      { handler: 'second', receiver: query, event: secondEvent },
    ])

    query.onchange = null
    query.dispatchEvent(new Event('change'))

    expect(calls).toHaveLength(2)
  })
})
