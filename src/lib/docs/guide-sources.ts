import { GUIDE_PRESENTATION } from './navigation'
import type { DocumentationGuide } from './types'

export function createDocumentationGuides(
  sources: Readonly<Record<string, string>>,
): readonly DocumentationGuide[] {
  return Object.entries(sources)
    .map(([path, source]) => {
      const id = path.split('/').at(-1)?.replace(/\.md$/, '') ?? path
      const presentation = GUIDE_PRESENTATION[id]
      if (!presentation) throw new Error(`Missing documentation guide metadata: ${id}`)
      const heading = /^#\s+([^\r\n]+)(?:\r?\n|$)/.exec(source)
      const body = heading ? source.slice(heading[0].length).replace(/^\r?\n/, '') : source
      return {
        id,
        title: heading?.[1]?.trim() || id,
        body,
        ...presentation,
      }
    })
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
}
