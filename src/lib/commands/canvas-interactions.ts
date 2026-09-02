const panActivationKey = 'Space' as const

export interface CanvasPanInteraction {
  readonly id: 'canvas.pan'
  readonly kind: 'gesture'
  readonly label: string
  readonly description: string
  readonly category: 'Canvas'
  readonly bindings: readonly string[]
  readonly contexts: readonly ['Canvas']
  readonly activationKey: typeof panActivationKey
  readonly panOnDrag: boolean
}

export const CANVAS_PAN_INTERACTION: CanvasPanInteraction = {
  id: 'canvas.pan',
  kind: 'gesture',
  label: 'Pan canvas',
  description: 'Temporarily pan the graph without changing workflow YAML.',
  category: 'Canvas',
  bindings: [`${panActivationKey} + drag`],
  contexts: ['Canvas'],
  activationKey: panActivationKey,
  panOnDrag: true,
}
