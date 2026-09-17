import { describe, expect, it, vi } from 'vitest'
import { loadDocumentationGuides } from './guide-sources'

describe('lazy documentation guides', () => {
  it('does not request bundled markdown until the guide catalog is explicitly loaded', async () => {
    const start = vi.fn(async () => '# Quick start\n\nWelcome.')
    const keyboard = vi.fn(async () => '# Keyboard authoring\n\nUse shortcuts.')
    const sources = {
      '/docs/app-guides/quick-start.md': start,
      '/docs/app-guides/keyboard-shortcuts.md': keyboard,
    }

    expect(start).not.toHaveBeenCalled()
    expect(keyboard).not.toHaveBeenCalled()

    const loading = loadDocumentationGuides(sources)
    expect(start).toHaveBeenCalledOnce()
    expect(keyboard).toHaveBeenCalledOnce()
    await expect(loading).resolves.toEqual([
      expect.objectContaining({ id: 'quick-start', title: 'Quick start', body: 'Welcome.' }),
      expect.objectContaining({ id: 'keyboard-shortcuts', title: 'Keyboard authoring', body: 'Use shortcuts.' }),
    ])
  })

  it('fails the whole bounded catalog when a deferred guide cannot be read', async () => {
    await expect(
      loadDocumentationGuides({ '/docs/app-guides/quick-start.md': async () => Promise.reject(new Error('missing')) }),
    ).rejects.toThrow('missing')
  })
})
