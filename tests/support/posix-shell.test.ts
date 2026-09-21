import { describe, expect, it } from 'vitest'
import { resolvePosixShell, toPosixShellPath } from './posix-shell'

describe('POSIX shell resolution', () => {
  it('converts Windows drive and UNC paths for Git Bash PATH entries', () => {
    expect(toPosixShellPath('C:\\Users\\Example\\tools', 'win32')).toBe('/c/Users/Example/tools')
    expect(toPosixShellPath('\\\\server\\share\\tools', 'win32')).toBe('//server/share/tools')
    expect(toPosixShellPath('/usr/local/bin', 'linux')).toBe('/usr/local/bin')
  })

  it('prefers a verified explicit test shell', () => {
    expect(
      resolvePosixShell({
        platform: 'win32',
        override: 'D:\\tools\\bash.exe',
        gitExecutables: [],
        verify: (candidate) => candidate === 'D:\\tools\\bash.exe',
      }),
    ).toEqual({ ok: true, executable: 'D:\\tools\\bash.exe' })
  })

  it('rejects the Windows System32 WSL launcher even when its version reports GNU bash', () => {
    const verified: string[] = []

    expect(
      resolvePosixShell({
        platform: 'win32',
        override: 'C:\\Windows\\System32\\bash.exe',
        gitExecutables: [],
        verify: (candidate) => {
          verified.push(candidate)
          return candidate === 'C:\\Windows\\System32\\bash.exe'
        },
      }),
    ).toEqual({
      ok: false,
      reason: 'Git Bash is required to run POSIX installer checks on Windows.',
    })
    expect(verified).not.toContain('C:\\Windows\\System32\\bash.exe')
  })

  it('derives Git Bash from the Git for Windows command directory', () => {
    expect(
      resolvePosixShell({
        platform: 'win32',
        gitExecutables: ['C:\\Program Files\\Git\\cmd\\git.exe'],
        verify: (candidate) => candidate === 'C:\\Program Files\\Git\\bin\\bash.exe',
      }),
    ).toEqual({ ok: true, executable: 'C:\\Program Files\\Git\\bin\\bash.exe' })
  })

  it('never falls back to the Windows System32 WSL launcher', () => {
    expect(
      resolvePosixShell({
        platform: 'win32',
        gitExecutables: ['C:\\Windows\\System32\\git.exe'],
        verify: () => false,
      }),
    ).toEqual({
      ok: false,
      reason: 'Git Bash is required to run POSIX installer checks on Windows.',
    })
  })
})
