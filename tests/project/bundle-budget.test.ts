import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { analyzeBundleBudget } from '../../scripts/check-bundle-budget.mjs'

function fixtureBundle(
  options: {
    coldInInitial?: boolean
    oversized?: boolean
    orphanElkWorker?: boolean
    elkModuleInStartup?: boolean
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'workflow-studio-bundle-'))
  const assets = join(root, 'assets')
  const vite = join(root, '.vite')
  const elkProvenance = join(vite, 'elk-provenance')
  mkdirSync(assets)
  mkdirSync(vite)
  mkdirSync(elkProvenance)
  const initialSource = options.coldInInitial
    ? 'const cold = "Brand and theme packs"; const codemirror = "CodeMirror";'
    : 'export const welcome = "Open Folder";'
  writeFileSync(join(assets, 'index.js'), options.oversized ? 'x'.repeat(2_100_000) : initialSource)
  writeFileSync(join(assets, 'app.js'), 'export const app = true;')
  writeFileSync(join(assets, 'app.css'), '.app{display:block}')
  writeFileSync(join(assets, 'settings.js'), 'export const settings = "Brand and theme packs";')
  const coldSources = [
    'docs/app-guides/quick-start.md?raw',
    'src/features/documentation/DocumentationView.svelte',
    'src/features/settings/SettingsPage.svelte',
    'src/features/settings/ContractSettingsHost.svelte',
    'src/features/settings/UpdateSettings.svelte',
    'src/features/branding/AppearanceSettings.svelte',
    'src/features/branding/BrandSettings.svelte',
    'src/features/branding/BrandPreview.svelte',
    'src/features/examples/ExampleGallery.svelte',
    'src/features/version-control/GitView.svelte',
    'src/features/editor/EditorModes.svelte',
    'src/features/canvas/GraphCanvas.svelte',
  ]
  const coldManifest = Object.fromEntries(
    coldSources.map((source, index) => {
      const file =
        source === 'src/features/settings/SettingsPage.svelte' ? 'assets/settings.js' : `assets/cold-${index}.js`
      if (source === 'src/features/canvas/GraphCanvas.svelte') {
        writeFileSync(
          join(root, file),
          'const layout = new Worker(new URL("/assets/layout-worker.js", import.meta.url), { type: "module" });',
        )
      } else if (file !== 'assets/settings.js') writeFileSync(join(root, file), `export const cold${index} = true;`)
      return [source, { file, isDynamicEntry: true }]
    }),
  )
  writeFileSync(
    join(assets, 'layout-worker.js'),
    options.orphanElkWorker
      ? 'export const layout = true;'
      : 'const engine = new Worker(new URL("/assets/elk-engine-worker.js", import.meta.url), { type: "module" });',
  )
  writeFileSync(join(assets, 'elk-engine-worker.js'), 'const algorithm = "org.eclipse.elk.alg.layered";')
  writeFileSync(
    join(elkProvenance, 'worker-chain.json'),
    JSON.stringify({
      version: 1,
      chunks: {
        'assets/layout-worker.js': ['node_modules/elkjs/lib/elk-api.js'],
        'assets/elk-engine-worker.js': ['node_modules/elkjs/lib/elk-worker.min.js'],
        ...(options.elkModuleInStartup
          ? { 'assets/index.js': ['node_modules/elkjs/lib/unmarked-startup-copy.js'] }
          : {}),
      },
    }),
  )
  writeFileSync(
    join(vite, 'manifest.json'),
    JSON.stringify({
      'index.html': {
        file: 'assets/index.js',
        isEntry: true,
        dynamicImports: ['src/app/App.svelte'],
      },
      'src/app/App.svelte': {
        file: 'assets/app.js',
        imports: options.coldInInitial ? ['index.html', 'src/features/settings/SettingsPage.svelte'] : ['index.html'],
        css: ['assets/app.css'],
        dynamicImports: coldSources,
      },
      ...coldManifest,
    }),
  )
  return join(vite, 'manifest.json')
}

describe('initial renderer bundle budget', () => {
  it('follows startup imports but not cold surface imports and accounts for emitted CSS', () => {
    const result = analyzeBundleBudget(fixtureBundle())

    expect(result.initialFiles).toEqual(['assets/app.css', 'assets/app.js', 'assets/index.js'])
    expect(result.minifiedBytes).toBeGreaterThan(0)
    expect(result.gzipBytes).toBeGreaterThan(0)
    expect(result.violations).toEqual([])
  })

  it('reports cold-only renderer code in the startup closure independently of the size budget', () => {
    const result = analyzeBundleBudget(fixtureBundle({ coldInInitial: true }))

    expect(result.violations).toEqual(
      expect.arrayContaining([expect.stringMatching(/settings\/branding/i), expect.stringMatching(/CodeMirror/i)]),
    )
  })

  it('rejects an initial entry closure above the minified limit', () => {
    const result = analyzeBundleBudget(fixtureBundle({ oversized: true }))

    expect(result.violations).toContain('Initial renderer closure is 2100043 bytes; limit is 2000000 bytes.')
  })

  it('rejects an ELK-looking asset that is not the sole descendant worker of the emitted layout worker', () => {
    const result = analyzeBundleBudget(fixtureBundle({ orphanElkWorker: true }))

    expect(result.violations).toContain(
      'The emitted layout worker does not create the sole ELK algorithm worker asset.',
    )
  })

  it('rejects unmarked elkjs module provenance outside the descendant ELK worker', () => {
    const result = analyzeBundleBudget(fixtureBundle({ elkModuleInStartup: true }))

    expect(result.violations).toContain(
      'ELK runtime module node_modules/elkjs/lib/unmarked-startup-copy.js escaped the GraphCanvas worker chain into assets/index.js.',
    )
  })

  it('keeps the real production entry within budget and every ELK algorithm in a worker asset', () => {
    const result = analyzeBundleBudget('dist/.vite/manifest.json')

    expect(result.violations).toEqual([])
    expect(result.elkAlgorithmFiles).toEqual([expect.stringMatching(/^assets\/elk-engine-worker-.*\.js$/)])
    expect(result.elkRuntimeModules).toEqual([
      'node_modules/elkjs/lib/elk-api.js',
      'node_modules/elkjs/lib/elk-worker.min.js',
    ])
  })
})
