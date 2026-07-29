export type NodeChordKind = 'command' | 'prompt' | 'bash' | 'script' | 'loop' | 'approval' | 'cancel'
export type NodeChordCancellation = 'escape' | 'focus-loss' | 'unknown-key' | 'timeout'

export interface NodeChordState {
  readonly pending: boolean
  readonly choices: readonly string[]
  readonly afterSelection: boolean
  readonly lastCancellation?: NodeChordCancellation
}

export type NodeChordResult =
  | { readonly status: 'unhandled' }
  | { readonly status: 'pending'; readonly choices: readonly string[]; readonly afterSelection: boolean }
  | { readonly status: 'chosen'; readonly nodeKind: NodeChordKind; readonly afterSelection: boolean }
  | { readonly status: 'cancelled'; readonly reason: NodeChordCancellation }

const chordKinds: Readonly<Record<string, NodeChordKind>> = {
  C: 'command',
  P: 'prompt',
  B: 'bash',
  S: 'script',
  L: 'loop',
  A: 'approval',
  X: 'cancel',
}
const choiceLabels = Object.keys(chordKinds)

export class NodeChordController {
  #pending = false
  #afterSelection = false
  #lastCancellation: NodeChordCancellation | undefined
  #timer: ReturnType<typeof setTimeout> | undefined
  readonly timeoutMs: number
  readonly onChoose: ((kind: NodeChordKind, afterSelection: boolean) => void | Promise<void>) | undefined
  readonly onStateChange: ((state: NodeChordState) => void) | undefined

  constructor(
    options: {
      readonly timeoutMs?: number
      readonly onChoose?: (kind: NodeChordKind, afterSelection: boolean) => void | Promise<void>
      readonly onStateChange?: (state: NodeChordState) => void
    } = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 1500
    this.onChoose = options.onChoose
    this.onStateChange = options.onStateChange
  }

  get state(): NodeChordState {
    return {
      pending: this.#pending,
      choices: this.#pending ? choiceLabels : [],
      afterSelection: this.#afterSelection,
      ...(this.#lastCancellation ? { lastCancellation: this.#lastCancellation } : {}),
    }
  }

  handleKey(event: Pick<KeyboardEvent, 'key'> & { readonly shiftKey?: boolean }): NodeChordResult {
    const key = event.key.toUpperCase()
    if (!this.#pending) {
      if (key !== 'N') return { status: 'unhandled' }
      this.#pending = true
      this.#afterSelection = Boolean(event.shiftKey)
      this.#lastCancellation = undefined
      this.#timer = setTimeout(() => this.cancel('timeout'), this.timeoutMs)
      this.publish()
      return { status: 'pending', choices: choiceLabels, afterSelection: this.#afterSelection }
    }
    if (key === 'ESCAPE') return this.cancel('escape')
    const nodeKind = chordKinds[key]
    if (!nodeKind) return this.cancel('unknown-key')
    const afterSelection = this.#afterSelection
    this.clearPending()
    this.publish()
    void this.onChoose?.(nodeKind, afterSelection)
    return { status: 'chosen', nodeKind, afterSelection }
  }

  cancel(reason: NodeChordCancellation): NodeChordResult {
    if (!this.#pending) return { status: 'unhandled' }
    this.clearPending()
    this.#lastCancellation = reason
    this.publish()
    return { status: 'cancelled', reason }
  }

  dispose(): void {
    this.clearPending()
  }

  private clearPending(): void {
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = undefined
    this.#pending = false
    this.#afterSelection = false
  }

  private publish(): void {
    this.onStateChange?.(this.state)
  }
}
