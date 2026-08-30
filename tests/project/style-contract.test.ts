import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { THEME_TOKEN_NAMES } from '$src/lib/branding/types'

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(?:svelte|css)$/.test(entry.name) ? [path] : []
  })
}

describe('offline visual style contract', () => {
  it('uses only fixed semantic color tokens and locally pinned Geist font packages', () => {
    const referencedColors = new Set(
      sourceFiles('src').flatMap((path) =>
        [...readFileSync(path, 'utf8').matchAll(/var\(--color-([a-z0-9-]+)/g)].map((match) => match[1]!),
      ),
    )
    const unknownColors = [...referencedColors].filter(
      (token): token is string => !THEME_TOKEN_NAMES.includes(token as (typeof THEME_TOKEN_NAMES)[number]),
    )
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      dependencies: Record<string, string>
    }
    const appCss = readFileSync('src/app.css', 'utf8')

    expect(packageJson.dependencies['@fontsource-variable/geist']).toBe('5.3.0')
    expect(packageJson.dependencies['@fontsource-variable/geist-mono']).toBe('5.3.0')
    expect(referencedColors).toContain('accent')
    expect(referencedColors).toContain('error')
    expect(unknownColors).toEqual([])
    expect(appCss).not.toMatch(/background\s*:\s*#fad22d/i)
    expect(appCss).toContain('font-family: var(--font-sans)')
  })
})
