import { describe, expect, it } from 'vitest'
import bundledLogo from '../../../brands/loop24/logo.svg?raw'
import { sanitizeBrandAsset } from './sanitize-assets'

const encoder = new TextEncoder()

function svg(source: string): Uint8Array {
  return encoder.encode(source)
}

const VALID_PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='),
  (character) => character.charCodeAt(0),
)

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngWithDimensions(width: number, height: number): Uint8Array {
  const bytes = VALID_PNG.slice()
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  view.setUint32(29, crc32(bytes.subarray(12, 29)))
  return bytes
}

describe('sanitizeBrandAsset', () => {
  it.each([
    ['script', '<script>alert(1)</script>'],
    ['foreignObject', '<foreignObject><div>html</div></foreignObject>'],
    ['event handler', '<path onload="alert(1)"/>'],
    ['javascript href', '<a href="javascript:alert(1)"><path/></a>'],
    ['remote href', '<image href="https://example.com/pixel.png"/>'],
    ['external fragment', '<use href="sprite.svg#mark"/>'],
    ['xlink reference', '<use xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="#mark"/>'],
    ['CSS url', '<path style="fill:url(https://example.com/pixel)"/>'],
    ['style element', '<style>@import url(https://example.com/x.css)</style>'],
    ['DOCTYPE/entity', '<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><text>&xxe;</text>'],
    ['animation', '<animate attributeName="x" from="0" to="1"/>'],
    ['namespace trick', '<script xmlns="http://www.w3.org/1999/xhtml">alert(1)</script>'],
    ['mixed-case event', '<path oNlOaD="alert(1)"/>'],
    ['processing instruction', '<?xml-stylesheet href="https://example.com/x.css"?><path/>'],
  ])('rejects malicious SVG using %s', (_name, payload) => {
    expect(() =>
      sanitizeBrandAsset('logo.svg', svg(`<svg xmlns="http://www.w3.org/2000/svg">${payload}</svg>`)),
    ).toThrow(/unsafe SVG/i)
  })

  it.each([
    ['invalid UTF-8', Uint8Array.from([0xff, 0xfe, 0xfd])],
    ['embedded NUL', svg('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0\0 0"/></svg>')],
    ['malformed XML', svg('<svg xmlns="http://www.w3.org/2000/svg"><path></svg>')],
    ['mixed-case script', svg('<svg xmlns="http://www.w3.org/2000/svg"><ScRiPt>alert(1)</ScRiPt></svg>')],
  ])('rejects malformed SVG input: %s', (_name, bytes) => {
    expect(() => sanitizeBrandAsset('logo.svg', bytes)).toThrow(/SVG/i)
  })

  it('keeps the approved LOOP24 SVG renderable without active content', () => {
    const result = sanitizeBrandAsset('logo.svg', svg(bundledLogo))
    const source = new TextDecoder().decode(result.bytes)

    expect(result.mediaType).toBe('image/svg+xml')
    expect(source).toContain('<svg')
    expect(source).toContain('LOOP24')
    expect(source.replaceAll('http://www.w3.org/2000/svg', '')).not.toMatch(
      /<script|foreignObject|\son\w+=|javascript:|https?:|url\s*\(|<!DOCTYPE|<!ENTITY|<animate/i,
    )
  })

  it('accepts a genuinely valid bounded PNG and reports its dimensions', () => {
    expect(sanitizeBrandAsset('icon.png', VALID_PNG)).toMatchObject({
      mediaType: 'image/png',
      width: 1,
      height: 1,
    })
  })

  it.each([
    ['wrong signature', new Uint8Array(33)],
    ['truncated signature only', VALID_PNG.slice(0, 8)],
    ['IHDR not first', Uint8Array.from([...VALID_PNG.slice(0, 12), 0, 0, 0, 0, ...VALID_PNG.slice(16)])],
    [
      'impossible chunk length',
      Uint8Array.from([...VALID_PNG.slice(0, 8), 0xff, 0xff, 0xff, 0xff, ...VALID_PNG.slice(12)]),
    ],
    ['invalid IHDR CRC', Uint8Array.from([...VALID_PNG.slice(0, 29), VALID_PNG[29]! ^ 0xff, ...VALID_PNG.slice(30)])],
    ['zero width', pngWithDimensions(0, 1)],
    ['oversized dimensions', pngWithDimensions(4097, 1)],
  ])('rejects invalid PNG input: %s', (_name, bytes) => {
    expect(() => sanitizeBrandAsset('icon.png', bytes)).toThrow(/PNG/i)
  })

  it('does not decode PNG bytes as SVG and rejects unsupported asset types', () => {
    expect(() => sanitizeBrandAsset('icon.svg', VALID_PNG)).toThrow(/SVG/i)
    expect(() => sanitizeBrandAsset('logo.html', svg('<svg/>'))).toThrow(/supported SVG or PNG/i)
  })
})
