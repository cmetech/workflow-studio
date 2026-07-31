#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { lstat, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRODUCT_PREFIX = 'LOOP24-Workflow-Studio'
const REPOSITORY_RELEASE_ROOT = 'https://github.com/cmetech/workflow-studio/releases/download'
const TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z][0-9A-Za-z.-]*))?$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const SAFE_ASSET_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const INTEGRITY_SCHEMA_VERSION = 1
const PE_DOS_HEADER_SIZE = 0x40
const PE_COFF_HEADER_SIZE = 24
const PE_OPTIONAL_HEADER_SUBSYSTEM_OFFSET = 68
const PE32_OPTIONAL_HEADER_FIXED_SIZE = 96
const PE32_PLUS_OPTIONAL_HEADER_FIXED_SIZE = 112
const PE32_NUMBER_OF_RVA_AND_SIZES_OFFSET = 92
const PE32_PLUS_NUMBER_OF_RVA_AND_SIZES_OFFSET = 108
const PE_DATA_DIRECTORY_SIZE = 8
const MAX_PE_HEADER_OFFSET = 1024 * 1024
const PACKAGED_RESOURCE_PATHS = Object.freeze([
  'brands/loop24/brand.yaml',
  'brands/loop24/logo.svg',
  'brands/loop24/mark.svg',
  'brands/resource-root',
  'contracts/README.md',
  'contracts/archon-2026-07-v1.json',
  'contracts/hermes-legacy-v1.json',
  'contracts/manifest.json',
  'contracts/resource-root',
  'examples/README.md',
  'examples/advanced-reference/workflow.hermes.yaml',
  'examples/advanced-reference/workflow.yaml',
  'examples/ai-tools/workflow.hermes.yaml',
  'examples/ai-tools/workflow.yaml',
  'examples/approval/workflow.hermes.yaml',
  'examples/approval/workflow.yaml',
  'examples/bash-script/workflow.hermes.yaml',
  'examples/bash-script/workflow.yaml',
  'examples/bounded-loop/workflow.hermes.yaml',
  'examples/bounded-loop/workflow.yaml',
  'examples/catalog.yaml',
  'examples/conditional/workflow.hermes.yaml',
  'examples/conditional/workflow.yaml',
  'examples/minimal/workflow.yaml',
  'examples/parallel-fan-in/workflow.hermes.yaml',
  'examples/parallel-fan-in/workflow.yaml',
  'examples/resource-root',
  'examples/retry-trigger/workflow.yaml',
  'examples/sequential/workflow.hermes.yaml',
  'examples/sequential/workflow.yaml',
])
const PACKAGED_RESOURCE_PATH_SET = new Set(PACKAGED_RESOURCE_PATHS)
const PACKAGED_RESOURCE_DIRECTORY_PATH_SET = new Set(
  PACKAGED_RESOURCE_PATHS.flatMap((path) => {
    const segments = path.split('/')
    segments.pop()
    return segments.map((_, index) => segments.slice(0, index + 1).join('/'))
  }),
)
const PACKAGED_RESOURCE_DIRECTORIES = Object.freeze(
  [...PACKAGED_RESOURCE_DIRECTORY_PATH_SET].filter((path) => !path.includes('/')).sort(),
)

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
    updaterSuffix: 'windows_x86_64-setup.exe',
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
  const version = versionFromTag(tag)
  if (!updater || typeof updater !== 'object' || !updater.platforms || typeof updater.platforms !== 'object') {
    throw new Error('Updater platforms are missing')
  }
  if (updater.version !== version) {
    throw new Error(`Updater version must match release version ${version}`)
  }
  if (typeof updater.notes !== 'string') {
    throw new Error('Updater release notes must be a string')
  }
  if (
    typeof updater.pub_date !== 'string' ||
    !Number.isFinite(Date.parse(updater.pub_date)) ||
    new Date(updater.pub_date).toISOString() !== updater.pub_date
  ) {
    throw new Error('Updater publication date must be an exact ISO-8601 timestamp')
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
  assertUpdaterAliasSignatures(updater.platforms)
  return { ...updater, platforms }
}

