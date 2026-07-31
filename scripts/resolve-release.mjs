#!/usr/bin/env node

import { spawnSync } from 'node:child_process'

const MODES = new Set(['absent', 'exact-draft'])
const OUTPUTS = new Set(['id', 'json'])
const OPTION_NAMES = new Set(['mode', 'repository', 'tag', 'expected-commit', 'expected-id', 'output'])
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const COMMIT_PATTERN = /^[0-9a-f]{40}$/
const ASSET_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/

function parseOptions(arguments_) {
  const options = new Map()
  for (let index = 0; index < arguments_.length; index += 2) {
    const option = arguments_[index]
    const value = arguments_[index + 1]
    if (!option?.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new Error(`Expected --option value arguments; received ${option ?? 'nothing'}`)
    }
    const name = option.slice(2)
    if (!OPTION_NAMES.has(name)) {
      throw new Error(`Unknown option: ${option}`)
    }
    if (options.has(name)) {
      throw new Error(`Duplicate option: ${option}`)
    }
    options.set(name, value)
  }
  return options
}

function required(options, name) {
  const value = options.get(name)
  if (!value) {
    throw new Error(`Missing required option: --${name}`)
  }
  return value
}

function listReleases(repository) {
  const endpoint = `repos/${repository}/releases?per_page=100`
  const result = spawnSync('gh', ['api', '--paginate', '--slurp', endpoint], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
  })
  if (result.error) {
    throw new Error(`GitHub release list failed: ${result.error.message}`)
  }
  if (result.status !== 0) {
    throw new Error(`GitHub release list failed with status ${result.status}: ${result.stderr.trim()}`)
  }

  let pages
  try {
    pages = JSON.parse(result.stdout)
  } catch {
    throw new Error('GitHub release list returned invalid JSON')
  }
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
    throw new Error('GitHub release list did not return paginated arrays')
  }
  return pages.flat()
}

function positiveSafeInteger(value, label) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive decimal safe integer`)
  }
  return value
}

function parsePositiveSafeInteger(value, label) {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${label} must be a positive decimal safe integer`)
  }
  return positiveSafeInteger(Number(value), label)
}

function validateAssets(assets, tag) {
  if (!Array.isArray(assets)) {
    throw new Error(`Release tagged ${tag} has an invalid asset list`)
  }
  const names = new Set()
  for (const asset of assets) {
    if (
      !asset ||
      typeof asset !== 'object' ||
      Array.isArray(asset) ||
      Object.getPrototypeOf(asset) !== Object.prototype
    ) {
      throw new Error(`Release tagged ${tag} contains a non-object asset`)
    }
    positiveSafeInteger(asset.id, `Release asset ID for ${tag}`)
    if (typeof asset.name !== 'string' || !ASSET_NAME_PATTERN.test(asset.name)) {
      throw new Error(`Release tagged ${tag} contains an unsafe asset name`)
    }
    if (names.has(asset.name)) {
      throw new Error(`Release tagged ${tag} contains a duplicate asset name: ${asset.name}`)
    }
    names.add(asset.name)
  }
}

function validateRelease(release, tag, expectedCommit) {
  if (!release || typeof release !== 'object') {
    throw new Error(`Release tagged ${tag} is not an object`)
  }
  if (release.draft !== true) {
    throw new Error(`Release tagged ${tag} must be a draft`)
  }
  if (release.target_commitish !== expectedCommit) {
    throw new Error(`Release tagged ${tag} has the wrong target commit`)
  }
  positiveSafeInteger(release.id, `Release ID for ${tag}`)
  validateAssets(release.assets, tag)
  return release
}

function main() {
  const options = parseOptions(process.argv.slice(2))
  const mode = required(options, 'mode')
  const repository = required(options, 'repository')
  const tag = required(options, 'tag')
  const expectedCommit = required(options, 'expected-commit')
  const expectedIdOption = options.get('expected-id')
  const output = options.get('output') ?? 'json'

  if (!MODES.has(mode)) throw new Error(`Unsupported mode: ${mode}`)
  if (!REPOSITORY_PATTERN.test(repository)) throw new Error(`Invalid repository: ${repository}`)
  if (!COMMIT_PATTERN.test(expectedCommit)) throw new Error('Expected commit must be a lowercase 40-character SHA')
  if (!OUTPUTS.has(output)) throw new Error(`Unsupported output: ${output}`)

  const matching = listReleases(repository).filter((release) => release?.tag_name === tag)
  if (mode === 'absent') {
    if (matching.length !== 0) {
      throw new Error(`Expected no release tagged ${tag}; found ${matching.length}`)
    }
    return
  }
  if (matching.length !== 1) {
    throw new Error(`Expected exactly one release tagged ${tag}; found ${matching.length}`)
  }

  const release = validateRelease(matching[0], tag, expectedCommit)
  if (
    expectedIdOption !== undefined &&
    release.id !== parsePositiveSafeInteger(expectedIdOption, 'Expected release ID')
  ) {
    throw new Error(`Release ID for ${tag} does not match the validated release ID`)
  }
  process.stdout.write(output === 'id' ? `${release.id}\n` : `${JSON.stringify(release)}\n`)
}

try {
  main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`Release resolution failed: ${message}\n`)
  process.exitCode = 1
}
