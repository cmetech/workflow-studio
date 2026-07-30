#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRODUCT_PREFIX = 'LOOP24-Workflow-Studio'
const REPOSITORY_RELEASE_ROOT = 'https://github.com/cmetech/workflow-studio/releases/download'
const TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z][0-9A-Za-z.-]*))?$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const SAFE_ASSET_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

const TARGETS = Object.freeze({
  'darwin-aarch64': Object.freeze({
    installerSuffix: 'macos_aarch64.dmg',
    updaterSuffix: 'macos_aarch64.app.tar.gz',
  }),
  'darwin-x86_64': Object.freeze({
    installerSuffix: 'macos_x86_64.dmg',
    updaterSuffix: 'macos_x86_64.app.tar.gz',
  }),
  'windows-x86_64': Object.freeze({
    installerSuffix: 'windows_x86_64-setup.exe',
    updaterSuffix: 'windows_x86_64.nsis.zip',
  }),
  'linux-x86_64': Object.freeze({
    installerSuffix: 'linux_x86_64.AppImage',
    updaterSuffix: 'linux_x86_64.AppImage.tar.gz',
  }),
})

export const SUPPORTED_TARGETS = Object.freeze(Object.keys(TARGETS))

const UPDATER_TARGETS = Object.freeze({
  'darwin-aarch64': 'darwin-aarch64',
  'darwin-aarch64-app': 'darwin-aarch64',
  'darwin-x86_64': 'darwin-x86_64',
  'darwin-x86_64-app': 'darwin-x86_64',
  'windows-x86_64': 'windows-x86_64',
  'windows-x86_64-nsis': 'windows-x86_64',
  'linux-x86_64': 'linux-x86_64',
  'linux-x86_64-appimage': 'linux-x86_64',
})

function versionFromTag(tag) {
  const match = TAG_PATTERN.exec(tag)
  if (!match) {
    throw new Error(`Invalid release tag: ${String(tag)}`)
  }
  return tag.slice(1)
}

function exactName(version, suffix) {
  return `${PRODUCT_PREFIX}_${version}_${suffix}`
}

function expectedNames(tag) {
  const version = versionFromTag(tag)
  const names = new Set(['latest.json', 'SHA256SUMS'])
  for (const target of Object.values(TARGETS)) {
    names.add(exactName(version, target.installerSuffix))
    const updaterName = exactName(version, target.updaterSuffix)
    names.add(updaterName)
    names.add(`${updaterName}.sig`)
  }
  return names
}

function requireAssetArray(assets) {
  if (!Array.isArray(assets) || assets.length === 0) {
    throw new Error('Release assets must be a non-empty array')
  }
  return assets
}

