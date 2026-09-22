<script lang="ts">
  import DOMPurify from 'dompurify'
  import { marked } from 'marked'
  let { markdown }: { markdown: string } = $props()
  const html = $derived(
    DOMPurify.sanitize(marked.parse(markdown, { async: false, gfm: true }), {
      ALLOWED_TAGS: [
        'a',
        'blockquote',
        'br',
        'code',
        'em',
        'h1',
        'h2',
        'h3',
        'h4',
        'hr',
        'li',
        'ol',
        'p',
        'pre',
        'strong',
        'table',
        'tbody',
        'td',
        'th',
        'thead',
        'tr',
        'ul',
      ],
      ALLOWED_ATTR: [],
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
    }),
  )
</script>

<!-- eslint-disable-next-line svelte/no-at-html-tags -- DOMPurify allows only passive tags and removes every attribute. -->
<article aria-label="Command preview">{@html html}</article>

<style>
  article {
    padding: 1rem;
    overflow: auto;
    overflow-wrap: anywhere;
  }
  article :global(pre) {
    white-space: pre-wrap;
    font-family: var(--font-mono);
  }
</style>
