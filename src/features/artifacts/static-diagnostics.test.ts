import { describe, expect, it } from 'vitest'
import { analyzeArtifactSyntax, staticDiagnostics } from './static-diagnostics'

describe('offline artifact diagnostics', () => {
  it.each([
    ['python', 'def broken(:\n'],
    ['typescript', 'const value: = 1'],
    ['javascript', 'function broken( {'],
    ['json', '{"broken":}'],
    ['yaml', 'key: [unfinished'],
  ] as const)('reports %s parser errors with bounded source locations', (language, text) => {
    const analysis = analyzeArtifactSyntax(`broken.${language}`, language, text)
    expect(analysis.structurallyValid).toBe(false)
    expect(analysis.sourceText).toBe(text)
    expect(analysis.findings[0]).toMatchObject({ path: `broken.${language}`, severity: 'blocking' })
    for (const diagnostic of staticDiagnostics(language, text)) {
      expect(diagnostic.from).toBeGreaterThanOrEqual(0)
      expect(diagnostic.to).toBeLessThanOrEqual(text.length)
      expect(diagnostic.line).toBeGreaterThan(0)
    }
  })
  it.each([
    ['python', 'import json\nprint(json.dumps({"ok": True}))\n'],
    ['typescript', 'const value: number = 1'],
    ['javascript', 'function valid() { return 1; }'],
    ['json', '{"ok":true}'],
    ['yaml', 'ok: true\n'],
    ['markdown', '# Heading\n<script>not executed</script>'],
    ['text', 'Anything is text ('],
  ] as const)('accepts valid %s text without executing it', (language, text) => {
    expect(analyzeArtifactSyntax('resource', language, text).findings).toEqual([])
  })
  it('rejects duplicate YAML keys, multiple documents and excessive input without normalization', () => {
    for (const text of ['key: 1\nkey: 2', 'a: 1\n---\nb: 2'])
      expect(analyzeArtifactSyntax('mcp/a.yaml', 'yaml', text).structurallyValid).toBe(false)
    expect(analyzeArtifactSyntax('huge.py', 'python', 'x'.repeat(1048577)).findings[0]?.code).toBe(
      'artifact_analysis_limit',
    )
  })
})