export function selectInstallerAsset(assets, tag, os, arch) {
  const targetKey = `${os}-${arch}`
  const target = TARGETS[targetKey]
  if (!target) {
    throw new Error(`Unsupported release target: ${os}/${arch}`)
  }
  const version = versionFromTag(tag)
  const expected = exactName(version, target.installerSuffix)
  const matches = requireAssetArray(assets).filter((asset) => asset?.name === expected)
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one installer for ${os}/${arch}; found ${matches.length}`)
  }
  return matches[0]
}

function updaterAssetNameFromUrl(url, tag) {
  if (typeof url !== 'string') {
    throw new Error('Updater URL must be a string')
  }
  const expectedPrefix = `${REPOSITORY_RELEASE_ROOT}/${tag}/`
  if (!url.startsWith(expectedPrefix)) {
    throw new Error(`Updater URL must use the exact ${tag} release`)
  }
  const encodedName = url.slice(expectedPrefix.length)
  let name
  try {
    name = decodeURIComponent(encodedName)
  } catch {
    throw new Error('Updater URL contains invalid encoding')
  }
  if (name !== basename(name) || !SAFE_ASSET_PATTERN.test(name)) {
    throw new Error(`Updater URL contains an unsafe asset name: ${name}`)
  }
  return name
}

export function normalizeUpdaterManifest(updater, tag) {
  versionFromTag(tag)
  if (!updater || typeof updater !== 'object' || !updater.platforms || typeof updater.platforms !== 'object') {
    throw new Error('Updater platforms are missing')
  }
  const actualKeys = Object.keys(updater.platforms).sort()
  const expectedKeys = Object.keys(UPDATER_TARGETS).sort()
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    const missing = expectedKeys.filter((target) => !actualKeys.includes(target))
    const unexpected = actualKeys.filter((target) => !expectedKeys.includes(target))
    throw new Error(
      `Updater target coverage mismatch; missing: ${missing.join(', ') || 'none'}; unexpected: ${unexpected.join(', ') || 'none'}`,
    )
  }
  const platforms = {}
  const version = versionFromTag(tag)
  for (const key of expectedKeys) {
    const platform = updater.platforms[key]
    if (!platform || typeof platform.signature !== 'string' || platform.signature.trim() === '') {
      throw new Error(`Updater signature is missing for ${key}`)
    }
    const baseTarget = UPDATER_TARGETS[key]
    const updaterName = exactName(version, TARGETS[baseTarget].updaterSuffix)
    platforms[key] = {
      ...platform,
      url: `${REPOSITORY_RELEASE_ROOT}/${tag}/${updaterName}`,
    }
  }
  return { ...updater, platforms }
}

export function validateReleaseManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('Release manifest must be an object')
  }
  const tag = manifest.tag
  const version = versionFromTag(tag)
  const assets = requireAssetArray(manifest.assets)
  const allowedNames = expectedNames(tag)
  const byName = new Map()
  const folded = new Map()

  for (const asset of assets) {
    const name = asset?.name
    if (typeof name !== 'string' || !SAFE_ASSET_PATTERN.test(name) || name !== basename(name)) {
      throw new Error(`Unsafe release asset name: ${String(name)}`)
    }
    const fold = name.toLocaleLowerCase('en-US')
    if (folded.has(fold)) {
      throw new Error(`Release asset case-fold collision: ${name}`)
    }
    folded.set(fold, name)
    if (!allowedNames.has(name)) {
      throw new Error(`Unknown product, version, platform, or architecture asset: ${name}`)
    }
    if (!Number.isSafeInteger(asset.size) || asset.size <= 0) {
      throw new Error(`Release asset is empty or has an invalid size: ${name}`)
    }
    if (name !== 'SHA256SUMS' && (typeof asset.sha256 !== 'string' || !SHA256_PATTERN.test(asset.sha256))) {
      throw new Error(`Missing or invalid SHA-256 checksum for ${name}`)
    }
    byName.set(name, asset)
  }

  for (const requiredName of allowedNames) {
    if (!byName.has(requiredName)) {
      const kind = requiredName.endsWith('.sig') ? 'updater signature companion' : 'required release asset'
      throw new Error(`Missing ${kind}: ${requiredName}`)
    }
  }

  const platforms = manifest.updater?.platforms
  if (manifest.updater?.version !== version) {
    throw new Error(`Updater version must match release version ${version}`)
  }
  if (typeof manifest.updater?.notes !== 'string') {
    throw new Error('Updater release notes must be a string')
  }
  const publicationDate = manifest.updater?.pub_date
  if (
    typeof publicationDate !== 'string' ||
    !Number.isFinite(Date.parse(publicationDate)) ||
    new Date(publicationDate).toISOString() !== publicationDate
  ) {
    throw new Error('Updater publication date must be an exact ISO-8601 timestamp')
  }
  if (!platforms || typeof platforms !== 'object' || Array.isArray(platforms)) {
    throw new Error('Updater platforms are missing')
  }
  const updaterKeys = Object.keys(platforms).sort()
  const expectedTargets = Object.keys(UPDATER_TARGETS).sort()
  if (JSON.stringify(updaterKeys) !== JSON.stringify(expectedTargets)) {
    const missing = expectedTargets.filter((target) => !updaterKeys.includes(target))
    const unexpected = updaterKeys.filter((target) => !expectedTargets.includes(target))
    throw new Error(
      `Updater target coverage mismatch; missing: ${missing.join(', ') || 'none'}; unexpected: ${unexpected.join(', ') || 'none'}`,
    )
  }

  for (const targetKey of expectedTargets) {
    const platform = platforms[targetKey]
    if (!platform || typeof platform.signature !== 'string' || platform.signature.trim() === '') {
      throw new Error(`Updater signature is missing for ${targetKey}`)
    }
    const updaterName = updaterAssetNameFromUrl(platform.url, tag)
    if (!byName.has(updaterName)) {
      throw new Error(`Updater target ${targetKey} refers to an asset not present in the manifest: ${updaterName}`)
    }
    const baseTarget = UPDATER_TARGETS[targetKey]
    const expectedUpdater = exactName(version, TARGETS[baseTarget].updaterSuffix)
    if (updaterName !== expectedUpdater) {
      throw new Error(`Updater target ${targetKey} refers to the wrong platform artifact`)
    }
    if (!byName.has(`${updaterName}.sig`)) {
      throw new Error(`Updater signature companion is missing for ${updaterName}`)
    }
  }

  return {
    tag,
    version,
    assetCount: assets.length,
    updaterTargets: SUPPORTED_TARGETS,
  }
}

export function validateChecksumText(text, knownAssetNames) {
  if (typeof text !== 'string') {
    throw new Error('Checksum manifest must be text')
  }
  const known = new Set(knownAssetNames)
  const entries = []
  const seen = new Set()
  for (const line of text.split(/\r?\n/u)) {
    if (line === '') continue
    const match = /^([0-9a-f]{64})  ([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(line)
    if (!match) {
      throw new Error(`Malformed checksum line: ${line}`)
    }
    const [, sha256, name] = match
    if (!known.has(name) || name === 'SHA256SUMS') {
      throw new Error(`Unknown checksum path: ${name}`)
    }
    if (seen.has(name)) {
      throw new Error(`Duplicate checksum path: ${name}`)
    }
    seen.add(name)
    entries.push({ name, sha256 })
  }
  return entries
}

async function digestFile(path) {
  const hash = createHash('sha256')
  hash.update(await readFile(path))
  return hash.digest('hex')
}

async function fixtureFromDirectory(directory, tag, writeChecksums) {
  const names = (await readdir(directory)).sort()
  if (writeChecksums && names.includes('SHA256SUMS')) {
    throw new Error('Refusing to overwrite an existing SHA256SUMS')
  }
  if (writeChecksums) {
    const updaterPath = join(directory, 'latest.json')
    const updater = JSON.parse(await readFile(updaterPath, 'utf8'))
    const normalized = normalizeUpdaterManifest(updater, tag)
    await writeFile(updaterPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
  }
  const checksumNames = names.filter((name) => name !== 'SHA256SUMS')
  const checksumEntries = []
  for (const name of checksumNames) {
    if (!SAFE_ASSET_PATTERN.test(name)) {
      throw new Error(`Unsafe release asset name: ${name}`)
    }
    const info = await stat(join(directory, name))
    if (!info.isFile()) {
      throw new Error(`Release asset is not a regular file: ${name}`)
    }
    checksumEntries.push({ name, sha256: await digestFile(join(directory, name)) })
  }
  if (writeChecksums) {
    const contents = `${checksumEntries.map((entry) => `${entry.sha256}  ${entry.name}`).join('\n')}\n`
    await writeFile(join(directory, 'SHA256SUMS'), contents, { encoding: 'utf8', flag: 'wx' })
    names.push('SHA256SUMS')
    names.sort()
  }
  if (!names.includes('SHA256SUMS')) {
    throw new Error('Missing SHA256SUMS')
  }
  const checksumText = await readFile(join(directory, 'SHA256SUMS'), 'utf8')
  const parsedChecksums = validateChecksumText(checksumText, names)
  const checksums = new Map(parsedChecksums.map((entry) => [entry.name, entry.sha256]))
  for (const entry of checksumEntries) {
    if (checksums.get(entry.name) !== entry.sha256) {
      throw new Error(`SHA-256 mismatch for ${entry.name}`)
    }
  }
  if (checksums.size !== checksumEntries.length) {
    throw new Error('SHA256SUMS does not cover every public release asset')
  }

  const assets = []
  for (const name of names) {
    const info = await stat(join(directory, name))
    assets.push({ name, size: info.size, ...(name === 'SHA256SUMS' ? {} : { sha256: checksums.get(name) }) })
  }
  const updater = JSON.parse(await readFile(join(directory, 'latest.json'), 'utf8'))
  return { tag, assets, updater }
}

function readOption(args, name) {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

async function main(args) {
  const fixturePath = readOption(args, '--fixture')
  const directory = readOption(args, '--directory')
  if ((fixturePath ? 1 : 0) + (directory ? 1 : 0) !== 1) {
    throw new Error('Use exactly one of --fixture or --directory')
  }
  let fixture
  if (fixturePath) {
    fixture = JSON.parse(await readFile(fixturePath, 'utf8'))
  } else {
    const tag = readOption(args, '--tag')
    if (!tag) throw new Error('--directory requires --tag')
    fixture = await fixtureFromDirectory(directory, tag, args.includes('--write-checksums'))
  }
  const result = validateReleaseManifest(fixture)
  process.stdout.write(
    `Verified ${result.assetCount} release assets for ${result.tag}: ${result.updaterTargets.join(', ')}\n`,
  )
}

const invokedPath = process.argv[1] ? fileURLToPath(new URL(`file://${process.argv[1]}`)) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `Release asset verification failed: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 1
  })
}
