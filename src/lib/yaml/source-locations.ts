export function buildLineStarts(text: string): readonly number[] {
  const starts = [0]

  for (let index = 0; index < text.length; index += 1) {
    const codeUnit = text.charCodeAt(index)
    if (codeUnit === 0x0d && text.charCodeAt(index + 1) === 0x0a) {
      starts.push(index + 2)
      index += 1
    } else if (codeUnit === 0x0a || codeUnit === 0x0d) {
      starts.push(index + 1)
    }
  }

  return starts
}
