import { render, screen } from '@testing-library/svelte'
import { expect, it } from 'vitest'
import CommandPreview from './CommandPreview.svelte'

it('sanitizes untrusted HTML and blocks active or remote embedded resources', () => {
  const { container } = render(CommandPreview, {
    markdown:
      '<script>window.pwned=true</script>Safe\n\n<img src="https://example.invalid/tracker" onerror="alert(1)"><iframe src="https://example.invalid"></iframe>\n\n[bad](javascript:alert(1))',
  })
  expect(screen.getByText(/Safe/)).toBeVisible()
  expect(container.querySelector('script, iframe, img, [onerror], a[href^="javascript:"]')).toBeNull()
})
it('renders Markdown without turning its links into app navigation', () => {
  const { container } = render(CommandPreview, {
    markdown: '# Review\n\n[Reference](https://example.invalid)\n\n```bash\nrm -rf example\n```',
  })
  expect(screen.getByRole('heading', { name: 'Review' })).toBeVisible()
  expect(screen.getByText('rm -rf example')).toBeVisible()
  expect(container.querySelector('a[href]')).toBeNull()
})
