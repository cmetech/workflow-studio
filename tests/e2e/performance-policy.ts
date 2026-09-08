export function shouldEnforcePerceptualPerformance(setting: string | undefined): boolean {
  return setting !== 'off'
}

export const enforcePerceptualPerformance = shouldEnforcePerceptualPerformance(
  process.env.WORKFLOW_STUDIO_PERCEPTUAL_PERFORMANCE,
)
