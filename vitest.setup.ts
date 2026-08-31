import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/svelte'
import { afterEach } from 'vitest'

if (!globalThis.ResizeObserver) {
  class TestResizeObserver implements ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }

  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: TestResizeObserver,
  })
}

if (typeof window.matchMedia !== 'function') {
  class TestMediaQueryList extends EventTarget implements MediaQueryList {
    readonly matches = false
    private changeHandler: ((this: MediaQueryList, event: MediaQueryListEvent) => unknown) | null = null

    constructor(readonly media: string) {
      super()
    }

    get onchange(): ((this: MediaQueryList, event: MediaQueryListEvent) => unknown) | null {
      return this.changeHandler
    }

    set onchange(callback: ((this: MediaQueryList, event: MediaQueryListEvent) => unknown) | null) {
      if (this.changeHandler) this.removeEventListener('change', this.changeHandler as EventListener)
      this.changeHandler = callback
      if (callback) this.addEventListener('change', callback as EventListener)
    }

    addListener(callback: ((this: MediaQueryList, event: MediaQueryListEvent) => unknown) | null): void {
      if (callback) this.addEventListener('change', callback as EventListener)
    }

    removeListener(callback: ((this: MediaQueryList, event: MediaQueryListEvent) => unknown) | null): void {
      if (callback) this.removeEventListener('change', callback as EventListener)
    }
  }

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => new TestMediaQueryList(query),
  })
}

afterEach(() => {
  cleanup()
})
