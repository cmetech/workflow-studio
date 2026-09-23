import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { languageExtension } from './artifact-editor-extensions'

describe('artifact language extensions', () => {
  it.each(['python', 'typescript', 'javascript', 'json', 'yaml', 'markdown', 'text'] as const)(
    'builds an offline %s editor',
    (language) => {
      const state = EditorState.create({ doc: 'value', extensions: [languageExtension(language)] })
      expect(state.doc.toString()).toBe('value')
      if (language !== 'text') expect(syntaxTree(state).length).toBe(5)
    },
  )
})
