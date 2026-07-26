import type { LayoutNodeProjection, LayoutProjection, LayoutRecordV1 } from './types'

export const LAYOUT_COLUMN_WIDTH = 320
export const LAYOUT_ROW_HEIGHT = 160
export const MAX_LAYOUT_COORDINATE = 1_000_000

interface Position {
  x: number
  y: number
}

export function reconcileLayout(projection: LayoutProjection, saved: LayoutRecordV1): LayoutRecordV1 {
  const nodes = [...projection.nodes].sort((left, right) => compareText(left.id, right.id))
  const nodeIds = new Set(nodes.map(({ id }) => id))
  const positions = new Map<string, Position>()

  for (const [id, position] of Object.entries(saved.nodePositions)) {
    if (nodeIds.has(id) && validPosition(position)) positions.set(id, { ...position })
  }

  const waiting = new Map(nodes.filter(({ id }) => !positions.has(id)).map((node) => [node.id, node]))
  while (waiting.size > 0) {
    const ready = [...waiting.values()].filter((node) =>
      node.dependsOn.every((dependency) => positions.has(dependency) || !waiting.has(dependency)),
    )
    const candidates = ready.length > 0 ? ready : [[...waiting.values()][0]!]
    for (const node of candidates) {
      positions.set(node.id, placeNode(node, positions))
      waiting.delete(node.id)
    }
  }

  return { ...saved, nodePositions: Object.fromEntries(positions) }
}

export function migrateVisualNodeRename(saved: LayoutRecordV1, from: string, to: string): LayoutRecordV1 {
  if (from === to || !Object.hasOwn(saved.nodePositions, from) || Object.hasOwn(saved.nodePositions, to)) {
    return saved
  }
  const nodePositions = Object.fromEntries(
    Object.entries(saved.nodePositions)
      .filter(([id]) => id !== from)
      .concat([[to, { ...saved.nodePositions[from]! }]]),
  )
  return { ...saved, nodePositions }
}

export function migrateManualYamlNodeRename(
  saved: LayoutRecordV1,
  before: LayoutProjection,
  after: LayoutProjection,
): LayoutRecordV1 {
  const beforeIds = new Set(before.nodes.map(({ id }) => id))
  const afterIds = new Set(after.nodes.map(({ id }) => id))
  const removed = before.nodes.filter(({ id }) => !afterIds.has(id))
  const added = after.nodes.filter(({ id }) => !beforeIds.has(id))
  const matches =
    removed.length === 1 &&
    added.length === 1 &&
    sameNodeShapeAfterRename(removed[0]!, added[0]!, removed[0]!.id, added[0]!.id)
      ? [{ from: removed[0]!.id, to: added[0]!.id }]
      : []
  const migrated = matches.length === 1 ? migrateVisualNodeRename(saved, matches[0]!.from, matches[0]!.to) : saved
  return reconcileLayout(after, migrated)
}

function placeNode(node: LayoutNodeProjection, positions: ReadonlyMap<string, Position>): Position {
  const dependencies = node.dependsOn.flatMap((id) => (positions.get(id) ? [positions.get(id)!] : []))
  const start =
    dependencies.length === 0
      ? { x: 0, y: 0 }
      : dependencies.reduce((deepest, position) => (position.x > deepest.x ? position : deepest), dependencies[0]!)
  const x = dependencies.length === 0 ? 0 : nextColumn(start.x)
  let y = dependencies.length === 0 ? 0 : gridRow(start.y)
  const availableRows = Math.floor((MAX_LAYOUT_COORDINATE * 2) / LAYOUT_ROW_HEIGHT) + 1
  for (let attempt = 0; attempt < availableRows; attempt += 1) {
    if (!collides({ x, y }, positions)) return { x, y }
    y += LAYOUT_ROW_HEIGHT
    if (y > MAX_LAYOUT_COORDINATE) y = -MAX_LAYOUT_COORDINATE
  }
  return { x, y }
}

function nextColumn(x: number): number {
  return Math.min(MAX_LAYOUT_COORDINATE, (Math.floor(x / LAYOUT_COLUMN_WIDTH) + 1) * LAYOUT_COLUMN_WIDTH)
}

function gridRow(y: number): number {
  return Math.max(
    -MAX_LAYOUT_COORDINATE,
    Math.min(MAX_LAYOUT_COORDINATE, Math.round(y / LAYOUT_ROW_HEIGHT) * LAYOUT_ROW_HEIGHT),
  )
}

function collides(candidate: Position, positions: ReadonlyMap<string, Position>): boolean {
  return [...positions.values()].some(
    (position) =>
      Math.abs(position.x - candidate.x) < LAYOUT_COLUMN_WIDTH &&
      Math.abs(position.y - candidate.y) < LAYOUT_ROW_HEIGHT,
  )
}

export function validPosition(value: unknown): value is Position {
  if (!isRecord(value)) return false
  return boundedCoordinate(value.x) && boundedCoordinate(value.y)
}

function boundedCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_LAYOUT_COORDINATE
}

function sameNodeShapeAfterRename(
  before: LayoutNodeProjection,
  after: LayoutNodeProjection,
  from: string,
  to: string,
): boolean {
  return (
    before.kind === after.kind &&
    stableValue(before.value) === stableValue(after.value) &&
    stableValue(before.options) === stableValue(after.options) &&
    stableValue(before.dependsOn.map((id) => (id === from ? to : id)).sort()) ===
      stableValue([...after.dependsOn].sort())
  )
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'undefined'
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
