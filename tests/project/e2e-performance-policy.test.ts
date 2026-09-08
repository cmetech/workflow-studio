import { describe, expect, it } from 'vitest'
import { shouldEnforcePerceptualPerformance, shouldRunReferenceCapacityScenario } from '../e2e/performance-policy'

describe('E2E perceptual performance policy', () => {
  it('keeps reference-machine timing enabled unless CI explicitly disables it', () => {
    expect(shouldEnforcePerceptualPerformance(undefined)).toBe(true)
    expect(shouldEnforcePerceptualPerformance('on')).toBe(true)
    expect(shouldEnforcePerceptualPerformance('off')).toBe(false)
  })

  it('retains Chromium capacity coverage when shared CI disables reference-host timing', () => {
    expect(shouldRunReferenceCapacityScenario(false, 'chromium')).toBe(true)
    expect(shouldRunReferenceCapacityScenario(false, 'webkit')).toBe(false)
    expect(shouldRunReferenceCapacityScenario(true, 'webkit')).toBe(true)
  })
})
