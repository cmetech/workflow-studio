import { render, screen, within } from '@testing-library/svelte'
import { expect, it } from 'vitest'
import PackageChangeList from './PackageChangeList.svelte'
it('shows renamed resources, trust changes and the exact authorized file list', () => {
  render(PackageChangeList, {
    changes: [{ kind: 'renamed', path: 'scripts/new.py', previousPath: 'scripts/old.py', trustImpact: true }],
    includedPaths: ['packages/sample/scripts/new.py', '.well-known/hermes-workflows/index.json'],
    trustChanges: ['Script content changed'],
  })
  expect(screen.getByText('scripts/old.py')).toBeVisible()
  expect(screen.getByText('scripts/new.py')).toBeVisible()
  expect(screen.getByText('Script content changed')).toBeVisible()
  const files = within(screen.getByRole('region', { name: 'Files included in the local version' }))
  expect(files.getByText('packages/sample/scripts/new.py')).toBeVisible()
  expect(files.getByText('.well-known/hermes-workflows/index.json')).toBeVisible()
})
it('escapes untrusted path and trust descriptions as plain text', () => {
  render(PackageChangeList, {
    changes: [{ kind: 'added', path: '<img src=x onerror=alert(1)>' }],
    includedPaths: ['safe.txt'],
    trustChanges: ['<script>bad()</script>'],
  })
  expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeVisible()
  expect(document.querySelector('img')).toBeNull()
  expect(document.querySelector('script')).toBeNull()
})
