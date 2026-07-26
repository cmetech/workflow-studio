import { describe, expect, it, vi } from 'vitest'
import { isAlias, isMap, isScalar, isSeq, Scalar } from 'yaml'
import anchorsAndAliases from '../../../tests/fixtures/yaml/anchors-and-aliases.yaml?raw'
import commentsAndStyles from '../../../tests/fixtures/yaml/comments-and-styles.yaml?raw'
import duplicateKeys from '../../../tests/fixtures/yaml/duplicate-keys.yaml?raw'
import multipleDocuments from '../../../tests/fixtures/yaml/multiple-documents.yaml?raw'
import { parseWorkflowYaml } from './parse-document'
import * as sourceLocations from './source-locations'

const defaultOptions = { document: 'definition' as const, maxBytes: 2 * 1024 * 1024 }

describe('source-preserving YAML parsing', () => {
  it('reports an empty YAML stream', () => {
    const result = parseWorkflowYaml('  \n# comment only\n', defaultOptions)

    expect(result.parsed).toBeNull()
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'empty_document',
        layer: 'syntax',
        severity: 'error',
        blocking: true,
        document: 'definition',
      }),
    ])
  })

  it('keeps a malformed directive-only stream error before the empty-document issue', () => {
    const source = '%YAML nope\n'
    const first = parseWorkflowYaml(source, defaultOptions)
    const second = parseWorkflowYaml(source, defaultOptions)

    expect(first.parsed).toBeNull()
    expect(first.issues).toEqual(second.issues)
    expect(first.issues).toEqual([
      expect.objectContaining({
        code: 'yaml_bad_directive',
        severity: 'error',
        blocking: true,
        line: 1,
        column: 7,
      }),
      expect.objectContaining({ code: 'empty_document' }),
    ])
  })

  it('keeps a warning-only directive stream warning at its stable source location', () => {
    const source = '\n%UNKNOWN directive\n'
    const first = parseWorkflowYaml(source, defaultOptions)
    const second = parseWorkflowYaml(source, defaultOptions)

    expect(first.parsed).toBeNull()
    expect(first.issues).toEqual(second.issues)
    expect(first.issues).toEqual([
      expect.objectContaining({
        code: 'yaml_warning_bad_directive',
        severity: 'warning',
        blocking: false,
        line: 2,
        column: 1,
      }),
      expect.objectContaining({ code: 'empty_document' }),
    ])
  })

  it.each([
    ['sequence', '- one\n- two\n'],
    ['scalar', 'workflow\n'],
  ])('requires a mapping root for a %s document', (_rootKind, source) => {
    const result = parseWorkflowYaml(source, defaultOptions)

    expect(result.parsed).toBeNull()
    expect(result.issues.map(({ code }) => code)).toEqual(['root_must_be_mapping'])
  })

  it('reports duplicate mapping keys at their source location', () => {
    const result = parseWorkflowYaml(duplicateKeys, defaultOptions)

    expect(result.parsed).toBeNull()
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'duplicate_mapping_key',
        line: 2,
        column: 1,
        document: 'definition',
      }),
    ])
  })

  it('rejects a stream containing multiple YAML documents', () => {
    const result = parseWorkflowYaml(multipleDocuments, defaultOptions)

    expect(result.parsed).toBeNull()
    expect(result.issues.map(({ code }) => code)).toEqual(['multiple_yaml_documents'])
  })

  it('rejects unpaired UTF-16 surrogates before parsing', () => {
    const result = parseWorkflowYaml('name: \ud800\n', defaultOptions)

    expect(result.parsed).toBeNull()
    expect(result.issues.map(({ code }) => code)).toEqual(['invalid_unicode'])
  })

  it('enforces maxBytes against UTF-8 bytes rather than UTF-16 code units', () => {
    const source = 'name: café\n'
    const utf8Bytes = new TextEncoder().encode(source).byteLength
    expect(utf8Bytes).toBeGreaterThan(source.length)

    const result = parseWorkflowYaml(source, { ...defaultOptions, maxBytes: utf8Bytes - 1 })

    expect(result.parsed).toBeNull()
    expect(result.issues.map(({ code }) => code)).toEqual(['document_too_large'])
  })

  it('rejects oversized input before allocating its line-start table', () => {
    const buildLineStarts = vi.spyOn(sourceLocations, 'buildLineStarts')

    try {
      const result = parseWorkflowYaml('\n'.repeat(1_024), { ...defaultOptions, maxBytes: 1 })

      expect(result.issues.map(({ code }) => code)).toEqual(['document_too_large'])
      expect(buildLineStarts).not.toHaveBeenCalled()
    } finally {
      buildLineStarts.mockRestore()
    }
  })

  it('retains anchors and aliases as syntax nodes without expanding them', () => {
    const result = parseWorkflowYaml(anchorsAndAliases, defaultOptions)
    const parsed = result.parsed

    expect(result.issues).toEqual([])
    expect(parsed).not.toBeNull()
    if (!parsed) throw new Error('expected a retained YAML document')

    const anchored = parsed.document.get('defaults', true)
    const alias = parsed.document.getIn(['node', 'config'], true)

    expect(isMap(anchored)).toBe(true)
    if (!isMap(anchored)) throw new Error('expected the anchored mapping')
    expect(anchored.anchor).toBe('defaults')
    expect(anchored.srcToken).toBeDefined()
    expect(isAlias(alias)).toBe(true)
    if (!isAlias(alias)) throw new Error('expected the alias node')
    expect(alias.source).toBe('defaults')
    expect(alias.srcToken).toBeDefined()
  })

  it('keeps comments, collection styles, scalar styles, source tokens, and ranges observable', () => {
    const result = parseWorkflowYaml(commentsAndStyles, defaultOptions)
    const parsed = result.parsed

    expect(result.issues).toEqual([])
    expect(parsed).not.toBeNull()
    if (!parsed) throw new Error('expected a retained YAML document')

    const root = parsed.document.contents
    expect(isMap(root)).toBe(true)
    if (!isMap(root)) throw new Error('expected a mapping root')

    const firstKey = root.items[0]?.key
    const name = parsed.document.get('name', true)
    const description = parsed.document.get('description', true)
    const metadata = parsed.document.get('metadata', true)
    const tags = parsed.document.getIn(['metadata', 'tags'], true)
    const script = parsed.document.get('script', true)
    const folded = parsed.document.get('folded', true)

    expect(isScalar(firstKey) && firstKey.commentBefore).toBe(' workflow comment')
    expect(isScalar(name) && name.type).toBe(Scalar.QUOTE_DOUBLE)
    expect(isScalar(name) && name.comment).toBe(' inline name comment')
    expect(isScalar(description) && description.type).toBe(Scalar.QUOTE_SINGLE)
    expect(isMap(metadata) && metadata.flow).toBe(true)
    expect(isSeq(tags) && tags.flow).toBe(true)
    expect(isScalar(script) && script.type).toBe(Scalar.BLOCK_LITERAL)
    expect(isScalar(folded) && folded.type).toBe(Scalar.BLOCK_FOLDED)
    expect(isScalar(name) && name.srcToken).toBeDefined()
    expect(isScalar(name) && name.range).toBeDefined()

    if (!isScalar(name) || !name.range) throw new Error('expected a ranged name scalar')
    expect(parsed.source.slice(name.range[0], name.range[1])).toBe('"Styled\\tworkflow"')
    expect(parsed.lineStarts[0]).toBe(0)
    expect(parsed.lineStarts[1]).toBe(commentsAndStyles.indexOf('\n') + 1)
  })

  it('uses YAML 1.2 scalar resolution', () => {
    const result = parseWorkflowYaml('legacy_boolean: yes\n', defaultOptions)
    const value = result.parsed?.document.get('legacy_boolean', true)

    expect(isScalar(value)).toBe(true)
    if (!isScalar(value)) throw new Error('expected a scalar')
    expect(value.value).toBe('yes')
    expect(result.parsed?.document.directives.yaml.version).toBe('1.2')
  })

  it('converts parser warnings to stable non-blocking app issues while retaining the document', () => {
    const source = '%UNKNOWN directive\n---\nname: valid\n'
    const first = parseWorkflowYaml(source, defaultOptions)
    const second = parseWorkflowYaml(source, defaultOptions)

    expect(first.parsed).not.toBeNull()
    expect(first.issues).toEqual(second.issues)
    expect(first.issues).toEqual([
      expect.objectContaining({
        code: 'yaml_warning_bad_directive',
        severity: 'warning',
        blocking: false,
        line: 1,
        column: 1,
      }),
    ])
  })

  it('returns deterministic app diagnostics without library error objects or stacks', () => {
    const source = 'name: "unterminated\nnodes: [\n'
    const first = parseWorkflowYaml(source, { ...defaultOptions, document: 'companion' })
    const second = parseWorkflowYaml(source, { ...defaultOptions, document: 'companion' })

    expect(first.issues).toEqual(second.issues)
    expect(first.parsed).toBeNull()
    expect(first.issues.length).toBeGreaterThan(0)
    for (const issue of first.issues) {
      expect(issue.document).toBe('companion')
      expect(issue).not.toHaveProperty('stack')
      expect(issue).not.toHaveProperty('name')
      expect(Object.getPrototypeOf(issue)).toBe(Object.prototype)
    }
  })
})
