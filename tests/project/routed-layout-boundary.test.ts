// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let output: string
let assets: Map<string, string>

beforeAll(() => {
  output = mkdtempSync(join(tmpdir(), 'workflow-studio-routing-boundary-'))
  execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', output], {
    stdio: 'pipe',
    timeout: 90_000,
  })
  assets = new Map(
    readdirSync(join(output, 'assets'))
      .filter((file) => /\.(js|css)$/.test(file))
      .map((file) => [file, readFileSync(join(output, 'assets', file), 'utf8')]),
  )
}, 100_000)
afterAll(() => {
  if (output) rmSync(output, { recursive: true, force: true })
})

describe('[RG13] production routed-layout asset boundary', () => {
  it('keeps ELK exclusively in the lazy descendant worker, outside the initial renderer manifest closure', () => {
    const manifest = JSON.parse(readFileSync(join(output, '.vite/manifest.json'), 'utf8')) as Record<
      string,
      { file: string; isEntry?: boolean; imports?: string[] }
    >
    const initial = new Set<string>()
    const visit = (key: string): void => {
      const entry = manifest[key]!
      if (initial.has(entry.file)) return
      initial.add(entry.file)
      entry.imports?.forEach(visit)
    }
    Object.entries(manifest)
      .filter(([, entry]) => entry.isEntry)
      .forEach(([key]) => visit(key))
    expect(initial.size).toBeGreaterThan(0)
    for (const file of initial) expect(readFileSync(join(output, file), 'utf8')).not.toContain('org.eclipse.elk')
    const algorithms = [...assets].filter(([, source]) => source.includes('org.eclipse.elk.alg.layered'))
    expect(algorithms.map(([name]) => name)).toEqual([expect.stringMatching(/^elk-engine-worker-.*\.js$/)])
    for (const [name, source] of assets) {
      if (!/^(elk-engine-worker|layout-worker)-/.test(name)) expect(source, name).not.toContain('org.eclipse.elk')
    }
    const layoutWorker = [...assets].find(([name]) => /^layout-worker-.*\.js$/.test(name))!
    expect(layoutWorker).toBeDefined()
    expect(layoutWorker[1]).toContain(algorithms[0]![0])
    expect([...initial].some((file) => file.includes('layout-worker') || file.includes('elk-engine-worker'))).toBe(
      false,
    )
    // External documentation, license and schema identifiers are inert bundled text.
    // Executable module/worker imports and CSS resource loads must be local.
    const externalLoads =
      /(?:\b(?:import|from)\s*\(?\s*|\b(?:Worker|SharedWorker)\s*\(\s*|\bimportScripts\s*\(\s*|url\(\s*)["']?(?:https?:)?\/\//g
    for (const [name, source] of assets) expect(source.match(externalLoads), name).toBeNull()
  })

  it('pins ELK 0.12.0, removes Dagre, and keeps the Svelte Flow attribution configuration visible', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
    expect(pkg.dependencies.elkjs).toBe('0.12.0')
    expect(lock.packages['node_modules/elkjs'].version).toBe('0.12.0')
    expect(Object.keys(lock.packages).filter((key) => /dagre|graphlib/.test(key))).toEqual([])
    const canvas = readFileSync('src/features/canvas/GraphCanvas.svelte', 'utf8')
    expect(canvas).not.toMatch(/hideAttribution\s*[:=]\s*(?:true|\{true\})/)
    expect([...assets.values()].join('\n')).not.toMatch(/\.svelte-flow__attribution\s*\{[^}]*display\s*:\s*none/)
  })
})
