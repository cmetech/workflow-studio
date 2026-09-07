import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { THEME_TOKEN_NAMES } from '$src/lib/branding/types'

// Appearance derives this renderer-only token; imported brand manifests keep
// their existing strict token inventory and do not require or accept this key.
const rendererDerivedColorTokens = new Set([
  'focus-contrast',
  'node-kind',
  'primary',
  'primary-contrast',
  'primary-hover',
  'primary-hover-contrast',
  'primary-active',
  'primary-active-contrast',
])

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
      (token): token is string =>
        !THEME_TOKEN_NAMES.includes(token as (typeof THEME_TOKEN_NAMES)[number]) &&
        !rendererDerivedColorTokens.has(token),
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
    expect(
      sourceFiles('src').filter((path) => /ui-monospace/.test(readFileSync(path, 'utf8'))),
      'technical surfaces must resolve through the bundled --font-mono token',
    ).toEqual([])
  })

  it('applies the two-tone focus ring to native controls and focusable structural hosts', () => {
    const appCss = readFileSync('src/app.css', 'utf8')

    expect(appCss).toMatch(/:where\(a\[href\], summary, \[tabindex\]\):focus-visible\s*\{[^}]*var\(--focus-ring\)/s)
    expect(appCss).toMatch(
      /@media \(forced-colors: active\)[\s\S]*:where\(a\[href\], summary, \[tabindex\]\):focus-visible\s*\{[^}]*box-shadow: none !important/s,
    )
  })

  it('ships the exact upstream Sans and Mono notices in documentation and the frontend resource directory', () => {
    for (const license of [
      {
        upstream: 'node_modules/@fontsource-variable/geist/LICENSE',
        documented: 'docs/licenses/Geist-OFL-1.1.txt',
        frontend: 'public/licenses/Geist-OFL-1.1.txt',
      },
      {
        upstream: 'node_modules/@fontsource-variable/geist-mono/LICENSE',
        documented: 'docs/licenses/Geist-Mono-OFL-1.1.txt',
        frontend: 'public/licenses/Geist-Mono-OFL-1.1.txt',
      },
    ]) {
      expect(existsSync(license.documented), license.documented).toBe(true)
      expect(existsSync(license.frontend), license.frontend).toBe(true)
      if (!existsSync(license.documented) || !existsSync(license.frontend)) continue
      const upstream = readFileSync(license.upstream)
      expect(readFileSync(license.documented)).toEqual(upstream)
      expect(readFileSync(license.frontend)).toEqual(upstream)
    }
  })
})
