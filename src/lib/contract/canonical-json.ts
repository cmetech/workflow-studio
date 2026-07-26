function canonicalizeJsonValue(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value)
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Canonical JSON does not support non-finite numbers')
    }
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJsonValue).join(',')}]`
  }

  if (typeof value === 'object') {
    const object = value as Record<string, unknown>
    const entries = Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalizeJsonValue(object[key])}`)
    return `{${entries.join(',')}}`
  }

  throw new TypeError(`Canonical JSON does not support ${typeof value} values`)
}

export function canonicalizeContractPayload(payload: Readonly<Record<string, unknown>>): string {
  const digestPayload = Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'contract_digest'))
  return canonicalizeJsonValue(digestPayload)
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : Uint8Array.from(input)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