function assertCanonicalUpdaterManifest(updater, tag) {
  const normalized = normalizeUpdaterManifest(updater, tag)
  for (const target of Object.keys(normalized.platforms)) {
    if (updater.platforms[target].url !== normalized.platforms[target].url) {
      throw new Error(`Updater URL for ${target} must use the exact ${tag} release`)
    }
  }
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
    if (byName.has(name)) {
      throw new Error(`Duplicate release asset: ${name}`)
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
  if (assets.length !== allowedNames.size) {
    throw new Error(`Release asset inventory must contain exactly ${allowedNames.size} assets; found ${assets.length}`)
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
  }
  assertUpdaterAliasSignatures(platforms)

  for (const targetKey of expectedTargets) {
    const platform = platforms[targetKey]
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

function assertExactDirectoryInventory(names, tag, checksumRequired) {
  const expected = expectedNames(tag)
  if (!checksumRequired) expected.delete('SHA256SUMS')
  for (const name of names) {
    if (!SAFE_ASSET_PATTERN.test(name) || name !== basename(name)) {
      throw new Error(`Unsafe release asset name: ${name}`)
    }
    if (!expected.has(name)) {
      throw new Error(`Unknown product, version, platform, or architecture asset: ${name}`)
    }
  }
  if (names.length !== expected.size) {
    const missing = [...expected].find((name) => !names.includes(name))
    throw new Error(`Missing required release asset: ${missing ?? 'unknown'}`)
  }
}

function assertUpdaterAliasSignatures(platforms) {
  const signatureByTarget = new Map()
  for (const [platformKey, baseTarget] of Object.entries(UPDATER_TARGETS)) {
    const signature = platforms[platformKey].signature
    const first = signatureByTarget.get(baseTarget)
    if (first && first.signature !== signature) {
      throw new Error(`Updater signatures for ${first.platformKey} and ${platformKey} must match`)
    }
    signatureByTarget.set(baseTarget, { platformKey, signature })
  }
}

async function digestFile(path) {
  const hash = createHash('sha256')
  hash.update(await readFile(path))
  return hash.digest('hex')
}

function validatePackagedResourceManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('Packaged resource integrity manifest must be an object')
  }
  if (manifest.schemaVersion !== INTEGRITY_SCHEMA_VERSION) {
    throw new Error(`Unsupported packaged resource integrity schema version: ${String(manifest.schemaVersion)}`)
  }
  if (!Array.isArray(manifest.files)) {
    throw new Error('Packaged resource integrity manifest files must be an array')
  }

  const filesByPath = new Map()
  for (const entry of manifest.files) {
    if (!entry || typeof entry !== 'object') {
      throw new Error('Packaged resource integrity manifest contains an invalid file entry')
    }
    const { path, sha256, maxBytes } = entry
    if (typeof path !== 'string' || !PACKAGED_RESOURCE_PATH_SET.has(path)) {
      throw new Error(`Unexpected packaged resource manifest path: ${String(path)}`)
    }
    if (filesByPath.has(path)) {
      throw new Error(`Duplicate packaged resource manifest path: ${path}`)
    }
    if (typeof sha256 !== 'string' || !SHA256_PATTERN.test(sha256)) {
      throw new Error(`Invalid SHA-256 digest for packaged resource: ${path}`)
    }
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
      throw new Error(`Invalid maximum size for packaged resource: ${path}`)
    }
    filesByPath.set(path, entry)
  }

  for (const path of PACKAGED_RESOURCE_PATHS) {
    if (!filesByPath.has(path)) {
      throw new Error(`Missing packaged resource manifest path: ${path}`)
    }
  }
  if (manifest.files.length !== PACKAGED_RESOURCE_PATHS.length) {
    throw new Error(`Packaged resource integrity manifest must contain exactly ${PACKAGED_RESOURCE_PATHS.length} files`)
  }
  return filesByPath
}

