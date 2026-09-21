export interface RecentWorkspaceRecord {
  readonly rootPath: string
  readonly lastOpenedAt: string
}

export interface RecentWorkspace extends RecentWorkspaceRecord {
  readonly available: boolean
}

export interface RecentWorkspacePort {
  load(): Promise<string>
  save(content: string): Promise<void>
  isAvailable(rootPath: string): Promise<boolean>
}

export interface RecentWorkspaceStore {
  list(): Promise<readonly RecentWorkspace[]>
  record(rootPath: string, openedAt: string): Promise<void>
  remove(rootPath: string): Promise<void>
  clearUnavailable(): Promise<void>
}

const MAX_RECENT_WORKSPACES = 20
const WINDOWS_VERBATIM_PREFIX = '\\\\?\\'
const WINDOWS_VERBATIM_UNC_PREFIX = '\\\\?\\UNC\\'
const WINDOWS_DEVICE_PREFIX = '\\\\.\\'

export function createRecentWorkspaceStore(port: RecentWorkspacePort): RecentWorkspaceStore {
  let queue: Promise<void> = Promise.resolve()

  function exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.catch(() => undefined).then(operation)
    queue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  async function records(): Promise<RecentWorkspaceRecord[]> {
    const content = await port.load()
    let value: unknown
    try {
      value = JSON.parse(content) as unknown
    } catch {
      return []
    }
    if (!Array.isArray(value)) return []
    const byRoot = new Map<string, RecentWorkspaceRecord>()
    for (const candidate of value) {
      if (!isRecord(candidate) || !nonEmpty(candidate.rootPath) || !validTimestamp(candidate.lastOpenedAt)) continue
      const rootPath = publicRootPath(candidate.rootPath)
      if (rootPath === null) continue
      const identity = rootIdentity(rootPath)
      const prior = byRoot.get(identity)
      if (!prior || Date.parse(prior.lastOpenedAt) < Date.parse(candidate.lastOpenedAt)) {
        byRoot.set(identity, { rootPath, lastOpenedAt: candidate.lastOpenedAt })
      }
    }
    return [...byRoot.values()].sort(newestFirst).slice(0, MAX_RECENT_WORKSPACES)
  }

  return {
    list() {
      return exclusive(async () => {
        const current = await records()
        return Promise.all(
          current.map(async (record) => ({ ...record, available: await port.isAvailable(record.rootPath) })),
        )
      })
    },
    record(rootPath, openedAt) {
      const publicRoot = publicRootPath(rootPath)
      if (publicRoot === null || !validTimestamp(openedAt)) {
        return Promise.reject(new TypeError('A recent workspace requires a root path and ISO timestamp.'))
      }
      return exclusive(async () => {
        const current = await records()
        const identity = rootIdentity(publicRoot)
        const next = [
          { rootPath: publicRoot, lastOpenedAt: openedAt },
          ...current.filter((entry) => rootIdentity(entry.rootPath) !== identity),
        ]
          .sort(newestFirst)
          .slice(0, MAX_RECENT_WORKSPACES)
        await port.save(JSON.stringify(next))
      })
    },
    remove(rootPath) {
      const publicRoot = publicRootPath(rootPath)
      if (publicRoot === null) {
        return Promise.reject(new TypeError('A recent workspace requires a root path.'))
      }
      return exclusive(async () => {
        const current = await records()
        const identity = rootIdentity(publicRoot)
        await port.save(JSON.stringify(current.filter((entry) => rootIdentity(entry.rootPath) !== identity)))
      })
    },
    clearUnavailable() {
      return exclusive(async () => {
        const current = await records()
        const availability = await Promise.all(current.map((entry) => port.isAvailable(entry.rootPath)))
        await port.save(JSON.stringify(current.filter((_, index) => availability[index])))
      })
    },
  }
}

function newestFirst(left: RecentWorkspaceRecord, right: RecentWorkspaceRecord): number {
  return Date.parse(right.lastOpenedAt) - Date.parse(left.lastOpenedAt) || left.rootPath.localeCompare(right.rootPath)
}

function publicRootPath(path: unknown): string | null {
  if (!nonEmpty(path)) return null
  if (path.slice(0, WINDOWS_VERBATIM_UNC_PREFIX.length).toUpperCase() === WINDOWS_VERBATIM_UNC_PREFIX) {
    const remainder = path.slice(WINDOWS_VERBATIM_UNC_PREFIX.length)
    return remainder.length > 0 ? `\\\\${remainder}` : null
  }
  if (path.startsWith(WINDOWS_VERBATIM_PREFIX)) {
    const remainder = path.slice(WINDOWS_VERBATIM_PREFIX.length)
    return /^[A-Za-z]:\\/.test(remainder) ? remainder : null
  }
  if (path.startsWith(WINDOWS_DEVICE_PREFIX)) return null
  return path
}

function rootIdentity(path: string): string {
  return path
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
