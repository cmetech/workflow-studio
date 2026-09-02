export type NodeChordKind = 'command' | 'prompt' | 'bash' | 'script' | 'loop' | 'approval' | 'cancel'
export type NodeChordCancellation = 'escape' | 'focus-loss' | 'unknown-key' | 'timeout'

export interface NodeChordChoice {
  readonly key: 'C' | 'P' | 'B' | 'S' | 'L' | 'A' | 'X'
  readonly nodeKind: NodeChordKind
  readonly label: string
}

export const NODE_CHORD_CHOICES: readonly NodeChordChoice[] = [
  { key: 'C', nodeKind: 'command', label: 'Command node' },
  { key: 'P', nodeKind: 'prompt', label: 'Prompt node' },
  { key: 'B', nodeKind: 'bash', label: 'Bash node' },
  { key: 'S', nodeKind: 'script', label: 'Script node' },
  { key: 'L', nodeKind: 'loop', label: 'Loop node' },
  { key: 'A', nodeKind: 'approval', label: 'Approval node' },
  { key: 'X', nodeKind: 'cancel', label: 'Cancel node' },
]

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

const choiceLabels = NODE_CHORD_CHOICES.map(({ key }) => key)

export function nodeChordForKind(kind: string): string | undefined {
  const choice = NODE_CHORD_CHOICES.find((candidate) => candidate.nodeKind === kind)
  return choice ? `N ${choice.key}` : undefined
}

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
    const choice = NODE_CHORD_CHOICES.find((candidate) => candidate.key === key)
    if (!choice) return this.cancel('unknown-key')
    const afterSelection = this.#afterSelection
    this.clearPending()
    this.publish()
    void this.onChoose?.(choice.nodeKind, afterSelection)
    return { status: 'chosen', nodeKind: choice.nodeKind, afterSelection }
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
