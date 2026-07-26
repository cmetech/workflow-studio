import type { Document } from 'yaml'
import type { DocumentKind, ValidationIssue } from '$src/lib/documents/types'

export interface ParseWorkflowYamlOptions {
  document: DocumentKind
  maxBytes: number
}

export interface ParsedYamlDocument {
  kind: DocumentKind
  source: string
  document: Document.Parsed
  lineStarts: readonly number[]
}

export interface YamlParseResult {
  parsed: ParsedYamlDocument | null
  issues: readonly ValidationIssue[]
}
