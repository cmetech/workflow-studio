import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './render-markdown'

describe('renderMarkdown', () => {
  it('removes active markup and unsafe URLs while publishing only validated exact internal topic actions', () => {
    const html = renderMarkdown(`
# Heading

- item

\`code\`

| field | value |
| --- | --- |
| id | review |

<script>alert(1)</script><button onclick="alert(1)">bad</button><iframe src="https://bad.test"></iframe><form action="/submit"><input></form><img src="https://bad.test/image.png"><svg><animate onbegin="alert(1)"></animate></svg>

[field](#field:prompt.node.prompt) [node](#node:prompt) [contract](#contract:dag-and-conditions)
[near miss](#guide:dag) [path](#field:../prompt) [empty](#node:) [unsafe](javascript:alert(1)) [external](https://docs.example.test)
`)

    expect(html).toContain('<h1>Heading</h1>')
    expect(html).toContain('<ul>')
    expect(html).toContain('<code>code</code>')
    expect(html).toContain('<table>')
    expect(html).toContain('data-topic-id="field:prompt.node.prompt"')
    expect(html).toContain('data-topic-id="node:prompt"')
    expect(html).toContain('data-topic-id="contract:dag-and-conditions"')
    expect(html).not.toMatch(/href="#(?:guide:dag|field:\.\.\/prompt|node:)"/)
    expect(html).not.toMatch(/data-topic-id="(?:guide:dag|field:\.\.\/prompt|node:)"/)
    expect(html).toContain('data-external-url="https://docs.example.test/"')
    expect(html).not.toMatch(/<(script|iframe|form|img|svg|animate|input)\b/i)
    expect(html).not.toMatch(/on\w+=|javascript:/i)
  })
})
