import { packagePathError } from '../packages/paths'
import { decode as decodePng } from 'fast-png'
import contract from '../../../contracts/workflow-package-v1.json'
import { NativeError, type ArtifactNativeBridge, type WorkspaceArtifactMetadata } from './types'

export interface BrowserArtifactOptions {
  readonly initialArtifacts?: Readonly<Record<string, Uint8Array>>
  readonly chooseArtifactSource?: () => Promise<Uint8Array | null>
  readonly onRevealArtifact?: (path: string) => void
  readonly onOpenArtifact?: (path: string) => void
}

export function browserArtifacts(
  options: BrowserArtifactOptions,
  readText: (path: string) => string | undefined,
  saveText: (path: string, text: string | undefined) => void,
  changed: (path: string, existed: boolean) => Promise<void>,
) {
  const bytes = new Map(Object.entries(options.initialArtifacts ?? {}).map(([path, value]) => [path, value.slice()]))
  const grants = new Map<string, Uint8Array>()
  let generation = 0
  const maximum = contract.resource_rules.max_file_bytes
  function check(path: string) {
    if (packagePathError(path)) {
      throw new NativeError('workspace_path_invalid', 'A canonical artifact path outside Git metadata is required.')
    }
  }
  function bounded(value: Uint8Array) {
    if (value.byteLength > maximum)
      throw new NativeError('file_too_large', 'The artifact exceeds the package contract limit.')
    return value
  }
  function content(path: string) {
    check(path)
    const text = readText(path)
    const value = text === undefined ? bytes.get(path) : new TextEncoder().encode(text)
    if (!value) throw new NativeError('path_not_found', 'The artifact does not exist.')
    return bounded(value)
  }
  async function metadata(path: string): Promise<WorkspaceArtifactMetadata> {
    const value = content(path)
    const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(value))
    return {
      relativePath: path,
      size: value.length,
      sha256: [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
      modifiedAt: '2026-07-25T12:00:00.000Z',
      readOnly: false,
      mediaType: png(path, value) ? 'image/png' : 'application/octet-stream',
    }
  }
  async function write(path: string, value: Uint8Array, expected: string | null) {
    check(path)
    bounded(value)
    const priorText = readText(path)
    const priorBytes = bytes.get(path)
    const priorGeneration = generation
    const existed = priorText !== undefined || priorBytes !== undefined
    const hash = existed ? (await metadata(path)).sha256 : null
    if (
      hash !== expected ||
      priorText !== readText(path) ||
      priorBytes !== bytes.get(path) ||
      priorGeneration !== generation
    )
      throw new NativeError('workspace_revision_conflict', 'The artifact changed before saving.')
    bytes.set(path, value.slice())
    try {
      saveText(path, new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(value))
    } catch {
      saveText(path, undefined)
    }
    await changed(path, existed)
    return metadata(path)
  }
  async function replace(path: string, token: string, expected: string | null) {
    const source = grants.get(token)
    grants.delete(token)
    if (!source) throw new NativeError('artifact_source_grant_invalid', 'Choose the source again.')
    return write(path, source, expected)
  }
  const bridge: ArtifactNativeBridge = {
    chooseImportArtifact: async () => {
      const selectedGeneration = generation
      const value = await options.chooseArtifactSource?.()
      if (selectedGeneration !== generation)
        throw new NativeError('artifact_source_grant_invalid', 'The workspace changed while choosing a source.')
      if (!value) return null
      const sourceGrantToken = crypto.randomUUID()
      grants.clear()
      grants.set(sourceGrantToken, bounded(value).slice())
      return { sourceGrantToken }
    },
    workspaceReadArtifact: metadata,
    workspaceReadTextArtifact: async (path) => {
      const meta = await metadata(path)
      try {
        return { ...meta, text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(content(path)) }
      } catch {
        throw new NativeError('invalid_utf8', 'The artifact is not UTF-8 text.')
      }
    },
    workspaceWriteTextArtifact: ({ relativePath, text, expectedCurrentHash }) =>
      write(relativePath, new TextEncoder().encode(text), expectedCurrentHash),
    workspaceImportArtifact: ({ relativePath, sourceGrantToken }) => replace(relativePath, sourceGrantToken, null),
    workspaceReplaceArtifact: ({ relativePath, sourceGrantToken, expectedCurrentHash }) =>
      replace(relativePath, sourceGrantToken, expectedCurrentHash),
    workspaceRevealArtifact: async (path) => {
      await metadata(path)
      options.onRevealArtifact?.(path)
    },
    workspaceOpenArtifact: async (path) => {
      if (!png(path, content(path)))
        throw new NativeError('artifact_open_unsupported', 'Reveal this file to open it with a chosen application.')
      options.onOpenArtifact?.(path)
    },
  }
  return {
    bridge,
    clearGrants: () => {
      generation += 1
      grants.clear()
    },
    bytes,
  }
}

function png(path: string, bytes: Uint8Array): boolean {
  if (
    !path.toLowerCase().endsWith('.png') ||
    bytes.length < 33 ||
    ![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
  )
    return false
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  if (!width || !height || width * height * 8 > contract.resource_rules.max_file_bytes) return false
  try {
    const decoded = decodePng(bytes, { checkCrc: true })
    return decoded.width === width && decoded.height === height
  } catch {
    return false
  }
}