async function collectPackagedResourcePaths(resourceRoot, sourceTree) {
  const paths = []
  async function visit(relativePath) {
    const absolutePath = join(resourceRoot, relativePath)
    const info = await lstat(absolutePath)
    if (info.isSymbolicLink()) {
      throw new Error(`Packaged resource must not be a symbolic link: ${relativePath}`)
    }
    if (info.isDirectory()) {
      if (PACKAGED_RESOURCE_PATH_SET.has(relativePath)) {
        throw new Error(`Packaged resource must be a regular file: ${relativePath}`)
      }
      if (relativePath !== '' && !PACKAGED_RESOURCE_DIRECTORY_PATH_SET.has(relativePath)) {
        throw new Error(`Extra packaged resource directory: ${relativePath}`)
      }
      const entries = await readdir(absolutePath)
      for (const entry of entries) {
        await visit(relativePath === '' ? entry : `${relativePath}/${entry}`)
      }
      return
    }
    if (!info.isFile()) {
      throw new Error(`Packaged resource must be a regular file: ${relativePath}`)
    }
    if (!PACKAGED_RESOURCE_PATH_SET.has(relativePath)) {
      throw new Error(`Extra packaged resource: ${relativePath}`)
    }
    paths.push(relativePath)
  }

  if (sourceTree) {
    for (const directory of PACKAGED_RESOURCE_DIRECTORIES) {
      await visit(directory)
    }
  } else {
    await visit('')
  }
  return paths
}

async function verifyResourceTree(resourceRoot, integrityManifestPath, sourceTree) {
  if (typeof resourceRoot !== 'string' || resourceRoot === '') {
    throw new Error('Packaged resource root is required')
  }
  if (typeof integrityManifestPath !== 'string' || integrityManifestPath === '') {
    throw new Error('Packaged resource integrity manifest path is required')
  }

  const manifest = JSON.parse(await readFile(integrityManifestPath, 'utf8'))
  const filesByPath = validatePackagedResourceManifest(manifest)
  const actualPaths = await collectPackagedResourcePaths(resourceRoot, sourceTree)
  const actualPathSet = new Set(actualPaths)
  if (actualPathSet.size !== actualPaths.length) {
    throw new Error('Duplicate packaged resource path discovered')
  }
  for (const path of PACKAGED_RESOURCE_PATHS) {
    const absolutePath = join(resourceRoot, path)
    let info
    try {
      info = await lstat(absolutePath)
    } catch (error) {
      if (error && typeof error === 'object' && error.code === 'ENOENT') {
        throw new Error(`Missing packaged resource: ${path}`)
      }
      throw error
    }
    if (info.isSymbolicLink()) {
      throw new Error(`Packaged resource must not be a symbolic link: ${path}`)
    }
    if (!info.isFile()) {
      throw new Error(`Packaged resource must be a regular file: ${path}`)
    }
    const { sha256, maxBytes } = filesByPath.get(path)
    if (info.size > maxBytes) {
      throw new Error(`Packaged resource exceeds maximum size: ${path}`)
    }
    if ((await digestFile(absolutePath)) !== sha256) {
      throw new Error(`Packaged resource SHA-256 mismatch: ${path}`)
    }
  }
  return { verifiedFiles: PACKAGED_RESOURCE_PATHS.length }
}

export async function verifyPackagedResources(resourceRoot, integrityManifestPath) {
  return verifyResourceTree(resourceRoot, integrityManifestPath, false)
}

