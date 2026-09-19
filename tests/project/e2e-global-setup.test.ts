import { describe, expect, it, vi } from 'vitest'

import { retryE2eWarmup } from '../e2e/global-setup'

describe('E2E global warm-up', () => {
  it('retries a deferred-module warm-up failure within the bounded attempt budget', async () => {
    const attempt = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch dynamically imported module'))
      .mockResolvedValueOnce()

    await expect(retryE2eWarmup(attempt, 2)).resolves.toBeUndefined()

    expect(attempt).toHaveBeenCalledTimes(2)
  })

  it('reports every failed attempt when the bounded budget is exhausted', async () => {
    const attempt = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('navigation failed'))
      .mockRejectedValueOnce(new Error('deferred import failed'))

    await expect(retryE2eWarmup(attempt, 2)).rejects.toThrow(
      'Warm-up attempt 1 failed: navigation failed\n\nWarm-up attempt 2 failed: deferred import failed',
    )
  })
})
