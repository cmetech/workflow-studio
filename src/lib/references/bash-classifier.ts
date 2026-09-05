// Direct authored-source state port of Hermes bash_rendering.py at a960d5e7.
// This is lexical admission only: no shell parser, expansion, execution or I/O.
import { ScannerValueError, type ReferenceSpan } from './grammar'
import { asciiAlpha, asciiAlnum, CodePoints, unicodePredicate } from './unicode'
export type BashQuote = "'" | '"' | null
export type ClassifiedBashSpan = readonly [start: number, end: number, quote: BashQuote]
export class BashRenderingError extends Error {
  readonly code = 'bash_reference_context_unsupported'
  constructor(message = 'Bash reference appears in an unsupported shell context') {
    super(message)
    this.name = 'BashRenderingError'
  }
}
type Heredoc = readonly [delimiter: string, stripTabs: boolean, quoted: boolean]
interface Frame {
  kind: string
  resumeQuote: BashQuote
  parenthesisDepth: number
  bracketDepth: number
  caseStates: string[]
  commandPosition: boolean
  pendingHeredocs: Heredoc[]
}
const separators = ' \t\r\n;|&()<>'
const member = (text: string, c: string) => !!c && text.includes(c)
function logicalToken(source: CodePoints, start: number, token: string): readonly [number, number[]] | null {
  let cursor = start
  const starts: number[] = []
  for (const expected of token) {
    while (source.startsWith('\\\n', cursor)) cursor += 2
    if (cursor >= source.length || source.at(cursor) !== expected) return null
    starts.push(cursor)
    cursor++
  }
  return [cursor, starts]
}
function skipContinuations(source: CodePoints, start: number): number {
  while (source.startsWith('\\\n', start)) start += 2
  return start
}
function parseHeredoc(source: CodePoints, start: number): readonly [number, number, string, boolean, boolean] | null {
  const operator = logicalToken(source, start, '<<')
  if (!operator || logicalToken(source, start, '<<<')) return null
  let cursor = skipContinuations(source, operator[0])
  const stripTabs = source.at(cursor) === '-'
  if (stripTabs) cursor = skipContinuations(source, cursor + 1)
  while (member(' \t', source.at(cursor))) cursor++
  const delimiterStart = cursor
  let delimiter = '',
    quote: BashQuote | 'ambiguous' = null,
    quoted = false
  while (cursor < source.length) {
    const item = source.at(cursor)
    if (quote === null && member(' \t\r\n;&|<>()', item)) break
    if (item === '\\' && quote !== "'") {
      const following = source.at(cursor + 1)
      if (!following) {
        quote = 'ambiguous'
        break
      }
      if (following === '\n') {
        cursor += 2
        continue
      }
      quoted = true
      delimiter += quote === '"' && !member('$`"\\', following) ? '\\' + following : following
      cursor += 2
      continue
    }
    if (item === "'" && quote !== '"') {
      quoted = true
      quote = quote === "'" ? null : "'"
    } else if (item === '"' && quote !== "'") {
      quoted = true
      quote = quote === '"' ? null : '"'
    } else delimiter += item
    cursor++
  }
  if (!delimiter || quote !== null)
    throw new BashRenderingError('Bash reference appears near an ambiguous here-document delimiter')
  return [cursor, delimiterStart, delimiter, stripTabs, quoted]
}
function dequote(source: CodePoints, start: number, end: number) {
  let text = '',
    quote: BashQuote = null,
    cursor = start
  const starts: number[] = [],
    ends: number[] = []
  const append = (c: string, s: number, e: number) => {
    text += c
    starts.push(s)
    ends.push(e)
  }
  while (cursor < end) {
    const c = source.at(cursor)
    if (quote === "'") {
      if (c === "'") quote = null
      else append(c, cursor, cursor + 1)
      cursor++
      continue
    }
    if (c === "'" && quote === null) {
      quote = "'"
      cursor++
      continue
    }
    if (c === '"') {
      quote = quote === '"' ? null : '"'
      cursor++
      continue
    }
    if (c === '\\' && cursor + 1 < end) {
      const next = source.at(cursor + 1)
      if (next === '\n') {
        cursor += 2
        continue
      }
      if (quote !== '"' || member('$`"\\', next)) {
        append(next, cursor, cursor + 2)
        cursor += 2
        continue
      }
    }
    append(c, cursor, cursor + 1)
    cursor++
  }
  if (quote !== null) throw new BashRenderingError('Bash reference appears in an ambiguous shell word')
  return { word: new CodePoints(text), starts, ends }
}
function assignment(word: CodePoints): { valid: boolean; subscript: ReferenceSpan | null } {
  let cursor = 0
  if (!(asciiAlpha(word.at(0)) || word.at(0) === '_')) return { valid: false, subscript: null }
  cursor++
  while (asciiAlnum(word.at(cursor)) || word.at(cursor) === '_') cursor++
  let subscript: ReferenceSpan | null = null
  if (word.at(cursor) === '[') {
    const start = cursor++
    let depth = 1
    while (cursor < word.length && depth) {
      if (word.at(cursor) === '[') depth++
      else if (word.at(cursor) === ']') depth--
      cursor++
    }
    if (depth) return { valid: false, subscript: null }
    subscript = [start, cursor]
  }
  if (word.at(cursor) === '+') cursor++
  const valid = word.at(cursor) === '='
  return { valid, subscript: valid ? subscript : null }
}
export function classifyBashReferenceSpans(
  text: string,
  spans: Iterable<ReferenceSpan>,
): readonly ClassifiedBashSpan[] {
  const source = new CodePoints(text),
    ordered = Array.from(spans)
  let priorEnd = 0
  for (const span of ordered) {
    if (span.length !== 2) throw new ScannerValueError('Bash substitution offsets require a pair')
    const [start, end] = span
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < priorEnd ||
      start < 0 ||
      end <= start ||
      end > source.length
    )
      throw new ScannerValueError('Bash substitution offsets must be valid, ordered and disjoint')
    priorEnd = end
  }
  const byStart = new Map(ordered),
    starts = ordered.map((span) => span[0]),
    decisions = new Map<number, BashQuote | boolean>()
  let quote: BashQuote = null
  const frames: Frame[] = [],
    topHeredocs: Heredoc[] = []
  let wordStart = true,
    position = 0,
    compoundDepth = 0,
    arrayStart: number | null = null,
    arrayDepth = 0,
    commandPosition = true,
    assignmentBuiltin = false,
    arithmeticBuiltin: string | null = null,
    integerAttribute = false,
    commandWrapper: string | null = null,
    redirectionOperand = false,
    topWordStart: number | null = null
  function decideRange(start: number, end: number, decision: boolean) {
    let low = 0,
      high = starts.length
    while (low < high) {
      const mid = (low + high) >>> 1
      if (starts[mid]! < start) low = mid + 1
      else high = mid
    }
    for (let i = low; i < starts.length && starts[i]! < end; i++) {
      const key = starts[i]!
      if (decision === false && decisions.get(key) === true) continue
      decisions.set(key, decision)
    }
  }
  const unsupported = (start: number, end: number) => decideRange(start, end, false)
  function consumeHeredocs(start: number, pending: Heredoc[]): number {
    let cursor = start
    for (const [delimiter, stripTabs, quoted] of pending) {
      const bodyStart = cursor
      let terminated = false
      while (cursor <= source.length) {
        let line = '',
          lineEnd = cursor,
          newline = -1
        while (true) {
          newline = source.indexOf('\n', lineEnd)
          const physicalEnd = newline < 0 ? source.length : newline
          const part = source.slice(lineEnd, physicalEnd)
          const trailing = /\\*$/.exec(part)![0].length
          if (!quoted && newline >= 0 && trailing % 2 === 1) {
            line += part.slice(0, -1)
            lineEnd = newline + 1
            continue
          }
          line += part
          lineEnd = physicalEnd
          break
        }
        if ((stripTabs ? line.replace(/^\t+/, '') : line) === delimiter) {
          unsupported(bodyStart, lineEnd)
          cursor = newline < 0 ? source.length : newline + 1
          terminated = true
          break
        }
        if (newline < 0) throw new BashRenderingError('Bash reference appears in an unterminated here-document')
        cursor = newline + 1
      }
      if (!terminated) throw new BashRenderingError('Bash reference appears in an ambiguous here-document')
    }
    pending.length = 0
    return cursor
  }
  function beginHeredoc(start: number): number | null {
    const parsed = parseHeredoc(source, start)
    if (!parsed) return null
    const [cursor, delimiterStart, delimiter, stripTabs, quoted] = parsed
    unsupported(delimiterStart, cursor)
    const last = frames.at(-1)
    ;(last && ['command', 'backtick'].includes(last.kind) ? last.pendingHeredocs : topHeredocs).push([
      delimiter,
      stripTabs,
      quoted,
    ])
    return cursor
  }
  function shellWordEnd(start: number, word: string): number | null {
    if (start >= source.length || source.at(start) !== word[0]) return null
    const match = logicalToken(source, start, word)
    if (!match) return null
    let beforeCursor = start
    while (beforeCursor >= 2 && source.startsWith('\\\n', beforeCursor - 2)) beforeCursor -= 2
    const before = beforeCursor ? source.at(beforeCursor - 1) : ' ',
      end = skipContinuations(source, match[0]),
      after = end < source.length ? source.at(end) : ' '
    return member(separators, before) && member(separators, after) ? end : null
  }
  function braceEnd(start: number): number | null {
    let cursor = start + 1,
      depth = 1,
      nested: BashQuote = null,
      hasSeparator = false
    while (cursor < source.length) {
      const c = source.at(cursor)
      if (nested === "'") {
        if (c === "'") nested = null
        cursor++
        continue
      }
      if (c === '\\') {
        cursor = Math.min(source.length, cursor + 2)
        continue
      }
      if (c === "'") {
        nested = "'"
        cursor++
        continue
      }
      if (c === '"') {
        nested = nested === '"' ? null : '"'
        cursor++
        continue
      }
      if (nested !== null) {
        cursor++
        continue
      }
      if (member(' \t\r\n;|&<>()', c)) return null
      if (c === '{') {
        if (++depth > 64) return null
      } else if (c === '}') {
        if (--depth === 0) return hasSeparator ? cursor + 1 : null
      } else if (c === ',' || source.startsWith('..', cursor)) hasSeparator = true
      cursor++
    }
    return null
  }
  function assignmentBefore(end: number, allowQuote = false): boolean {
    let cursor = end
    while (cursor > 0 && (asciiAlnum(source.at(cursor - 1)) || source.at(cursor - 1) === '_')) cursor--
    if (cursor === end || !(asciiAlpha(source.at(cursor)) || source.at(cursor) === '_')) return false
    return (
      cursor === 0 || member(separators, source.at(cursor - 1)) || (allowQuote && member('\'"', source.at(cursor - 1)))
    )
  }
  function beginsCompound(start: number): boolean {
    if (start === 0 || source.at(start - 1) !== '=') return false
    let end = start - 1
    if (source.at(end - 1) === '+') end--
    return assignmentBefore(end)
  }
  function finishWord(end: number): void {
    if (topWordStart === null) return
    const start = topWordStart
    topWordStart = null
    if (redirectionOperand) {
      redirectionOperand = false
      return
    }
    if (!commandPosition) return
    const { word, starts, ends } = dequote(source, start, end),
      parsed = assignment(word),
      value = word.text
    if (parsed.subscript && (commandPosition || assignmentBuiltin))
      unsupported(starts[parsed.subscript[0]]!, ends[parsed.subscript[1] - 1]!)
    if (arithmeticBuiltin === 'let') {
      unsupported(start, end)
      return
    }
    if (assignmentBuiltin) {
      if (!parsed.valid && value === '--') return
      if (
        !parsed.valid &&
        word.length > 1 &&
        member('-+', word.at(0)) &&
        unicodePredicate(word.slice(1), 'alphabetic')
      ) {
        if (value.slice(1).includes('i')) integerAttribute = word.at(0) === '-'
        return
      }
      if (integerAttribute) unsupported(start, end)
      return
    }
    if (parsed.valid) return
    if (['builtin', 'command'].includes(value)) {
      commandWrapper = value
      return
    }
    if (commandWrapper === 'command' && ['-p', '--'].includes(value)) return
    if (commandWrapper === 'builtin' && value === '--') return
    commandWrapper = null
    if (value === 'let') {
      arithmeticBuiltin = 'let'
      return
    }
    if (['declare', 'export', 'local', 'readonly', 'typeset'].includes(value)) {
      assignmentBuiltin = true
      integerAttribute = false
      return
    }
    if (['!', 'do', 'elif', 'else', 'for', 'if', 'select', 'then', 'time', 'until', 'while', '{'].includes(value))
      return
    commandPosition = false
  }
  function functionEnd(start: number): number | null {
    const end = shellWordEnd(start, 'function')
    if (end === null) return null
    let cursor = end
    if (!member(' \t', source.at(cursor))) return null
    while (member(' \t', source.at(cursor))) cursor++
    const nameStart = cursor
    while (cursor < source.length && !member(separators, source.at(cursor))) {
      if (member('\'"\\$`', source.at(cursor)))
        throw new BashRenderingError('Bash reference follows an ambiguous function declaration')
      cursor++
    }
    if (cursor === nameStart) throw new BashRenderingError('Bash reference follows an ambiguous function declaration')
    return cursor
  }
  function coprocessEnd(start: number): number | null {
    const end = shellWordEnd(start, 'coproc')
    if (end === null) return null
    if (!member(' \t', source.at(end))) return end
    let cursor = end
    while (member(' \t', source.at(cursor))) cursor++
    if (
      ['case', 'if', 'for', 'select', 'while', 'until', 'function', 'coproc', 'time', '!', '{', '((', '(', '[['].some(
        (w) => shellWordEnd(cursor, w) !== null,
      )
    )
      return end
    const nameStart = cursor
    while (cursor < source.length && !member(separators, source.at(cursor))) {
      if (member('\'"\\$`', source.at(cursor)))
        throw new BashRenderingError('Bash reference follows an ambiguous coprocess declaration')
      cursor++
    }
    return cursor > nameStart ? cursor : end
  }
  function checkNesting() {
    if (frames.length + frames.reduce((n, f) => n + f.caseStates.length, 0) + 1 > 64)
      throw new BashRenderingError('Bash reference nesting exceeds its lexer bound')
  }
  function markWord() {
    const frame = frames.at(-1)
    if (frame?.kind === 'command') frame.commandPosition = false
  }
  function push(kind: string) {
    frames.push({
      kind,
      resumeQuote: quote,
      parenthesisDepth: 1,
      bracketDepth: 1,
      caseStates: [],
      commandPosition: true,
      pendingHeredocs: [],
    })
    quote = null
  }
  function pop() {
    quote = frames.pop()!.resumeQuote
  }
  while (position < source.length) {
    if (byStart.has(position)) decisions.set(position, frames.length ? false : quote)
    let character = source.at(position)
    if (!frames.length && quote === null && compoundDepth === 0 && commandPosition && topWordStart === null) {
      const coproc = coprocessEnd(position)
      if (coproc !== null) {
        position = coproc
        wordStart = true
        continue
      }
      const fn = functionEnd(position)
      if (fn !== null) {
        position = fn
        wordStart = true
        continue
      }
    }
    if (
      !frames.length &&
      quote === null &&
      compoundDepth === 0 &&
      topWordStart === null &&
      !member(separators, character)
    )
      topWordStart = position
    if (frames.at(-1)?.kind === 'ansi_c') {
      if (character === '\\') position = Math.min(source.length, position + 2)
      else if (character === "'") {
        pop()
        position++
      } else position++
      wordStart = false
      continue
    }
    if (quote !== "'" && character === '\\') {
      const escaped = position + 1
      if (byStart.has(escaped)) decisions.set(escaped, true)
      const escapedCharacter = source.at(escaped)
      position = Math.min(source.length, position + 2)
      if (escapedCharacter !== '\n') {
        wordStart = false
        markWord()
      }
      continue
    }
    if (!frames.length && assignmentBuiltin && quote !== null) {
      if (arrayStart !== null) {
        if (character === '[') arrayDepth++
        else if (character === ']') {
          if (--arrayDepth === 0) {
            const suffix = source.slice(position + 1, position + 3)
            if (suffix.startsWith('=') || suffix.startsWith('+=')) unsupported(arrayStart, position + 1)
            arrayStart = null
          }
        }
      } else if (character === '[' && assignmentBefore(position, true)) {
        arrayStart = position
        arrayDepth = 1
      }
    }
    const commentsAllowed = !frames.length || ['command', 'backtick'].includes(frames.at(-1)!.kind)
    if (quote === null && commentsAllowed && character === '#' && wordStart) {
      const newline = source.indexOf('\n', position),
        end = newline < 0 ? source.length : newline
      decideRange(position, end, true)
      if (!frames.length && topWordStart === position) topWordStart = null
      if (newline < 0) {
        position = source.length
        continue
      }
      position = newline
      character = '\n'
    }
    if (quote === "'") {
      if (character === "'") quote = null
      position++
      wordStart = false
      continue
    }
    if (character === "'" && quote === null) {
      markWord()
      quote = "'"
      position++
      wordStart = false
      continue
    }
    if (character === '"') {
      if (quote === null) markWord()
      quote = quote === '"' ? null : '"'
      position++
      wordStart = false
      continue
    }
    if (character === '`') {
      if (frames.at(-1)?.kind === 'backtick') {
        pop()
        wordStart = false
      } else {
        if (frames.length >= 64) throw new BashRenderingError('Bash reference nesting exceeds its lexer bound')
        markWord()
        push('backtick')
        wordStart = true
      }
      position++
      continue
    }
    const dollars = character === '$' ? logicalToken(source, position, '$$') : null
    if (dollars) {
      if (byStart.has(dollars[1][1]!)) decisions.set(dollars[1][1]!, true)
      markWord()
      position = dollars[0]
      wordStart = false
      continue
    }
    if (character === '$' && position + 1 < source.length) {
      const options = [
        ['$((', 'arithmetic'],
        ['$(', 'command'],
        ['$[', 'legacy_arithmetic'],
        ...(quote === null ? [["$'", 'ansi_c']] : []),
        ['${', 'parameter'],
      ]
      let opened = false
      for (const [token, kind] of options) {
        const match = logicalToken(source, position, token!)
        if (match) {
          checkNesting()
          markWord()
          push(kind!)
          position = match[0]
          wordStart = kind === 'command'
          opened = true
          break
        }
      }
      if (opened) continue
    }
    const arithmeticOpen = character === '(' ? logicalToken(source, position, '((') : null
    if (quote === null && !frames.length && arithmeticOpen) {
      checkNesting()
      push('arithmetic')
      position = arithmeticOpen[0]
      wordStart = false
      continue
    }
    const conditionalOpen = quote === null ? shellWordEnd(position, '[[') : null,
      last = frames.at(-1)
    if (
      quote === null &&
      conditionalOpen !== null &&
      ((!frames.length && commandPosition) ||
        (last?.kind === 'command' &&
          last.commandPosition &&
          (!last.caseStates.length || last.caseStates.at(-1) === 'body')))
    ) {
      checkNesting()
      markWord()
      push('conditional')
      position = conditionalOpen
      wordStart = true
      continue
    }
    const processSub = member('<>', character) ? logicalToken(source, position, character + '(') : null
    if (quote === null && processSub && (!frames.length || ['command', 'backtick'].includes(frames.at(-1)!.kind))) {
      checkNesting()
      markWord()
      push('command')
      position = processSub[0]
      wordStart = true
      continue
    }
    const extglob = member('@!+?*', character) ? logicalToken(source, position, character + '(') : null
    if (quote === null && extglob) {
      checkNesting()
      markWord()
      push('extglob')
      position = extglob[0]
      wordStart = false
      continue
    }
    if (quote === null && !frames.length && character === '{' && braceEnd(position) !== null) {
      checkNesting()
      push('brace')
      position++
      wordStart = false
      continue
    }
    const hereString =
      character === '<' && quote === null && (!frames.length || ['command', 'backtick'].includes(frames.at(-1)!.kind))
        ? logicalToken(source, position, '<<<')
        : null
    if (hereString) {
      if (!frames.length && compoundDepth === 0) {
        if (topWordStart !== null && unicodePredicate(source.slice(topWordStart, position), 'digit'))
          topWordStart = null
        redirectionOperand = true
      }
      position = hereString[0]
      wordStart = true
      continue
    }
    const heredoc =
      character === '<' && quote === null && (!frames.length || ['command', 'backtick'].includes(frames.at(-1)!.kind))
        ? beginHeredoc(position)
        : null
    if (heredoc !== null) {
      if (
        !frames.length &&
        compoundDepth === 0 &&
        commandPosition &&
        topWordStart !== null &&
        unicodePredicate(source.slice(topWordStart, position), 'digit')
      ) {
        topWordStart = null
        redirectionOperand = false
      }
      position = heredoc
      wordStart = false
      continue
    }
    if (quote === null && !frames.length && compoundDepth === 0 && commandPosition && member('<>', character)) {
      if (topWordStart !== null && unicodePredicate(source.slice(topWordStart, position), 'digit')) topWordStart = null
      redirectionOperand = true
    }
    let closedCompound = false
    if (quote === null && !frames.length) {
      if (arrayStart !== null) {
        if (character === '[') arrayDepth++
        else if (character === ']') {
          if (--arrayDepth === 0) {
            const suffix = source.slice(position + 1, position + 3)
            if (suffix.startsWith('=') || suffix.startsWith('+=')) unsupported(arrayStart, position + 1)
            arrayStart = null
          }
        }
      } else if (
        character === '[' &&
        ((compoundDepth > 0 && wordStart) || (commandPosition && assignmentBefore(position)))
      ) {
        arrayStart = position
        arrayDepth = 1
      }
      if (arrayStart === null) {
        if (character === '(' && commandPosition && beginsCompound(position)) compoundDepth = 1
        else if (compoundDepth > 0) {
          if (character === '(') compoundDepth++
          else if (character === ')') {
            compoundDepth--
            closedCompound = compoundDepth === 0
          }
        }
      }
    }
    if (frames.length && quote === null) {
      const frame = frames.at(-1)!
      if (frame.kind === 'conditional') {
        const close = shellWordEnd(position, ']]')
        if (close !== null) {
          pop()
          if (frames.at(-1)?.kind === 'command') frames.at(-1)!.commandPosition = false
          position = close
          wordStart = false
          continue
        }
        position++
        wordStart = member(' \t\r\n', character)
        continue
      }
      if (frame.kind === 'parameter' && character === '}') {
        pop()
        position++
        continue
      }
      if (frame.kind === 'backtick') {
        position++
        wordStart = member(separators, character)
        if (character === '\n' && frame.pendingHeredocs.length)
          position = consumeHeredocs(position, frame.pendingHeredocs)
        continue
      }
      if (frame.kind === 'command') {
        const state = frame.caseStates.at(-1) ?? null,
          body = state === null || state === 'body'
        const coproc = frame.commandPosition && body ? coprocessEnd(position) : null
        if (coproc !== null) {
          frame.commandPosition = true
          wordStart = true
          position = coproc
          continue
        }
        const fn = frame.commandPosition && body ? functionEnd(position) : null
        if (fn !== null) {
          frame.commandPosition = true
          wordStart = true
          position = fn
          continue
        }
        const prefix =
          frame.commandPosition && body
            ? ['while', 'until', 'select', 'then', 'else', 'elif', 'time', 'for', 'if', 'do', '-p', '!', '{']
                .map((w) => shellWordEnd(position, w))
                .find((end) => end !== null)
            : undefined
        if (prefix !== undefined && prefix !== null) {
          wordStart = false
          position = prefix
          continue
        }
        const terminator =
          state === 'body' ? [';;&', ';;', ';&'].find((t) => source.startsWith(t, position)) : undefined
        if (terminator) {
          frame.caseStates[frame.caseStates.length - 1] = 'pattern'
          frame.commandPosition = true
          wordStart = true
          position += terminator.length
          continue
        }
        const esac =
          (state === 'pattern' || state === 'body') && frame.commandPosition ? shellWordEnd(position, 'esac') : null
        if (esac !== null) {
          frame.caseStates.pop()
          frame.commandPosition = false
          wordStart = false
          position = esac
          continue
        }
        const inEnd = state === 'word' ? shellWordEnd(position, 'in') : null
        if (inEnd !== null) {
          frame.caseStates[frame.caseStates.length - 1] = 'pattern'
          frame.commandPosition = true
          wordStart = false
          position = inEnd
          continue
        }
        const caseEnd = frame.commandPosition && body ? shellWordEnd(position, 'case') : null
        if (caseEnd !== null) {
          checkNesting()
          frame.caseStates.push('word')
          frame.commandPosition = false
          wordStart = false
          position = caseEnd
          continue
        }
        let closed = false
        if (character === ')' && frame.caseStates.length) {
          if (frame.caseStates.at(-1) === 'pattern') {
            frame.caseStates[frame.caseStates.length - 1] = 'body'
            frame.commandPosition = true
            wordStart = true
            position++
            continue
          }
        } else if (character === '(' && !frame.caseStates.length) {
          frame.parenthesisDepth++
          frame.commandPosition = true
        } else if (character === ')' && !frame.caseStates.length) {
          if (--frame.parenthesisDepth === 0) {
            pop()
            closed = true
          }
        }
        if (closed) wordStart = false
        else if (character === ')' && !frame.caseStates.length) {
          wordStart = true
          frame.commandPosition = true
        } else if (member(' \t\r<>', character)) wordStart = true
        else if (member('\n;|&', character)) {
          wordStart = true
          frame.commandPosition = true
        } else {
          wordStart = false
          frame.commandPosition = false
        }
        position++
        if (character === '\n' && frame.pendingHeredocs.length)
          position = consumeHeredocs(position, frame.pendingHeredocs)
        continue
      }
      if (frame.kind === 'extglob') {
        if (character === '(') frame.parenthesisDepth++
        else if (character === ')' && --frame.parenthesisDepth === 0) pop()
        position++
        continue
      }
      if (frame.kind === 'brace') {
        if (character === '{') frame.bracketDepth++
        else if (character === '}' && --frame.bracketDepth === 0) pop()
        position++
        continue
      }
      if (frame.kind === 'arithmetic') {
        if (character === '(') frame.parenthesisDepth++
        else if (character === ')') {
          const close = logicalToken(source, position, '))')
          if (frame.parenthesisDepth === 1 && close) {
            pop()
            position = close[0]
            continue
          }
          frame.parenthesisDepth--
        }
        position++
        continue
      }
      if (frame.kind === 'legacy_arithmetic') {
        if (character === '[') frame.bracketDepth++
        else if (character === ']' && --frame.bracketDepth === 0) pop()
        position++
        continue
      }
    }
    if (quote === null && !frames.length && compoundDepth === 0 && member(separators, character)) {
      finishWord(closedCompound ? position + 1 : position)
      if (member('\n;|&', character) || (member('()', character) && !closedCompound)) {
        commandPosition = true
        assignmentBuiltin = false
        arithmeticBuiltin = null
        integerAttribute = false
        commandWrapper = null
      }
    }
    if (character === '\n') {
      position++
      wordStart = true
      if (topHeredocs.length) position = consumeHeredocs(position, topHeredocs)
      continue
    }
    wordStart = member(' \t\r;|&()<>', character) && quote === null
    position++
  }
  if (quote === null && !frames.length && compoundDepth === 0) finishWord(source.length)
  if (ordered.length && (quote !== null || frames.length || topHeredocs.length))
    throw new BashRenderingError('Bash reference appears in an unterminated or ambiguous shell state')
  if (starts.some((start) => !decisions.has(start)) || Array.from(decisions.values()).some((value) => value === false))
    throw new BashRenderingError()
  return ordered
    .filter(([start]) => decisions.get(start) !== true)
    .map(
      ([start, end]) =>
        [start, end, typeof decisions.get(start) === 'string' ? (decisions.get(start) as BashQuote) : null] as const,
    )
}
