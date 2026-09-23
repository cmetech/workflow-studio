import Ajv2020 from 'ajv/dist/2020.js'
import { parseAllDocuments } from 'yaml'
import type { ArtifactStaticAnalysis } from './readiness'
import type { PackageFinding } from './types'
import { freezePackageValue } from '../package-contract/package-contract-loader'
import packageContract from '../../../contracts/workflow-package-v1.json'

export interface CommandMarkdownAnalysis extends ArtifactStaticAnalysis {
  readonly body: string
  readonly bodyOffset: number
  readonly frontmatter: Readonly<Record<string, unknown>> | null
  readonly schemaValidated: boolean
}
/** Preserves authored bytes. A missing upstream schema never becomes a Studio-owned key inventory. */
export function analyzeCommandMarkdown(path: string, text: string, schema?: object): CommandMarkdownAnalysis {
  const findings: PackageFinding[] = []
  let body = text,
    bodyOffset = 0,
    frontmatter: Record<string, unknown> | null = null,
    schemaValidated = false
  const add = (code: string, message: string, line = 1, column = 1) =>
    findings.push({ code, message, path, severity: 'blocking', line, column })
  if (new TextEncoder().encode(text).byteLength > packageContract.resource_rules.max_file_bytes) {
    add('artifact_analysis_limit', 'Command exceeds the static analysis limit.')
  } else if (/[\ud800-\udfff]/u.test(text)) {
    add('command_frontmatter_invalid', 'Text contains an unpaired Unicode surrogate.')
  } else if (text.startsWith('---\n')) {
    const end = text.indexOf('\n---\n', 4)
    if (end < 0) add('command_frontmatter_invalid', 'Command frontmatter is not terminated.')
    else {
      bodyOffset = end + 5
      body = text.slice(bodyOffset)
      const header = text.slice(4, end)
      try {
        const docs = parseAllDocuments(header, { uniqueKeys: true, strict: true, prettyErrors: false })
        if (header.trim() === '') frontmatter = {}
        else if (docs.length !== 1) add('command_frontmatter_invalid', 'Frontmatter must be one YAML mapping.')
        else {
          for (const issue of [...docs[0]!.errors, ...docs[0]!.warnings]) {
            const prefix = header.slice(0, issue.pos[0])
            add(
              'command_frontmatter_invalid',
              issue.message,
              prefix.split('\n').length + 1,
              issue.pos[0] - prefix.lastIndexOf('\n'),
            )
          }
          if (!findings.length) {
            const value: unknown = docs[0]!.toJS({ maxAliasCount: 100 })
            if (value === null) frontmatter = {}
            else if (typeof value === 'object' && !Array.isArray(value)) frontmatter = value as Record<string, unknown>
            else add('command_frontmatter_invalid', 'Command frontmatter must be a mapping.')
          }
        }
      } catch {
        add('command_frontmatter_invalid', 'Frontmatter could not be parsed within the analysis limits.')
      }
      if (schema && frontmatter && !findings.length) {
        try {
          const validate = new Ajv2020({ strict: true, strictTypes: false, allErrors: true }).compile(schema)
          schemaValidated = true
          if (!validate(frontmatter))
            for (const error of validate.errors ?? [])
              add(
                'command_frontmatter_schema',
                `${error.instancePath || '/'}: ${error.message ?? 'Invalid metadata'}`,
                2,
              )
        } catch {
          add('command_frontmatter_schema_unsupported', 'The supplied frontmatter schema is unsupported.')
        }
      }
    }
  }
  return freezePackageValue({
    path,
    sourceText: text,
    structurallyValid: findings.length === 0,
    findings,
    body,
    bodyOffset,
    frontmatter,
    schemaValidated,
  })
}
