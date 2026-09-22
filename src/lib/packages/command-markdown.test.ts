import { expect, it } from 'vitest'
import { analyzeCommandMarkdown } from './command-markdown'

it('handles cyclic aliases without crashing and rejects unpaired Unicode', () => {
  const result = analyzeCommandMarkdown('commands/alias.md', '---\nx: &x {self: *x}\n---\nBody\n')
  expect(result.sourceText).toContain('&x')
  expect(Object.isFrozen(result.frontmatter)).toBe(true)
  expect(analyzeCommandMarkdown('a.md', '\ud800').structurallyValid).toBe(false)
})

it('retains exact source/body and unknown frontmatter when no authoritative schema is supplied', () => {
  const text = '---\ndescription: Review\nargument-hint: <report>\ncustom: {value: 1}\n---\n# Review\n\nBody\n'
  expect(analyzeCommandMarkdown('commands/review.md', text)).toMatchObject({
    sourceText: text,
    structurallyValid: true,
    frontmatter: { description: 'Review', 'argument-hint': '<report>', custom: { value: 1 } },
    body: '# Review\n\nBody\n',
    schemaValidated: false,
  })
})
it('validates supplied authoritative schemas without dropping metadata', () => {
  const text = '---\ncustom: 1\n---\nBody\n'
  const result = analyzeCommandMarkdown('commands/a.md', text, {
    type: 'object',
    properties: { custom: { type: 'string' } },
    additionalProperties: true,
  })
  expect(result.structurallyValid).toBe(false)
  expect(result.frontmatter).toEqual({ custom: 1 })
  expect(result.findings[0]?.code).toBe('command_frontmatter_schema')
})
it.each(['---\na: 1', '---\n[a, b]\n---\nBody', '---\na: 1\na: 2\n---\nBody', '---\na: [broken\n---\nBody'])(
  'rejects invalid frontmatter: %s',
  (text) => {
    const result = analyzeCommandMarkdown('commands/bad.md', text)
    expect(result.structurallyValid).toBe(false)
    expect(result.findings[0]).toMatchObject({ severity: 'blocking', path: 'commands/bad.md' })
  },
)
it('does not reinterpret a body separator or leading whitespace as frontmatter', () => {
  for (const text of ['# Heading\n---\nBody\n', ' \n---\nkey: value\n---\nBody\n'])
    expect(analyzeCommandMarkdown('commands/a.md', text)).toMatchObject({
      body: text,
      frontmatter: null,
      structurallyValid: true,
    })
})
it('accepts empty mapping metadata and bounds input size', () => {
  expect(analyzeCommandMarkdown('a.md', '---\n\n---\nBody\n').frontmatter).toEqual({})
  expect(analyzeCommandMarkdown('a.md', 'x'.repeat(1048577)).findings[0]?.code).toBe('artifact_analysis_limit')
})