async function verifyWindowsGuiExecutable(executablePath) {
  let executableInfo
  try {
    executableInfo = await lstat(executablePath)
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      throw new Error(`Windows executable is missing: ${executablePath}`)
    }
    throw error
  }
  if (executableInfo.isSymbolicLink()) {
    throw new Error(`Windows executable must not be a symbolic link: ${executablePath}`)
  }
  if (!executableInfo.isFile()) {
    throw new Error(`Windows executable must be a regular file: ${executablePath}`)
  }

  const executable = await readFile(executablePath)
  if (executable.length < PE_DOS_HEADER_SIZE) {
    throw new Error('Windows executable has a truncated DOS header')
  }
  if (executable.toString('ascii', 0, 2) !== 'MZ') {
    throw new Error('Windows executable is missing the DOS magic')
  }

  const peOffset = executable.readUInt32LE(0x3c)
  if (peOffset > MAX_PE_HEADER_OFFSET || peOffset + PE_COFF_HEADER_SIZE > executable.length) {
    throw new Error('Windows executable e_lfanew PE header offset is out of bounds')
  }
  if (executable.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0') {
    throw new Error('Windows executable is missing the PE signature')
  }
  if (executable.readUInt16LE(peOffset + 4) !== 0x8664) {
    throw new Error('Windows executable must use the AMD64 machine type')
  }

  const optionalHeaderSize = executable.readUInt16LE(peOffset + 20)
  const optionalHeaderOffset = peOffset + PE_COFF_HEADER_SIZE
  if (optionalHeaderSize < 2 || optionalHeaderOffset + optionalHeaderSize > executable.length) {
    throw new Error('Windows executable has a truncated optional header')
  }
  const optionalHeaderMagic = executable.readUInt16LE(optionalHeaderOffset)
  let fixedHeaderSize
  let numberOfRvaAndSizesOffset
  if (optionalHeaderMagic === 0x10b) {
    fixedHeaderSize = PE32_OPTIONAL_HEADER_FIXED_SIZE
    numberOfRvaAndSizesOffset = PE32_NUMBER_OF_RVA_AND_SIZES_OFFSET
  } else if (optionalHeaderMagic === 0x20b) {
    fixedHeaderSize = PE32_PLUS_OPTIONAL_HEADER_FIXED_SIZE
    numberOfRvaAndSizesOffset = PE32_PLUS_NUMBER_OF_RVA_AND_SIZES_OFFSET
  } else {
    throw new Error('Windows executable must use a PE32 or PE32+ optional header')
  }
  if (optionalHeaderSize < fixedHeaderSize) {
    throw new Error('Windows executable has a truncated optional header')
  }
  const dataDirectoryCount = executable.readUInt32LE(optionalHeaderOffset + numberOfRvaAndSizesOffset)
  if (optionalHeaderSize < fixedHeaderSize + dataDirectoryCount * PE_DATA_DIRECTORY_SIZE) {
    throw new Error('Windows executable has a truncated optional header')
  }
  if (executable.readUInt16LE(optionalHeaderOffset + PE_OPTIONAL_HEADER_SUBSYSTEM_OFFSET) !== 2) {
    throw new Error('Windows executable must use the Windows GUI subsystem (2)')
  }
}

async function verifySourceResourceTree(resourceRoot, integrityManifestPath) {
  return verifyResourceTree(resourceRoot, integrityManifestPath, true)
}

async function verifyUpdaterArtifacts(directory, tag, updater, signatureVerifier, tauriConfig) {
  if (!signatureVerifier || !tauriConfig) {
    throw new Error('Directory verification requires --signature-verifier and --tauri-config')
  }
  const version = versionFromTag(tag)
  for (const [baseTarget, target] of Object.entries(TARGETS)) {
    const updaterName = exactName(version, target.updaterSuffix)
    const signatureName = `${updaterName}.sig`
    const signaturePath = join(directory, signatureName)
    const signatureInfo = await stat(signaturePath)
    if (!signatureInfo.isFile() || signatureInfo.size <= 0 || signatureInfo.size > 16 * 1024) {
      throw new Error(`Updater signature companion must be a bounded non-empty regular file: ${signatureName}`)
    }
    const companionSignature = (await readFile(signaturePath, 'utf8')).trimEnd()
    for (const [platformKey, mappedTarget] of Object.entries(UPDATER_TARGETS)) {
      if (mappedTarget !== baseTarget) continue
      if (updater.platforms[platformKey].signature !== companionSignature) {
        throw new Error(`Updater signature for ${platformKey} does not match its companion .sig: ${signatureName}`)
      }
    }

    const verification = spawnSync(signatureVerifier, [tauriConfig, join(directory, updaterName), signaturePath], {
      encoding: 'utf8',
      shell: false,
      maxBuffer: 64 * 1024,
    })
    if (verification.error || verification.status !== 0) {
      throw new Error(`Cryptographic updater signature verification failed for ${updaterName}`)
    }
  }
}

