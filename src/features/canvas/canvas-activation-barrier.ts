export interface CanvasPersistencePort {
  flushPersistence(): Promise<void>
}

export async function runAfterCanvasLayoutFlush<T>(
  getCanvas: () => CanvasPersistencePort | null,
  transition: () => Promise<T>,
  onPersistenceError: (error: unknown) => void,
): Promise<T> {
  try {
    await getCanvas()?.flushPersistence()
  } catch (error: unknown) {
    onPersistenceError(error)
    throw error
  }
  return transition()
}
