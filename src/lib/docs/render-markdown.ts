import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { workflowCopy } from '$src/lib/branding/workflow-copy'

const allowedTags = [
  'a', 'blockquote', 'br', 'code', 'em', 'h1', 'h2', 'h3', 'h4', 'hr', 'li', 'ol', 'p', 'pre', 'strong',
  'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul',
]

export function renderMarkdown(markdown: string): string {
  const parsed = marked.parse(markdown, { async: false, gfm: true, breaks: false })
  const sanitized = DOMPurify.sanitize(parsed, {
    ALLOWED_TAGS: allowedTags,
    ALLOWED_ATTR: ['href', 'title'],
    ALLOW_DATA_ATTR: false,
  })
  const template = document.createElement('template')
  template.innerHTML = sanitized
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const node = walker.currentNode
    if (!node.parentElement?.closest('code, pre')) {
      const prose = (node.textContent ?? '').replace(/Run "hermes workflow doctor"/gi, 'Run the workflow compatibility check')
      node.textContent = workflowCopy(prose)
    }
  }
  for (const link of template.content.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const rawHref = link.getAttribute('href') ?? ''
    if (rawHref.startsWith('#')) {
      if (/^#(?:field|node|contract|guide):[A-Za-z0-9][A-Za-z0-9._-]*$/.test(rawHref)) {
        const button = document.createElement('button')
        button.type = 'button'
        button.dataset.topicId = rawHref.slice(1)
        button.setAttribute('aria-label', `Open documentation topic: ${link.textContent ?? rawHref.slice(1)}`)
        button.textContent = link.textContent
        link.replaceWith(button)
      } else link.removeAttribute('href')
      continue
    }
    const href = link.href
    if (/^https?:$/i.test(new URL(href).protocol)) {
      const button = document.createElement('button')
      button.type = 'button'
      button.dataset.externalUrl = href
      button.setAttribute('aria-label', 'Open external link')
      button.textContent = link.textContent
      link.replaceWith(button)
    } else link.removeAttribute('href')
  }
  return template.innerHTML
}
