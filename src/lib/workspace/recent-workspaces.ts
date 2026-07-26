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
}

const MAX_RECENT_WORKSPACES = 20

export function createRecentWorkspaceStore(port: RecentWorkspacePort): RecentWorkspaceStore {
  let queue = Promise.resolve()

  async function records(): Promise<RecentWorkspaceRecord[]> {
    let value: unknown
    try {
      value = JSON.parse(await port.load()) as unknown
    } catch {
      return []
    }
    if (!Array.isArray(value)) return []
    const byRoot = new Map<string, RecentWorkspaceRecord>()
    for (const candidate of value) {
      if (!isRecord(candidate) || !nonEmpty(candidate.rootPath) || !validTimestamp(candidate.lastOpenedAt)) continue
      const prior = byRoot.get(candidate.rootPath)
      if (!prior || prior.lastOpenedAt < candidate.lastOpenedAt) {
        byRoot.set(candidate.rootPath, { rootPath: candidate.rootPath, lastOpenedAt: candidate.lastOpenedAt })
      }
    }
    return [...byRoot.values()].sort(newestFirst).slice(0, MAX_RECENT_WORKSPACES)
  }

  return {
    async list() {
      await queue
      const current = await records()
      return Promise.all(
        current.map(async (record) => ({ ...record, available: await port.isAvailable(record.rootPath) })),
      )
    },
    record(rootPath, openedAt) {
      if (!nonEmpty(rootPath) || !validTimestamp(openedAt)) {
        return Promise.reject(new TypeError('A recent workspace requires a root path and ISO timestamp.'))
      }
      queue = queue.then(async () => {
        const current = await records()
        const next = [{ rootPath, lastOpenedAt: openedAt }, ...current.filter((entry) => entry.rootPath !== rootPath)]
          .sort(newestFirst)
          .slice(0, MAX_RECENT_WORKSPACES)
        await port.save(JSON.stringify(next))
      })
      return queue
    },
  }
}

function newestFirst(left: RecentWorkspaceRecord, right: RecentWorkspaceRecord): number {
  return right.lastOpenedAt.localeCompare(left.lastOpenedAt) || left.rootPath.localeCompare(right.rootPath)
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
