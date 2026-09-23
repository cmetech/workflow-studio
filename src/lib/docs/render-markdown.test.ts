import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './render-markdown'

describe('renderMarkdown', () => {
  it('publishes bounded topic anchors and stable heading targets without accepting arbitrary fragments',()=>{
    const html=renderMarkdown('## Runtime resolution\n\n[Runtime](#guide:script-resources#runtime-resolution) [Bad](#guide:script-resources#../escape)')
    expect(html).toContain('data-documentation-heading="runtime-resolution"')
    expect(html).toContain('data-topic-id="guide:script-resources#runtime-resolution"')
    expect(html).not.toContain('data-topic-id="guide:script-resources#../escape"')
  })
  it('brands prose while preserving code and link destinations', () => {
    const html = renderMarkdown('Hermes runs workflows. [Hermes guide](https://example.test/hermes) uses `hermes-legacy`.\n\n```yaml\nlanguage_compatibility: hermes-legacy\n# Hermes source comment\n```')
    expect(html).toContain('loop24 runs workflows.')
    expect(html).toContain('loop24 guide')
    expect(html).toContain('https://example.test/hermes')
    expect(html).toContain('<code>hermes-legacy</code>')
    expect(html).toContain('# Hermes source comment')
    expect(renderMarkdown('Run "hermes workflow doctor" before relying on this field.')).toContain(
      'Run the workflow compatibility check before relying on this field.',
    )
  })
  it('removes active markup and unsafe URLs while publishing only validated exact internal topic actions', () => {
    const html = renderMarkdown(`
# Heading

- item

\`code\`

| field | value |
| --- | --- |
| id | review |

<script>alert(1)</script><button onclick="alert(1)">bad</button><iframe src="https://bad.test"></iframe><form action="/submit"><input></form><img src="https://bad.test/image.png"><svg><animate onbegin="alert(1)"></animate></svg>

[field](#field:prompt.node.prompt) [node](#node:prompt) [contract](#contract:dag-and-conditions) [guide](#guide:dag-dependencies)
[near miss](#guides:dag) [guide path](#guide:../dag) [path](#field:../prompt) [empty](#node:) [unsafe](javascript:alert(1)) [external](https://docs.example.test)
`)

    expect(html).toContain('<h1 data-documentation-heading="heading" tabindex="-1">Heading</h1>')
    expect(html).toContain('<ul>')
    expect(html).toContain('<code>code</code>')
    expect(html).toContain('<table>')
    expect(html).toContain('data-topic-id="field:prompt.node.prompt"')
    expect(html).toContain('data-topic-id="node:prompt"')
    expect(html).toContain('data-topic-id="contract:dag-and-conditions"')
    expect(html).toContain('data-topic-id="guide:dag-dependencies"')
    expect(html).not.toMatch(/href="#(?:guides:dag|guide:\.\.\/dag|field:\.\.\/prompt|node:)"/)
    expect(html).not.toMatch(/data-topic-id="(?:guides:dag|guide:\.\.\/dag|field:\.\.\/prompt|node:)"/)
    expect(html).toContain('data-external-url="https://docs.example.test/"')
    expect(html).not.toMatch(/<(script|iframe|form|img|svg|animate|input)\b/i)
    expect(html).not.toMatch(/on\w+=|javascript:/i)
  })
})
