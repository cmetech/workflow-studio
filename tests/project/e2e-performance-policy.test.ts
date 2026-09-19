import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { shouldEnforcePerceptualPerformance, shouldRunReferenceCapacityScenario } from '../e2e/performance-policy'

interface PackageManifest {
  scripts?: Record<string, unknown>
}

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

  it('keeps functional Windows coverage separate from enforced reference performance', () => {
    const packageManifest = JSON.parse(readFileSync('package.json', 'utf8')) as PackageManifest
    const functional = packageManifest.scripts?.['test:e2e:functional:windows']
    const performance = packageManifest.scripts?.['test:e2e:performance:windows']

    expect(functional).toBe('playwright test --project=chromium --grep-invert @reference-performance')
    expect(performance).toBe('playwright test --project=chromium --grep @reference-performance')
    expect(String(performance)).not.toContain('WORKFLOW_STUDIO_PERCEPTUAL_PERFORMANCE=off')
    expect(packageManifest.scripts?.['bundle:check']).toBe(
      'node scripts/check-bundle-budget.mjs dist/.vite/manifest.json',
    )

    const config = readFileSync('playwright.config.ts', 'utf8')
    const globalSetup = readFileSync('tests/e2e/global-setup.ts', 'utf8')
    expect(config).toContain("globalSetup: './tests/e2e/global-setup.ts'")
    expect(globalSetup).toContain('const WARMUP_ATTEMPTS = 2')
    expect(globalSetup).toContain('for (let attempt = 1; attempt <= WARMUP_ATTEMPTS; attempt += 1)')
    expect(globalSetup).toContain("page.goto(baseURL, { waitUntil: 'load', timeout: WARMUP_ATTEMPT_TIMEOUT_MS })")
    expect(globalSetup).toContain(".locator('[data-viewport-shell]')")
    expect(globalSetup).toContain(".waitFor({ state: 'attached', timeout: WARMUP_ATTEMPT_TIMEOUT_MS })")
    expect(globalSetup).toContain('Warm-up attempt ${attempt} failed')
    expect(globalSetup).toContain('DEFERRED_SURFACE_MODULES')
    expect(globalSetup).toContain('Promise.all(modulePaths.map((modulePath) => import(modulePath)))')
    expect(globalSetup).toContain('await context.close()')
    expect(globalSetup).toContain('await browser.close()')
  })

  it('tags only the hardware-sensitive capacity and long-task paths as reference performance', () => {
    const capacitySource = readFileSync('tests/e2e/canvas-capacity.spec.ts', 'utf8')
    const scopedGestureSource = readFileSync('tests/e2e/loop-group-authoring.spec.ts', 'utf8')

    expect(capacitySource).toContain(
      'keeps the 250-node/500-edge canvas responsive and local-only @reference-performance',
    )
    expect(capacitySource).toContain(
      '[RG12] explicitly arranges fixed-seed 250/500 with one bounded real-worker response and no main-thread long task @reference-performance',
    )
    expect(scopedGestureSource).toContain(
      'keeps hidden scopes idle during scoped gestures and navigation @reference-performance',
    )
    expect(capacitySource).not.toContain('[RG8] times out after 5,000ms without changing layout @reference-performance')
    expect(capacitySource).not.toContain(
      '[RG13] arranges with the exact emitted production worker assets @reference-performance',
    )
  })
})
