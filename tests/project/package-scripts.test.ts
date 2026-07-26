import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('project verification contract', () => {
  it('exposes one local verification command', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(pkg.scripts.verify).toBe(
      'npm run format:check && npm run lint && npm run check && npm run test:unit && npm run test:rust',
    )
  })
})
