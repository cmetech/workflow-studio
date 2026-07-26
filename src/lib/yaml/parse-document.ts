import { isMap, parseAllDocuments, type ErrorCode, type YAMLError } from 'yaml'
import type { ValidationIssue } from '$src/lib/documents/types'
import type { ParseWorkflowYamlOptions, YamlParseResult } from './types'

const YAML_OPTIONS = {
  version: '1.2',
  strict: true,
  uniqueKeys: true,
  keepSourceTokens: true,
  prettyErrors: false,
} as const

export function parseWorkflowYaml(text: string, options: ParseWorkflowYamlOptions): YamlParseResult {
  const lineStarts = buildLineStarts(text)
  const invalidUnicodeOffset = findInvalidUnicodeOffset(text)

  if (invalidUnicodeOffset !== null) {
    return {
      parsed: null,
      issues: [
        issueAtOffset(
          syntaxIssue('invalid_unicode', 'Workflow YAML contains an unpaired UTF-16 surrogate.', options.document),
          invalidUnicodeOffset,
          lineStarts,
        ),
      ],
    }
  }

  const byteLength = new TextEncoder().encode(text).byteLength
  if (byteLength > options.maxBytes) {
    return {
      parsed: null,
      issues: [
        syntaxIssue(
          'document_too_large',
          `Workflow YAML is ${byteLength} UTF-8 bytes; the maximum is ${options.maxBytes}.`,
          options.document,
        ),
      ],
    }
  }

  const documents = parseAllDocuments(text, YAML_OPTIONS)
  if (documents.length === 0) {
    return {
      parsed: null,
      issues: [syntaxIssue('empty_document', 'Workflow YAML must contain one mapping document.', options.document)],
    }
  }

  const issues = documents.flatMap((document) => [
    ...document.errors.map((error) => yamlDiagnosticIssue(error, 'error', options.document, lineStarts)),
    ...document.warnings.map((warning) => yamlDiagnosticIssue(warning, 'warning', options.document, lineStarts)),
  ])

  if (documents.length !== 1) {
    const secondDocumentOffset = documents[1]?.range[0]
    const multipleDocumentsIssue = syntaxIssue(
      'multiple_yaml_documents',
      'Workflow YAML must contain exactly one document.',
      options.document,
    )

    issues.push(
      secondDocumentOffset === undefined
        ? multipleDocumentsIssue
        : issueAtOffset(multipleDocumentsIssue, secondDocumentOffset, lineStarts),
    )
    return { parsed: null, issues }
  }

  const document = documents[0]
  if (!document || document.errors.length > 0) return { parsed: null, issues }

  if (!isMap(document.contents)) {
    const rootIssue = syntaxIssue('root_must_be_mapping', 'Workflow YAML root must be a mapping.', options.document)
    const rootOffset = document.contents?.range?.[0]
    issues.push(rootOffset === undefined ? rootIssue : issueAtOffset(rootIssue, rootOffset, lineStarts))
    return { parsed: null, issues }
  }

  return {
    parsed: {
      kind: options.document,
      source: text,
      document,
      lineStarts,
    },
    issues,
  }
}

function syntaxIssue(code: string, message: string, document: ParseWorkflowYamlOptions['document']): ValidationIssue {
  return {
    code,
    layer: 'syntax',
    severity: 'error',
    blocking: true,
    message,
    document,
  }
}

function yamlDiagnosticIssue(
  diagnostic: YAMLError,
  severity: 'error' | 'warning',
  document: ParseWorkflowYamlOptions['document'],
  lineStarts: readonly number[],
): ValidationIssue {
  const normalizedCode = normalizeDiagnosticCode(diagnostic.code)
  const issue: ValidationIssue = {
    code:
      diagnostic.code === 'DUPLICATE_KEY'
        ? 'duplicate_mapping_key'
        : severity === 'error'
          ? `yaml_${normalizedCode}`
          : `yaml_warning_${normalizedCode}`,
    layer: 'syntax',
    severity,
    blocking: severity === 'error',
    message:
      diagnostic.code === 'DUPLICATE_KEY'
        ? 'Duplicate mapping keys are not allowed.'
        : severity === 'error'
          ? `Invalid YAML (${normalizedCode.replaceAll('_', ' ')}).`
          : `YAML warning (${normalizedCode.replaceAll('_', ' ')}).`,
    document,
  }

  return issueAtOffset(issue, diagnostic.pos[0], lineStarts)
}

function normalizeDiagnosticCode(code: ErrorCode): string {
  return code.toLowerCase()
}

function issueAtOffset(issue: ValidationIssue, offset: number, lineStarts: readonly number[]): ValidationIssue {
  const { line, column } = lineColumnAtOffset(offset, lineStarts)
  return { ...issue, line, column }
}

function lineColumnAtOffset(offset: number, lineStarts: readonly number[]): { line: number; column: number } {
  let low = 0
  let high = lineStarts.length - 1

  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const lineStart = lineStarts[middle]
    if (lineStart === undefined) break
    if (lineStart <= offset) low = middle + 1
    else high = middle - 1
  }

  const lineIndex = Math.max(0, high)
  return {
    line: lineIndex + 1,
    column: offset - (lineStarts[lineIndex] ?? 0) + 1,
  }
}

function buildLineStarts(text: string): readonly number[] {
  const starts = [0]

  for (let index = 0; index < text.length; index += 1) {
    const codeUnit = text.charCodeAt(index)
    if (codeUnit === 0x0d && text.charCodeAt(index + 1) === 0x0a) {
      starts.push(index + 2)
      index += 1
    } else if (codeUnit === 0x0a || codeUnit === 0x0d) {
      starts.push(index + 1)
    }
  }

  return starts
}

function findInvalidUnicodeOffset(text: string): number | null {
  for (let index = 0; index < text.length; index += 1) {
    const codeUnit = text.charCodeAt(index)

    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = text.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        index += 1
        continue
      }
      return index
    }

    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return index
  }

  return null
}