async function fixtureFromDirectory(directory, tag, writeChecksums, signatureVerifier, tauriConfig) {
  const names = (await readdir(directory)).sort()
  assertExactDirectoryInventory(names, tag, !writeChecksums)
  if (writeChecksums && names.includes('SHA256SUMS')) {
    throw new Error('Refusing to overwrite an existing SHA256SUMS')
  }
  const updater = JSON.parse(await readFile(join(directory, 'latest.json'), 'utf8'))
  assertCanonicalUpdaterManifest(updater, tag)
  await verifyUpdaterArtifacts(directory, tag, updater, signatureVerifier, tauriConfig)
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
  return { tag, assets, updater }
}

async function normalizeUpdaterInDirectory(directory, tag) {
  const names = (await readdir(directory)).sort()
  assertExactDirectoryInventory(names, tag, false)
  const updaterPath = join(directory, 'latest.json')
  const info = await stat(updaterPath)
  if (!info.isFile() || info.size <= 0) {
    throw new Error('latest.json must be a non-empty regular file')
  }
  const updater = JSON.parse(await readFile(updaterPath, 'utf8'))
  const normalized = normalizeUpdaterManifest(updater, tag)
  await writeFile(updaterPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
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
  const packagedResourceRoot = readOption(args, '--packaged-resource-root')
  const sourceResourceRoot = readOption(args, '--source-resource-root')
  const integrityManifest = readOption(args, '--integrity-manifest')
  const peExecutable = readOption(args, '--pe-executable')
  if (packagedResourceRoot || sourceResourceRoot || integrityManifest || peExecutable) {
    if ((packagedResourceRoot ? 1 : 0) + (sourceResourceRoot ? 1 : 0) !== 1 || !integrityManifest) {
      throw new Error('Use exactly one of --packaged-resource-root or --source-resource-root with --integrity-manifest')
    }
    if (peExecutable && !packagedResourceRoot) {
      throw new Error('--pe-executable requires --packaged-resource-root')
    }
    if (fixturePath || directory) {
      throw new Error('Packaged resource verification cannot be combined with release asset verification')
    }
    if (peExecutable) await verifyWindowsGuiExecutable(peExecutable)
    const result = packagedResourceRoot
      ? await verifyPackagedResources(packagedResourceRoot, integrityManifest)
      : await verifySourceResourceTree(sourceResourceRoot, integrityManifest)
    process.stdout.write(`Verified ${result.verifiedFiles} packaged resource files\n`)
    return
  }
  if ((fixturePath ? 1 : 0) + (directory ? 1 : 0) !== 1) {
    throw new Error('Use exactly one of --fixture or --directory')
  }
  let fixture
  if (fixturePath) {
    fixture = JSON.parse(await readFile(fixturePath, 'utf8'))
  } else {
    const tag = readOption(args, '--tag')
    if (!tag) throw new Error('--directory requires --tag')
    if (args.includes('--normalize-updater')) {
      if (args.includes('--write-checksums')) {
        throw new Error('--normalize-updater and --write-checksums are separate operations')
      }
      await normalizeUpdaterInDirectory(directory, tag)
      process.stdout.write(`Normalized updater metadata for ${tag}\n`)
      return
    }
    fixture = await fixtureFromDirectory(
      directory,
      tag,
      args.includes('--write-checksums'),
      readOption(args, '--signature-verifier'),
      readOption(args, '--tauri-config'),
    )
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
