import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { markdown } from '@codemirror/lang-markdown'
import { json } from '@codemirror/lang-json'
import { yaml, yamlFrontmatter } from '@codemirror/lang-yaml'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { ArtifactLanguage } from '$src/lib/artifacts/types'

export function languageExtension(language: ArtifactLanguage): Extension {
  switch (language) {
    case 'python':
      return python()
    case 'typescript':
      return javascript({ typescript: true })
    case 'javascript':
      return javascript()
    case 'json':
      return json()
    case 'yaml':
      return yaml()
    case 'markdown':
      return yamlFrontmatter({ content: markdown() })
    case 'text':
      return []
  }
}
export const artifactEditorTheme = EditorView.theme({
  '&': { height: '100%', color: 'var(--color-text)', backgroundColor: 'var(--color-surface)' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)' },
  '.cm-content': { caretColor: 'var(--color-focus)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-focus)', borderLeftWidth: '2px' },
  '.cm-gutters': {
    color: 'var(--color-text-muted)',
    backgroundColor: 'var(--color-yaml-gutter)',
    borderRight: '1px solid var(--color-border)',
  },
  '&.cm-focused': { outline: '2px solid var(--color-focus)', outlineOffset: '-2px' },
  '@media (forced-colors: active)': { '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'CanvasText' } },
})
