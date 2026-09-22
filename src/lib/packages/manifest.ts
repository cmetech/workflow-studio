import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js'
import { freezePackageValue } from '../package-contract/package-contract-loader'
import type { WorkflowPackageContract } from '../package-contract/types'
import { packageFinding, packagePathError, packagePathIdentity } from './paths'
import type { PackageFinding, PackageManifestResult, WorkflowPackageManifest } from './types'

const validators = new WeakMap<WorkflowPackageContract, ValidateFunction>()
const pythonWhitespace =
  /^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]$/u
const clean = (value: string) => !pythonWhitespace.test(value) && !value.includes('\0')
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** JSON.parse checks grammar; this structural token pass additionally rejects duplicate decoded object keys. */
function parseUniqueJson(text: string): unknown {
  const value = JSON.parse(text) as unknown
  const tokens = text.match(/"(?:\\[\s\S]|[^"\\])*"|[{}[\]:,]/g) ?? []
  const scopes: Array<Set<string> | null> = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    if (token === '{') scopes.push(new Set())
    else if (token === '[') scopes.push(null)
    else if (token === '}' || token === ']') scopes.pop()
    else if (token.startsWith('"') && tokens[i + 1] === ':') {
      const key = JSON.parse(token) as string
      const scope = scopes.at(-1)
      if (scope?.has(key)) throw new TypeError('Duplicate JSON key')
      scope?.add(key)
    }
  }
  return value
}

export function parsePackageManifest(
  text: string,
  path: string,
  contract: WorkflowPackageContract,
): PackageManifestResult {
  let rawDocument: unknown = null
  const reject = (code: string, message: string, location = path): PackageManifestResult => ({
    ok: false,
    text,
    rawDocument,
    findings: [packageFinding(code, location, message)],
  })
  if (new TextEncoder().encode(text).byteLength > contract.resource_rules.max_file_bytes)
    return reject('package_file_size_limit', 'Package manifest exceeds the package file limit.')
  try {
    rawDocument = parseUniqueJson(text)
  } catch {
    return reject('package_manifest_invalid', 'Package manifest must be valid JSON with unique keys.')
  }
  if (record(rawDocument)) {
    if (Number.isInteger(rawDocument.schemaVersion) && rawDocument.schemaVersion !== 1)
      return reject('package_contract_unsupported', 'Package manifest version is unsupported.')
    if (Array.isArray(rawDocument.workflows))
      for (const member of rawDocument.workflows) {
        if (record(member))
          for (const field of ['definition', 'companion']) {
            const candidate = member[field]
            if (typeof candidate === 'string') {
              const code = packagePathError(candidate)
              if (code) return reject(code, 'Workflow member path is not canonical and contained.')
            }
          }
      }
  }
  let validate = validators.get(contract)
  if (!validate) {
    validate = new Ajv2020({ strict: true, strictTypes: false, allErrors: true }).compile(
      contract.package_manifest_schema,
    )
    validators.set(contract, validate)
  }
  if (!validate(rawDocument))
    return reject('package_manifest_invalid', 'Package manifest does not match the package schema.')
  const manifest = rawDocument as WorkflowPackageManifest
  if (!semanticManifestValid(manifest))
    return reject('package_manifest_invalid', 'Package metadata or workflow membership is not canonical and unique.')
  return {
    ok: true,
    text,
    rawDocument: freezePackageValue(rawDocument),
    manifest,
    findings: [] as readonly PackageFinding[],
  }
}

function semanticManifestValid(manifest: WorkflowPackageManifest): boolean {
  if (
    ![
      manifest.id,
      manifest.version,
      manifest.displayName,
      manifest.description,
      manifest.license,
      manifest.publisher,
      ...manifest.tags,
    ].every(clean)
  )
    return false
  if (new Set(manifest.tags).size !== manifest.tags.length) return false
  for (const names of Object.values(manifest.externalRequirements))
    if (new Set(names).size !== names.length || !names.every(clean)) return false
  const members = manifest.workflows.flatMap((member) =>
    member.companion === undefined || member.companion === null
      ? [member.definition]
      : [member.definition, member.companion],
  )
  if (!members.every((member) => /\.(?:yaml|yml)$/.test(member) && !member.endsWith('\n'))) return false
  return new Set(members.map(packagePathIdentity)).size === members.length
}
