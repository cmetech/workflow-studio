/** Conservative Hermes proof: retain containing constraints, siblings and each
 * numeric segment's object-key and array-index interpretations independently. */
type Schema = Readonly<Record<string, unknown>>
const record = (value: unknown): value is Schema => value !== null && typeof value === 'object' && !Array.isArray(value)
const decimal = (part: string) => /^[0-9]+$/.test(part)
function localRef(root: Schema, reference: string): unknown {
  if (!reference.startsWith('#/')) return undefined
  let current: unknown = root
  for (const raw of reference.slice(2).split('/')) {
    const part = raw.replaceAll('~1', '/').replaceAll('~0', '~')
    if (record(current) && Object.hasOwn(current, part)) current = current[part]
    else if (Array.isArray(current) && decimal(part) && Number(part) < current.length) current = current[Number(part)]
    else return undefined
  }
  return current
}
export function outputPathImpossible(schema: unknown, path: readonly string[]): boolean {
  if (!path.length) return false
  const root = record(schema) ? schema : {}
  function impossible(current: unknown, remaining: readonly string[], resolving: ReadonlySet<string>): boolean {
    if (current === false) return true
    if (!record(current)) return false
    const index = decimal(remaining[0]!) ? Number(remaining[0]) : null
    return (
      interpretation(current, remaining, resolving, 'object', index) &&
      (index === null || interpretation(current, remaining, resolving, 'array', index))
    )
  }
  function interpretation(
    current: Schema,
    remaining: readonly string[],
    resolving: ReadonlySet<string>,
    expected: 'object' | 'array',
    index: number | null,
  ): boolean {
    const type = current.type
    if (typeof type === 'string' && type !== expected) return true
    if (Array.isArray(type) && !type.includes(expected)) return true
    const ref = current.$ref
    if (typeof ref === 'string' && !resolving.has(ref)) {
      const target = localRef(root, ref)
      if (target === false) return true
      if (record(target) && interpretation(target, remaining, new Set([...resolving, ref]), expected, index))
        return true
    }
    if (expected === 'object') {
      const [property, ...tail] = remaining,
        properties = current.properties
      if (record(properties) && Object.hasOwn(properties, property!)) {
        const child = properties[property!]
        if (!tail.length ? child === false : impossible(child, tail, resolving)) return true
      } else if (!(record(current.patternProperties) && Object.keys(current.patternProperties).length)) {
        const additional = current.additionalProperties
        if (additional === false) return true
        if (record(additional) && tail.length && impossible(additional, tail, resolving)) return true
      }
    } else if (index !== null) {
      const maximum = current.maxItems
      if (typeof maximum === 'number' && Number.isInteger(maximum) && index >= maximum) return true
      let child: unknown
      if (Array.isArray(current.prefixItems) && index < current.prefixItems.length) child = current.prefixItems[index]
      else if (Array.isArray(current.items))
        child = index < current.items.length ? current.items[index] : current.additionalItems
      else child = current.items
      if (remaining.length === 1 ? child === false : impossible(child, remaining.slice(1), resolving)) return true
    }
    const branchImpossible = (branch: unknown) =>
      branch === false || (record(branch) && interpretation(branch, remaining, resolving, expected, index))
    if (Array.isArray(current.allOf) && current.allOf.some(branchImpossible)) return true
    for (const keyword of ['anyOf', 'oneOf']) {
      const branches = current[keyword]
      if (Array.isArray(branches) && branches.length && branches.every(branchImpossible)) return true
    }
    return false
  }
  return impossible(schema, path, new Set())
}
/** Gate diagnostics distinguish an unaddressable literal dotted property from an
 * impossible traversal. This does not flatten references or union branches. */
export function schemaHasUnaddressableDottedKey(schema: unknown, path: readonly string[]): boolean {
  if (!record(schema)) return false
  const seen = new WeakMap<Schema, Set<number>>()
  function visit(current: unknown, index: number): boolean {
    if (!record(current) || index >= path.length) return false
    const indices = seen.get(current) ?? new Set<number>()
    if (indices.has(index)) return false
    indices.add(index)
    seen.set(current, indices)
    if (typeof current.$ref === 'string' && visit(localRef(schema as Schema, current.$ref), index)) return true
    for (const key of ['allOf', 'anyOf', 'oneOf'])
      if (Array.isArray(current[key]) && current[key].some((branch) => visit(branch, index))) return true
    const capable = (type: string) =>
      !(typeof current.type === 'string' && current.type !== type) &&
      !(Array.isArray(current.type) && !current.type.includes(type))
    const segment = path[index]!
    if (capable('object') && record(current.properties)) {
      const rest = path.slice(index).join('.')
      if (rest.includes('.') && Object.hasOwn(current.properties, rest)) return true
      if (Object.hasOwn(current.properties, segment) && visit(current.properties[segment], index + 1)) return true
    }
    if (capable('array') && decimal(segment)) {
      const n = Number(segment),
        prefix = current.prefixItems,
        items = current.items
      const child =
        Array.isArray(prefix) && n < prefix.length
          ? prefix[n]
          : Array.isArray(items)
            ? n < items.length
              ? items[n]
              : current.additionalItems
            : items
      return visit(child, index + 1)
    }
    return false
  }
  return visit(schema, 0)
}
