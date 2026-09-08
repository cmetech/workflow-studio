export function shouldEnforcePerceptualPerformance(setting: string | undefined): boolean {
  return setting !== 'off'
}

export function shouldRunReferenceCapacityScenario(enforceTimings: boolean, browserName: string): boolean {
  return enforceTimings || browserName === 'chromium'
}

export const enforcePerceptualPerformance = shouldEnforcePerceptualPerformance(
  process.env.WORKFLOW_STUDIO_PERCEPTUAL_PERFORMANCE,
)
