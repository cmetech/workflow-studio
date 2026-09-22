import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import ts from 'typescript'

/** Reviewed rendering/parsing dependencies. A new runtime dependency requires security review. */
const allowedDependencies = new Set([
  'svelte',
  'lucide-svelte/icons/arrow-left',
  'svelte/store',
  'nanostores',
  '@nanostores/svelte',
  'yaml',
  'ajv/dist/2020.js',
  'codemirror',
  'dompurify',
  'marked',
  '@codemirror/lang-javascript',
  '@codemirror/lang-python',
  '@codemirror/lang-markdown',
  '@codemirror/lang-json',
  '@codemirror/lang-yaml',
  '@codemirror/state',
  '@codemirror/view',
  '@codemirror/search',
  '@codemirror/lint',
  '@codemirror/commands',
  '@codemirror/autocomplete',
  '@codemirror/language',
  '@lezer/common',
])
const forbiddenGlobals = new Set([
  'eval',
  'Function',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'Worker',
  'SharedWorker',
])
export interface ExecutionSurfaceAudit {
  readonly files: readonly string[]
  readonly violations: readonly string[]
}
/** Audit runtime source imports and explicit execution capabilities without evaluating any source module. */
export function auditPackageExecutionSurface(entryFiles: readonly string[]): ExecutionSurfaceAudit {
  const files = new Set<string>(),
    violations: string[] = []
  const queue = entryFiles.map((file) => resolve(file))
  function dependency(from: string, specifier: string) {
    const clean = specifier.split('?')[0]!
    if (!clean.startsWith('.') && !clean.startsWith('$src/')) {
      if (!allowedDependencies.has(clean)) violations.push(from + ': unreviewed runtime import ' + specifier)
      return
    }
    const base = clean.startsWith('$src/') ? resolve('src', clean.slice(5)) : resolve(dirname(from), clean)
    const candidates = [base, base + '.ts', base + '.svelte', resolve(base, 'index.ts')]
    const found = candidates.find(
      (candidate) =>
        existsSync(candidate) &&
        ['.ts', '.svelte', '.json', '.yaml', '.md', '.css', '.svg'].includes(extname(candidate)),
    )
    if (!found) {
      violations.push(from + ': unresolved runtime import ' + specifier)
      return
    }
    // Raw assets are data. They must never be recursively treated as executable source.
    if (specifier.includes('?raw') || !['.ts', '.svelte'].includes(extname(found))) return
    queue.push(found)
  }
  while (queue.length) {
    const path = queue.shift()!
    if (files.has(path)) continue
    files.add(path)
    const text = readFileSync(path, 'utf8')
    const code = path.endsWith('.svelte')
      ? [...text.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map((match) => match[1]).join('\n')
      : text
    const source = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    function visit(node: ts.Node) {
      if (ts.isTypeNode(node)) return
      if (ts.isImportDeclaration(node)) {
        const clause = node.importClause
        if (clause?.isTypeOnly) return
        if (
          clause?.namedBindings &&
          ts.isNamedImports(clause.namedBindings) &&
          !clause.name &&
          clause.namedBindings.elements.every((item) => item.isTypeOnly)
        )
          return
        if (ts.isStringLiteral(node.moduleSpecifier)) dependency(path, node.moduleSpecifier.text)
        return
      }
      if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
        if (node.isTypeOnly) return
        if (
          node.exportClause &&
          ts.isNamedExports(node.exportClause) &&
          node.exportClause.elements.every((item) => item.isTypeOnly)
        )
          return
        if (ts.isStringLiteral(node.moduleSpecifier)) dependency(path, node.moduleSpecifier.text)
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const target = node.arguments[0]
        if (target && ts.isStringLiteral(target)) dependency(path, target.text)
        else violations.push(path + ': dynamic import of authored/nonliteral source')
      }
      // Only this packaged, literal module worker is trusted. Traverse its code too.
      if (
        ts.isNewExpression(node) &&
        path === resolve('src/features/packages/package-analysis-client.ts') &&
        node.getText(source).replace(/\s/g, '') ===
          "newWorker(newURL('./package-analysis-worker.ts',import.meta.url),{type:'module'})"
      ) {
        dependency(path, './package-analysis-worker.ts')
        return
      }
      if (ts.isIdentifier(node) && forbiddenGlobals.has(node.text))
        violations.push(path + ': forbidden execution/network capability ' + node.text)
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return { files: [...files].sort(), violations: [...new Set(violations)].sort() }
}
