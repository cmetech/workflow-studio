import DOMPurify from 'dompurify'
import { marked } from 'marked'

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
  for (const link of template.content.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const href = link.href
    if (link.getAttribute('href')?.startsWith('#')) continue
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
