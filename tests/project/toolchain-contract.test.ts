import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

interface PackageManifest {
  engines?: {
    node?: unknown
  }
  scripts?: Record<string, unknown>
}

interface WorkflowStep {
  if?: string
  name?: string
  uses?: string
  with?: Record<string, unknown>
  run?: string
}

interface GithubWorkflow {
  jobs?: Record<
    string,
    {
      'runs-on'?: unknown
      strategy?: {
        matrix?: Record<string, unknown>
      }
      steps?: WorkflowStep[]
    }
  >
}

const NODE_MINIMUM = '22.13.0'
const RUST_MINIMUM = '1.88.0'
const CI_UNIT_COMMAND = 'npm run test:unit -- --testTimeout=20000 --hookTimeout=600000 --maxWorkers=1'
const WINDOWS_RUST_COMMAND = 'cargo +1.88.0 test --locked --manifest-path src-tauri/Cargo.toml -- --test-threads=1'
const WINDOWS_INSTALLER_COMMAND =
  'npm run test:unit -- tests/project/line-ending-contract.test.ts tests/installers/install-script.test.ts --testTimeout=20000 --hookTimeout=600000 --maxWorkers=1'

function readPackageManifest(): PackageManifest {
  return JSON.parse(readFileSync('package.json', 'utf8')) as PackageManifest
}

function readCargoRustVersion(): string | undefined {
  const cargoManifest = readFileSync('src-tauri/Cargo.toml', 'utf8')
  return cargoManifest.match(/^rust-version\s*=\s*"([^"]+)"/m)?.[1]
}

function readCiWorkflow(): GithubWorkflow {
  return parse(readFileSync('.github/workflows/ci.yml', 'utf8')) as GithubWorkflow
}

describe('minimum toolchain contract', () => {
  it('keeps the advertised Node floor synchronized with exact-minimum CI coverage', () => {
    const packageManifest = readPackageManifest()
    const readme = readFileSync('README.md', 'utf8')
    const workflow = readCiWorkflow()
    const jobs = Object.values(workflow.jobs ?? {})
    const exactMinimumJob = jobs.find((job) =>
      job.steps?.some(
        (step) => step.uses?.startsWith('actions/setup-node@') && step.with?.['node-version'] === NODE_MINIMUM,
      ),
    )
    const exactMinimumCommands = exactMinimumJob?.steps?.map((step) => step.run)

    expect(packageManifest.engines?.node).toBe(`>=${NODE_MINIMUM}`)
    expect(readme).toContain(`Node \`>=${NODE_MINIMUM}\``)
    expect(exactMinimumJob).toBeDefined()
    expect(exactMinimumCommands).toContain('npm ci')
    expect(exactMinimumCommands).toContain(CI_UNIT_COMMAND)
  })

  it('keeps the advertised Rust floor synchronized with exact-minimum locked CI coverage', () => {
    const readme = readFileSync('README.md', 'utf8')
    const workflow = readCiWorkflow()
    const exactMinimumJob = Object.values(workflow.jobs ?? {}).find((job) =>
      job.steps?.some((step) => step.run === `rustup toolchain install ${RUST_MINIMUM} --profile minimal`),
    )
    const exactMinimumCommands = exactMinimumJob?.steps?.map((step) => step.run)

    expect(readCargoRustVersion()).toBe(RUST_MINIMUM)
    expect(readme).toContain(`Rust \`>=${RUST_MINIMUM}\``)
    expect(exactMinimumJob).toBeDefined()
    expect(exactMinimumCommands).toContain(`cargo +${RUST_MINIMUM} check --locked --manifest-path src-tauri/Cargo.toml`)
    expect(exactMinimumCommands).toContain(`cargo +${RUST_MINIMUM} test --locked --manifest-path src-tauri/Cargo.toml`)
  })

  it('treats Windows as a complete native, installer, bundle, and functional E2E platform', () => {
    const workflow = readCiWorkflow()
    const jobs = Object.values(workflow.jobs ?? {})
    const windowsNativeJob = jobs.find((job) => {
      const operatingSystems = job.strategy?.matrix?.os
      return Array.isArray(operatingSystems) && operatingSystems.includes('windows-latest')
    })
    const nativeCommands = windowsNativeJob?.steps?.map((step) => step.run)

    expect(windowsNativeJob).toBeDefined()
    expect(nativeCommands?.some((command) => command?.includes(WINDOWS_RUST_COMMAND))).toBe(true)
    expect(nativeCommands).toContain(WINDOWS_INSTALLER_COMMAND)
    expect(nativeCommands).toContain('npm run build')
    expect(nativeCommands).toContain('npm run bundle:check')
    expect(nativeCommands).toContain('npx --no-install tauri build --debug --config src-tauri/tauri.ci.conf.json')

    const functionalJobs = jobs.filter((job) =>
      job.steps?.some((step) => step.run?.includes('npm.cmd run test:e2e:functional:windows')),
    )
    expect(functionalJobs).toHaveLength(1)
    const functionalMatrix = functionalJobs[0]!.strategy?.matrix?.include
    expect(Array.isArray(functionalMatrix)).toBe(true)
    const shardRows = functionalMatrix as Array<Record<string, unknown>>
    expect(shardRows.length).toBeGreaterThan(1)
    expect(new Set(shardRows.map((row) => row.port)).size).toBe(shardRows.length)
    expect(shardRows.every((row) => typeof row.shard === 'string')).toBe(true)

    const artifactText = jobs
      .flatMap((job) => job.steps ?? [])
      .filter((step) => step.uses?.startsWith('actions/upload-artifact@') && step.if === 'failure()')
      .map((step) => String(step.with?.path ?? ''))
      .join('\n')
    expect(artifactText).toContain('rust-test.log')
    expect(artifactText).toContain('playwright-report')
    expect(artifactText).toContain('test-results')
    expect(artifactText).toContain('dist/.vite/manifest.json')
  })
})
