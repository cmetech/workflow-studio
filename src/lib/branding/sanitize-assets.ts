import DOMPurify from 'dompurify'
import { decode as decodePng } from 'fast-png'

export const MAX_BRAND_ASSET_BYTES = 2 * 1024 * 1024
export const MAX_BRAND_IMAGE_DIMENSION = 4096

export interface SanitizedBrandAsset {
  readonly path: string
  readonly mediaType: 'image/svg+xml' | 'image/png'
  readonly bytes: Uint8Array
  readonly width?: number
  readonly height?: number
}

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
const SAFE_SVG_ELEMENTS = [
  'svg',
  'g',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'title',
  'desc',
  'defs',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
  'mask',
  'use',
] as const
const SAFE_SVG_ATTRIBUTES = [
  'xmlns',
  'viewBox',
  'role',
  'aria-label',
  'aria-hidden',
  'width',
  'height',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'd',
  'points',
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-opacity',
  'opacity',
  'transform',
  'font-family',
  'font-size',
  'font-weight',
  'letter-spacing',
  'text-anchor',
  'offset',
  'stop-color',
  'stop-opacity',
  'gradientUnits',
  'gradientTransform',
  'clip-path',
  'mask',
  'id',
  'href',
] as const
const FORBIDDEN_ELEMENTS = new Set([
  'script',
  'foreignobject',
  'style',
  'iframe',
  'object',
  'embed',
  'audio',
  'video',
  'canvas',
  'image',
  'animate',
  'animatemotion',
  'animatetransform',
  'set',
])

function hasPrefix(bytes: Uint8Array, prefix: Uint8Array): boolean {
  return prefix.every((value, index) => bytes[index] === value)
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function sanitizePng(path: string, bytes: Uint8Array): SanitizedBrandAsset {
  if (bytes.byteLength > MAX_BRAND_ASSET_BYTES) throw new Error(`${path} exceeds the 2 MiB asset limit.`)
  if (bytes.byteLength < 33 || !hasPrefix(bytes, PNG_SIGNATURE)) throw new Error(`${path} is not a valid PNG.`)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(8) !== 13 || new TextDecoder().decode(bytes.subarray(12, 16)) !== 'IHDR') {
    throw new Error(`${path} does not contain a valid PNG IHDR.`)
  }
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  const bitDepth = bytes[24]
  const colorType = bytes[25]
  const compression = bytes[26]
  const filter = bytes[27]
  const interlace = bytes[28]
  const expectedHeaderCrc = view.getUint32(29)
  const validBitDepth =
    (colorType === 0 && [1, 2, 4, 8, 16].includes(bitDepth ?? -1)) ||
    (colorType === 2 && [8, 16].includes(bitDepth ?? -1)) ||
    (colorType === 3 && [1, 2, 4, 8].includes(bitDepth ?? -1)) ||
    ((colorType === 4 || colorType === 6) && [8, 16].includes(bitDepth ?? -1))
  if (
    width < 1 ||
    height < 1 ||
    width > MAX_BRAND_IMAGE_DIMENSION ||
    height > MAX_BRAND_IMAGE_DIMENSION ||
    !validBitDepth ||
    compression !== 0 ||
    filter !== 0 ||
    (interlace !== 0 && interlace !== 1) ||
    crc32(bytes.subarray(12, 29)) !== expectedHeaderCrc
  ) {
    throw new Error(`${path} has an invalid or unsupported PNG IHDR.`)
  }
  try {
    const decoded = decodePng(bytes, { checkCrc: true })
    if (decoded.width !== width || decoded.height !== height) {
      throw new Error('Decoded PNG dimensions do not match its IHDR.')
    }
  } catch {
    throw new Error(`${path} is not a complete decodable PNG.`)
  }
  return { path, mediaType: 'image/png', bytes: bytes.slice(), width, height }
}

function parseSvg(source: string, context: string): XMLDocument {
  const document = new DOMParser().parseFromString(source, 'image/svg+xml')
  if (document.querySelector('parsererror') || document.documentElement.localName !== 'svg') {
    throw new Error(`${context} is not a valid SVG.`)
  }
  return document
}

function assertSafeSvgDocument(document: XMLDocument): void {
  for (const element of document.querySelectorAll('*')) {
    if (element.namespaceURI !== SVG_NAMESPACE || FORBIDDEN_ELEMENTS.has(element.localName.toLowerCase())) {
      throw new Error('The asset contains an unsafe SVG element or namespace.')
    }
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase()
      const value = attribute.value.trim()
      if (name === 'xmlns' && value === SVG_NAMESPACE) continue
      if (
        name.startsWith('on') ||
        name === 'style' ||
        name === 'src' ||
        name === 'srcset' ||
        name === 'xlink:href' ||
        attribute.namespaceURI === 'http://www.w3.org/1999/xlink' ||
        /(?:javascript|data|https?|file):|^\/\/|url\s*\(|@import/i.test(value) ||
        ((name === 'href' || name === 'clip-path' || name === 'mask') && value !== '' && !value.startsWith('#'))
      ) {
        throw new Error('The asset contains an unsafe SVG attribute or reference.')
      }
    }
  }
}

function sanitizeSvg(path: string, bytes: Uint8Array): SanitizedBrandAsset {
  if (bytes.byteLength > MAX_BRAND_ASSET_BYTES) throw new Error(`${path} exceeds the 2 MiB asset limit.`)
  let source: string
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error(`${path} is not valid UTF-8 SVG text.`)
  }
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(source)) {
    throw new Error('The asset contains unsafe SVG declarations.')
  }
  if (source.includes('\0')) throw new Error('The asset contains unsafe SVG NUL data.')
  const original = parseSvg(source, path)
  assertSafeSvgDocument(original)
  const sanitized = DOMPurify.sanitize(source, {
    ALLOWED_TAGS: [...SAFE_SVG_ELEMENTS],
    ALLOWED_ATTR: [...SAFE_SVG_ATTRIBUTES],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: true,
    FORBID_TAGS: [...FORBIDDEN_ELEMENTS],
    FORBID_ATTR: ['style'],
    NAMESPACE: SVG_NAMESPACE,
  })
  const verified = parseSvg(sanitized, path)
  assertSafeSvgDocument(verified)
  if (!verified.documentElement.querySelector('*')) throw new Error(`${path} has no renderable SVG content.`)
  const sanitizedBytes = new TextEncoder().encode(sanitized)
  if (sanitizedBytes.byteLength > MAX_BRAND_ASSET_BYTES) throw new Error(`${path} exceeds the 2 MiB asset limit.`)
  return { path, mediaType: 'image/svg+xml', bytes: sanitizedBytes }
}

export function sanitizeBrandAsset(path: string, bytes: Uint8Array): SanitizedBrandAsset {
  const lowerPath = path.toLowerCase()
  if (lowerPath.endsWith('.svg')) return sanitizeSvg(path, bytes)
  if (lowerPath.endsWith('.png')) return sanitizePng(path, bytes)
  throw new Error(`${path} is not a supported SVG or PNG brand asset.`)
}
