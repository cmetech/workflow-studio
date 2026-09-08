import { describe, expect, it } from 'vitest'
import { shouldEnforcePerceptualPerformance } from '../e2e/performance-policy'

describe('E2E perceptual performance policy', () => {
  it('keeps reference-machine timing enabled unless CI explicitly disables it', () => {
    expect(shouldEnforcePerceptualPerformance(undefined)).toBe(true)
    expect(shouldEnforcePerceptualPerformance('on')).toBe(true)
    expect(shouldEnforcePerceptualPerformance('off')).toBe(false)
  })
})
