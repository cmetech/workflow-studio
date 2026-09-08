// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import ts from 'typescript'

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

describe('routed-layout requirement traceability', () => {
  it('defines each Arrange failure announcement in the authoritative feedback section and explains interruption offline', () => {
    const canvas = readFileSync('src/features/canvas/GraphCanvas.svelte', 'utf8')
    const script = canvas.match(/<script[^>]*>([^]*?)<\/script>/)![1]!
    const source = ts.createSourceFile('GraphCanvas.ts', script, ts.ScriptTarget.Latest, true)
    const messages: string[] = []
    const visit = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text.startsWith('ARRANGE_') &&
        node.initializer &&
        ts.isStringLiteralLike(node.initializer)
      )
        messages.push(node.initializer.text)
      ts.forEachChild(node, visit)
    }
    visit(source)
    expect(messages.length).toBeGreaterThan(0)
    const spec = readFileSync('docs/superpowers/specs/2026-09-07-routed-arrange-graph-design.md', 'utf8')
    const feedback = spec.split('### 5.3 Layout failure')[1]!.split('## 6.')[0]!
    for (const message of messages) expect(feedback).toContain(message)
    const guide = readFileSync('docs/app-guides/dag-dependencies.md', 'utf8')
    expect(guide).toContain('Arrange Graph was interrupted after updating the canvas.')
    expect(guide).toContain('does not finish saving its layout')
  })

  it('links each approved plan and design requirement to an active behavior test title', () => {
    const required = [
      'RG1',
      'RG2',
      'RG3',
      'RG4',
      'RG5',
      'RG6',
      'RG7',
      'RG8',
      'RG9',
      'RG10',
      'RG11',
      'RG12',
      'RG13',
      'RG14',
    ]
    for (const path of [
      'docs/superpowers/specs/2026-09-07-routed-arrange-graph-design.md',
      'docs/superpowers/plans/2026-09-07-routed-arrange-graph.md',
    ]) {
      const rows = [...readFileSync(path, 'utf8').matchAll(/^\| (RG\d+)\b.*\|$/gm)].map((row) => row[1])
      expect(new Set(rows), path).toEqual(new Set(required))
    }

    const evidence = new Set<string>()
    // Read test declarations, not comments, helper strings, or this project's own requirement list.
    for (const root of ['src', 'tests/e2e', 'tests/performance', 'tests/accessibility']) {
      for (const file of readdirSync(root, { recursive: true, encoding: 'utf8' })) {
        if (!/\.(test|spec)\.ts$/.test(file)) continue
        const path = join(root, file)
        const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
        const visit = (node: ts.Node): void => {
          if (
            ts.isCallExpression(node) &&
            ts.isIdentifier(node.expression) &&
            ['it', 'test'].includes(node.expression.text)
          ) {
            const [title, body] = node.arguments
            if (
              title &&
              ts.isStringLiteralLike(title) &&
              body &&
              (ts.isArrowFunction(body) || ts.isFunctionExpression(body))
            ) {
              for (const match of title.text.matchAll(/\[(RG\d+)\]/g)) evidence.add(match[1]!)
            }
          }
          ts.forEachChild(node, visit)
        }
        visit(source)
      }
    }
    for (const id of required) expect(evidence.has(id), `${id} has no active behavior test title`).toBe(true)
  })
})

describe('[RG13] production routed-layout asset boundary', () => {
  it('ships the exact ELK license, upstream notices, and pinned source acquisition information offline', () => {
    const upstreamLicense = readFileSync('node_modules/elkjs/LICENSE.md')
    const upstreamApi = readFileSync('node_modules/elkjs/lib/elk-api.js', 'utf8')
    const upstreamNotices = upstreamApi.match(/\/\*\*[^]*?Copyright[^]*?\*\//g)!
    expect(upstreamNotices.length).toBeGreaterThan(0)
    const notice = readFileSync('docs/licenses/ELK-NOTICE.txt', 'utf8')
    for (const upstreamNotice of upstreamNotices) expect(notice).toContain(upstreamNotice)
    expect(notice).toContain('elkjs 0.12.0')
    expect(notice).toContain('Source Code is available under the Eclipse Public License 2.0')
    expect(notice).toContain('https://registry.npmjs.org/elkjs/-/elkjs-0.12.0.tgz')
    expect(notice).toContain('https://github.com/kieler/elkjs/tree/ff5771d7165445c42c408bb8a090c8035272218c')
    expect(notice).toContain('https://github.com/eclipse-elk/elk/tree/v0.12.0')
    for (const root of ['docs/licenses', 'public/licenses', join(output, 'licenses')]) {
      expect(readFileSync(join(root, 'ELK-EPL-2.0.txt'))).toEqual(upstreamLicense)
      expect(readFileSync(join(root, 'ELK-NOTICE.txt'), 'utf8')).toBe(notice)
    }
  })

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
