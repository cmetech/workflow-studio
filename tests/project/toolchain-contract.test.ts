import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

interface PackageManifest {
  engines?: {
    node?: unknown
  }
}

interface GithubWorkflow {
  jobs?: Record<
    string,
    {
      steps?: Array<{
        uses?: string
        with?: Record<string, unknown>
        run?: string
      }>
    }
  >
}

const NODE_MINIMUM = '22.13.0'
const RUST_MINIMUM = '1.88.0'
const CI_UNIT_COMMAND = 'npm run test:unit -- --testTimeout=20000 --hookTimeout=600000 --maxWorkers=1'

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
})
