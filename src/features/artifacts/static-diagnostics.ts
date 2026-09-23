import { pythonLanguage } from '@codemirror/lang-python'
import { javascriptLanguage, typescriptLanguage } from '@codemirror/lang-javascript'
import { jsonLanguage } from '@codemirror/lang-json'
import { parseAllDocuments } from 'yaml'
import type { ArtifactLanguage } from '$src/lib/artifacts/types'
import type { ArtifactStaticAnalysis } from '$src/lib/packages/readiness'
import packageContract from '../../../contracts/workflow-package-v1.json'

export interface ArtifactDiagnostic {
  readonly from: number
  readonly to: number
  readonly line: number
  readonly column: number
  readonly code: string
  readonly message: string
}

/** Parsing only: no native bridge, runtime, compiler process or language server. */
export function staticDiagnostics(language: ArtifactLanguage, text: string): readonly ArtifactDiagnostic[] {
  const diagnostics: ArtifactDiagnostic[] = []
  const starts = [0]
  const add = (from: number, to: number, message = 'Syntax error', code = 'artifact_syntax_invalid') => {
    from = Math.max(0, Math.min(from, text.length))
    to = Math.max(from, Math.min(to, text.length))
    let low = 0,
      high = starts.length
    while (low + 1 < high) {
      const middle = (low + high) >>> 1
      if (starts[middle]! <= from) low = middle
      else high = middle
    }
    if (diagnostics.length < 200)
      diagnostics.push({ from, to, line: low + 1, column: from - starts[low]! + 1, code, message })
  }
  if (new TextEncoder().encode(text).byteLength > packageContract.resource_rules.max_file_bytes) {
    add(0, 0, 'Artifact exceeds the static analysis limit.', 'artifact_analysis_limit')
    return diagnostics
  }
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1)
  if (/[\ud800-\udfff]/u.test(text)) {
    add(0, 0, 'Text contains an unpaired Unicode surrogate.')
    return diagnostics
  }
  if (language === 'yaml') {
    const documents = parseAllDocuments(text, { uniqueKeys: true, strict: true, prettyErrors: false })
    if (documents.length !== 1) add(0, 0, 'Resource must contain exactly one YAML document.')
    for (const document of documents) {
      for (const error of [...document.errors, ...document.warnings]) add(error.pos[0], error.pos[1], error.message)
      if (!document.errors.length) {
        try {
          document.toJS({ maxAliasCount: 100 })
        } catch {
          add(0, 0, 'YAML alias expansion exceeds the analysis limit.')
        }
      }
    }
  } else {
    const parser = {
      python: pythonLanguage.parser,
      javascript: javascriptLanguage.parser,
      typescript: typescriptLanguage.parser,
      json: jsonLanguage.parser,
    }[language as 'python' | 'javascript' | 'typescript' | 'json']
    parser?.parse(text).iterate({
      enter(node) {
        if (node.type.isError) add(node.from, node.to)
      },
    })
    if (language === 'json' && !diagnostics.length) {
      try {
        JSON.parse(text)
      } catch {
        add(0, Math.min(text.length, 1), 'Syntax error in JSON.')
      }
    }
  }
  return Object.freeze(diagnostics.map((diagnostic) => Object.freeze(diagnostic)))
}

export function analyzeArtifactSyntax(path: string, language: ArtifactLanguage, text: string): ArtifactStaticAnalysis {
  const diagnostics = staticDiagnostics(language, text)
  return Object.freeze({
    path,
    sourceText: text,
    structurallyValid: diagnostics.length === 0,
    findings: Object.freeze(
      diagnostics.map((diagnostic) =>
        Object.freeze({
          code: diagnostic.code,
          path,
          message: diagnostic.message,
          severity: 'blocking' as const,
          line: diagnostic.line,
          column: diagnostic.column,
        }),
      ),
    ),
  })
}
