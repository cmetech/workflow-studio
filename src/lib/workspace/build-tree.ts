import { compareCodePoints } from './pair-workflows'
import type { WorkspaceEntry, WorkspaceFolderEntry, WorkspaceTreeEntry } from './types'

interface MutableFolder {
  readonly name: string
  readonly relativePath: string
  readonly folders: Map<string, MutableFolder>
  readonly entries: WorkspaceEntry[]
}

export function buildWorkspaceTree(entries: readonly WorkspaceEntry[]): readonly WorkspaceTreeEntry[] {
  const root = createMutableFolder('', '')

  for (const entry of entries) {
    const segments = entry.relativePath.split('/')
    if (segments.length === 0) continue

    let folder = root
    for (const segment of segments.slice(0, -1)) {
      const relativePath = folder.relativePath ? `${folder.relativePath}/${segment}` : segment
      let child = folder.folders.get(segment)
      if (!child) {
        child = createMutableFolder(segment, relativePath)
        folder.folders.set(segment, child)
      }
      folder = child
    }
    folder.entries.push(entry)
  }

  return freezeChildren(root)
}

function createMutableFolder(name: string, relativePath: string): MutableFolder {
  return { name, relativePath, folders: new Map(), entries: [] }
}

function freezeChildren(folder: MutableFolder): readonly WorkspaceTreeEntry[] {
  const folders: WorkspaceFolderEntry[] = [...folder.folders.values()]
    .sort((left, right) => compareCodePoints(left.name, right.name))
    .map((child) =>
      Object.freeze({
        kind: 'folder' as const,
        id: `folder:${child.relativePath}`,
        name: child.name,
        relativePath: child.relativePath,
        children: freezeChildren(child),
      }),
    )
  const entries = [...folder.entries].sort(
    (left, right) =>
      compareCodePoints(left.name, right.name) || compareCodePoints(left.relativePath, right.relativePath),
  )
  return Object.freeze([...folders, ...entries])
}
