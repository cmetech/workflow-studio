import { browserPackages } from './browser-packages'
import { browserArtifacts, type BrowserArtifactOptions } from './browser-artifacts'
import type { WorkspaceChangedEvent } from './types'

/** Package capabilities are initialized only when the browser invokes one. */
export function createBrowserPackageFacilities(
  options: BrowserArtifactOptions,
  files: Map<string, { text: string; modifiedAt: string }>,
  emit: (event: WorkspaceChangedEvent) => Promise<void>,
  modifiedAt: string,
) {
  const artifacts = browserArtifacts(
    options,
    (path) => files.get(path)?.text,
    (path, text) => {
      if (text === undefined) files.delete(path)
      else files.set(path, { text, modifiedAt: modifiedAt })
    },
    (path, existed) => emit({ paths: [path], kind: existed ? 'modify' : 'create' }),
  )
  const packages = browserPackages(
    () => {
      const all = new Map([...artifacts.bytes].map(([path, bytes]) => [path, bytes.slice()]))
      for (const [path, file] of files) all.set(path, new TextEncoder().encode(file.text))
      return all
    },
    (values) => {
      files.clear()
      artifacts.bytes.clear()
      for (const [path, bytes] of values) {
        artifacts.bytes.set(path, bytes.slice())
        try {
          files.set(path, {
            text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes),
            modifiedAt: modifiedAt,
          })
        } catch {
          /* binary remains in artifact storage */
        }
      }
    },
    (paths) => emit({ paths, kind: 'modify' }),
  )
  artifacts.setPackageGuard(packages.prepareArtifactWrite)
  return {
    bridge: { ...artifacts.bridge, ...packages.bridge },
    bytes: artifacts.bytes,
    reset: () => {
      artifacts.clearGrants()
      packages.reset()
    },
  }
}
