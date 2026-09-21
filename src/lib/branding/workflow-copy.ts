/** Presentation only: never apply to workflow source, paths, or contract payloads. */
export function workflowCopy(text: string): string {
  return text.replace(/(?<![\w./\\-])hermes(?![\w/\\-]|\.\w)/gi, 'loop24')
}

export function profileLabel(profile: string): string {
  return profile === 'hermes-legacy' ? 'Legacy' : profile
}
