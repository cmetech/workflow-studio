import { getNativeBridge } from './bridge'
import { NativeError, type UnlistenWorkspace, type WorkspaceChangedEvent, type WorkspaceReadResult } from './types'

export interface RereadWorkspaceChange {
  readonly event: WorkspaceChangedEvent
  readonly files: readonly WorkspaceReadResult[]
}

export async function watchWorkspaceChanges(
  handler: (change: RereadWorkspaceChange) => void | Promise<void>,
): Promise<UnlistenWorkspace> {
  const bridge = getNativeBridge()
  return bridge.onWorkspaceChanged(async (event) => {
    const yamlPaths = [...new Set(event.paths.filter(isYamlPath))].sort()
    const reads = await Promise.all(
      yamlPaths.map(async (relativePath) => {
        try {
          return await bridge.workspaceRead(relativePath)
        } catch (error: unknown) {
          if (error instanceof NativeError && error.code === 'path_not_found') return null
          throw error
        }
      }),
    )
    await handler({ event, files: reads.filter((read): read is WorkspaceReadResult => read !== null) })
  })
}

function isYamlPath(relativePath: string): boolean {
  return relativePath.endsWith('.yaml') || relativePath.endsWith('.yml')
}
