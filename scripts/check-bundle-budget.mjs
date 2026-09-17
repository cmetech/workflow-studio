import { gzipSync } from 'node:zlib'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const MAX_MINIFIED_BYTES = 2_000_000
const MAX_GZIP_BYTES = 450_000

const coldSourceGroups = [
  ['documentation markdown', [/^docs\/app-guides\/.*\.md\?raw$/i]],
  ['documentation UI', [/^src\/features\/documentation\/DocumentationView\.svelte$/i]],
  [
    'settings/branding',
    [
      /^src\/features\/settings\/SettingsPage\.svelte$/i,
      /^src\/features\/settings\/ContractSettingsHost\.svelte$/i,
      /^src\/features\/settings\/UpdateSettings\.svelte$/i,
      /^src\/features\/branding\/AppearanceSettings\.svelte$/i,
      /^src\/features\/branding\/BrandSettings\.svelte$/i,
      /^src\/features\/branding\/BrandPreview\.svelte$/i,
    ],
  ],
  ['Example Gallery', [/^src\/features\/examples\/ExampleGallery\.svelte$/i]],
  ['Git history UI', [/^src\/features\/version-control\/GitView\.svelte$/i]],
  ['CodeMirror editor', [/^src\/features\/editor\/EditorModes\.svelte$/i]],
  ['Svelte Flow editor', [/^src\/features\/canvas\/GraphCanvas\.svelte$/i]],
]

const forbiddenContents = [
  ['settings/branding', /Brand and theme packs/],
  ['CodeMirror', /CodeMirror/],
  ['Svelte Flow', /svelte-flow__renderer/],
  ['ELK', /org\.eclipse\.elk/],
]

function normalizePath(path) {
  return path.split(sep).join('/')
}

/**
 * Analyze the files fetched by application startup. Vite represents the
 * intentional bootstrap imports in the HTML entry's `dynamicImports`; dynamic
 * imports below those modules are user-activated surfaces and stay outside the
 * startup closure.
 *
 * @param {string} manifestPath
 * @param {{ maxMinifiedBytes?: number, maxGzipBytes?: number }} [limits]
 */
export function analyzeBundleBudget(manifestPath, limits = {}) {
  const absoluteManifest = isAbsolute(manifestPath) ? manifestPath : join(process.cwd(), manifestPath)
  const outputRoot = dirname(dirname(absoluteManifest))
  const manifest = JSON.parse(readFileSync(absoluteManifest, 'utf8'))
  const initialKeys = new Set()
  const initialFiles = new Set()

  function visit(key, startupRoot = false) {
    const entry = manifest[key]
    if (!entry) throw new Error(`Bundle manifest references missing entry: ${key}`)
    if (initialKeys.has(key)) return
    initialKeys.add(key)
    initialFiles.add(entry.file)
    for (const file of entry.css ?? []) initialFiles.add(file)
    for (const imported of entry.imports ?? []) visit(imported)
    if (startupRoot) for (const imported of entry.dynamicImports ?? []) visit(imported)
  }

  for (const [key, entry] of Object.entries(manifest)) if (entry.isEntry) visit(key, true)
  if (initialKeys.size === 0) throw new Error('Bundle manifest does not declare an entry module.')

  const violations = []
  let minifiedBytes = 0
  let gzipBytes = 0
  for (const file of initialFiles) {
    const bytes = readFileSync(join(outputRoot, file))
    minifiedBytes += bytes.byteLength
    gzipBytes += gzipSync(bytes).byteLength
    const source = bytes.toString('utf8')
    for (const [label, pattern] of forbiddenContents) {
      if (pattern.test(source)) violations.push(`Initial renderer closure contains ${label} in ${file}.`)
    }
  }
  for (const [label, patterns] of coldSourceGroups) {
    for (const pattern of patterns) {
      const matches = Object.keys(manifest).filter((key) => pattern.test(key))
      if (matches.length === 0) {
        violations.push(`Bundle manifest has no deferred source evidence for ${label} matching ${pattern}.`)
        continue
      }
      for (const key of matches) {
        const entry = manifest[key]
        if (!entry.isDynamicEntry || initialKeys.has(key) || initialFiles.has(entry.file))
          violations.push(`Initial renderer closure contains ${label} through ${key}.`)
      }
    }
  }

  const maxMinifiedBytes = limits.maxMinifiedBytes ?? MAX_MINIFIED_BYTES
  const maxGzipBytes = limits.maxGzipBytes ?? MAX_GZIP_BYTES
  if (minifiedBytes > maxMinifiedBytes)
    violations.push(`Initial renderer closure is ${minifiedBytes} bytes; limit is ${maxMinifiedBytes} bytes.`)
  if (gzipBytes > maxGzipBytes)
    violations.push(`Initial renderer closure gzip is ${gzipBytes} bytes; limit is ${maxGzipBytes} bytes.`)

  const elkAlgorithmFiles = []
  const assetRoot = join(outputRoot, 'assets')
  for (const entry of Object.values(manifest)) {
    const file = entry.file
    if (!file?.endsWith('.js')) continue
    const source = readFileSync(join(outputRoot, file), 'utf8')
    if (!source.includes('org.eclipse.elk.alg.layered')) continue
    if (!elkAlgorithmFiles.includes(file)) elkAlgorithmFiles.push(file)
    if (!/^assets\/elk-engine-worker(?:-.*)?\.js$/.test(file))
      violations.push(`ELK algorithm code escaped its descendant worker into ${file}.`)
  }
  // Workers are emitted outside the manifest. Inspect every JavaScript asset so
  // the worker-only assertion cannot be bypassed by a missing manifest entry.
  for (const name of readdirSync(assetRoot)) {
    if (!name.endsWith('.js')) continue
    const file = `assets/${name}`
    const source = readFileSync(join(assetRoot, name), 'utf8')
    if (!source.includes('org.eclipse.elk.alg.layered')) continue
    if (!elkAlgorithmFiles.includes(file)) elkAlgorithmFiles.push(file)
    if (!/^elk-engine-worker(?:-.*)?\.js$/.test(name))
      violations.push(`ELK algorithm code escaped its descendant worker into ${file}.`)
  }
  if (elkAlgorithmFiles.length !== 1)
    violations.push(`Expected one ELK algorithm worker asset; found ${elkAlgorithmFiles.length}.`)

  return {
    manifestPath: normalizePath(relative(process.cwd(), absoluteManifest)),
    initialFiles: [...initialFiles].sort(),
    minifiedBytes,
    gzipBytes,
    elkAlgorithmFiles: elkAlgorithmFiles.sort(),
    violations: [...new Set(violations)],
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  const result = analyzeBundleBudget(process.argv[2] ?? 'dist/.vite/manifest.json')
  process.stdout.write(
    `Initial renderer closure: ${result.minifiedBytes} bytes minified, ${result.gzipBytes} bytes gzip\n${result.initialFiles.join('\n')}\n`,
  )
  if (result.violations.length > 0) {
    process.stderr.write(`${result.violations.join('\n')}\n`)
    process.exitCode = 1
  }
}
