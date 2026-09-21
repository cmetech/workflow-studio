import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { isAbsolute, win32 as windowsPath } from 'node:path'

export type PosixShellResolution =
  { readonly ok: true; readonly executable: string } | { readonly ok: false; readonly reason: string }

interface ResolvePosixShellOptions {
  readonly platform?: NodeJS.Platform
  readonly override?: string
  readonly gitExecutables?: readonly string[]
  readonly verify?: (candidate: string) => boolean
}

export function toPosixShellPath(path: string, platform: NodeJS.Platform = process.platform): string {
  if (platform !== 'win32') return path
  const drive = /^([A-Za-z]):[\\/](.*)$/.exec(path)
  if (drive) return `/${drive[1]!.toLowerCase()}/${drive[2]!.replaceAll('\\', '/')}`
  if (/^[\\/]{2}[^\\/]/.test(path)) return `//${path.slice(2).replaceAll('\\', '/')}`
  return path.replaceAll('\\', '/')
}

export function resolvePosixShell(options: ResolvePosixShellOptions = {}): PosixShellResolution {
  const platform = options.platform ?? process.platform
  const verify = options.verify ?? verifyBash
  const candidates = new Set<string>()
  if (options.override) candidates.add(options.override)

  if (platform === 'win32') {
    for (const git of options.gitExecutables ?? findWindowsGitExecutables()) {
      candidates.add(windowsPath.join(windowsPath.dirname(windowsPath.dirname(git)), 'bin', 'bash.exe'))
    }
    candidates.add('C:\\Program Files\\Git\\bin\\bash.exe')
    candidates.add('C:\\Program Files (x86)\\Git\\bin\\bash.exe')
  } else {
    candidates.add('/bin/bash')
    candidates.add('/usr/bin/bash')
    candidates.add('bash')
  }

  for (const candidate of candidates) {
    if (platform === 'win32' && isWindowsWslLauncher(candidate)) continue
    if (verify(candidate)) return { ok: true, executable: candidate }
  }
  return {
    ok: false,
    reason:
      platform === 'win32'
        ? 'Git Bash is required to run POSIX installer checks on Windows.'
        : 'GNU bash is required to run POSIX installer checks.',
  }
}

function isWindowsWslLauncher(candidate: string): boolean {
  return /\\windows\\system32\\bash\.exe$/i.test(windowsPath.normalize(candidate))
}

function findWindowsGitExecutables(): readonly string[] {
  const result = spawnSync('where.exe', ['git'], {
    encoding: 'utf8',
    shell: false,
    timeout: 5_000,
    windowsHide: true,
  })
  if (result.status !== 0) return []
  return result.stdout.split(/\r?\n/).filter(Boolean)
}

function verifyBash(candidate: string): boolean {
  if (isAbsolute(candidate) && !existsSync(candidate)) return false
  const result = spawnSync(candidate, ['--version'], {
    encoding: 'utf8',
    shell: false,
    timeout: 5_000,
    windowsHide: true,
  })
  return result.status === 0 && /GNU bash/i.test(`${result.stdout}\n${result.stderr}`)
}
