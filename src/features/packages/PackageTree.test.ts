import { render, screen } from '@testing-library/svelte'
import { expect, it, vi } from 'vitest'
import PackageTree from './PackageTree.svelte'
import type { PackageGitSummary } from './package-git-summary'
it('provides a keyboard accessible empty package catalog', () => {
  render(PackageTree, { catalog: { packages: [], findings: [] }, onOpen: vi.fn() })
  expect(screen.getByRole('tree', { name: 'Packages' })).toBeVisible()
  expect(screen.getByText(/No packages/)).toBeVisible()
})
import { fireEvent, within } from '@testing-library/svelte'
import { loadBundledResourceResolution } from '$src/lib/package-contract/bundled-package-contract'
import type { WorkflowPackageProjection } from '$src/lib/packages/types'
import manifestText from '../../../tests/fixtures/workflow-packages/multiple/packages/diagnostics/workflow-package.json?raw'
import { buildPackageCatalog } from '$src/lib/packages/discovery'
import { loadBundledWorkflowPackageContract } from '$src/lib/package-contract/bundled-package-contract'

it('offers repair for an existing manifest with missing members without offering unsafe manifest findings', async () => {
  const contract = await loadBundledWorkflowPackageContract()
  const entry = (relativePath: string) => ({
    relativePath,
    kind: 'file' as const,
    size: 64,
    modifiedAt: '',
    symlink: 'none' as const,
    readOnly: false,
  })
  const catalog = buildPackageCatalog({
    contract,
    files: [entry('p/workflow-package.json'), entry('../workflow-package.json')],
    manifestTexts: new Map([
      ['p/workflow-package.json', manifestText],
      ['../workflow-package.json', '{broken'],
    ]),
  })
  const onOpen = vi.fn()
  render(PackageTree, { catalog, onOpen })
  await fireEvent.click(screen.getByRole('button', { name: 'Repair manifest: p/workflow-package.json' }))
  expect(onOpen).toHaveBeenCalledWith({
    packageId: 'manifest:p/workflow-package.json',
    kind: 'artifact',
    path: 'p/workflow-package.json',
  })
  expect(screen.queryByRole('button', { name: 'Repair manifest: ../workflow-package.json' })).not.toBeInTheDocument()
})
it('groups resources from the canonical contract and keeps keyboard navigation through workflow members', async () => {
  const { contract } = await loadBundledResourceResolution()
  const resourceContract = {
    ...contract,
    candidate_rules: {
      ...contract.candidate_rules,
      'compiler-source': {
        ...contract.candidate_rules['compiler-source'],
        command: contract.candidate_rules['compiler-source'].command.map((rule) => ({ ...rule, directory: 'custom' })),
        mcp: contract.candidate_rules['compiler-source'].mcp.map((rule) => ({
          ...rule,
          directory: rule.directory ? 'services' : '',
        })),
      },
    },
  }
  const paths = [
    'main.yaml',
    'custom/review.md',
    'run.py',
    'services/local.yaml',
    'notes.txt',
    'workflow-package.json',
    'digests.json',
  ]
  const pkg: WorkflowPackageProjection = {
    id: 'diagnostics',
    root: 'p',
    manifestPath: 'p/workflow-package.json',
    manifest: JSON.parse(manifestText),
    workflows: [{ definition: 'main.yaml' }],
    artifacts: paths.map((path) => ({ path, workspacePath: `p/${path}`, kind: 'file', size: 1, readOnly: false })),
  }
  const open = vi.fn()
  render(PackageTree, {
    catalog: { packages: [pkg], findings: [] },
    resourceContract,
    onOpen: open,
    readiness: { root: 'p', ready: true },
    gitSummaries: new Map<string, PackageGitSummary>([
      [
        'p',
        {
          phase: 'ready',
          changes: [{ kind: 'modified', path: 'notes.txt' }],
          baselineVersion: '1.2.3',
          proposedVersion: '1.2.4',
        },
      ],
    ]),
  })
  expect(screen.getByRole('treeitem', { name: /diagnostics package.*1 local change/ })).toBeVisible()
  expect(
    within(screen.getByRole('group', { name: 'Commands' })).getByRole('treeitem', { name: 'custom/review.md' }),
  ).toBeVisible()
  expect(within(screen.getByRole('group', { name: 'Scripts' })).getByRole('treeitem', { name: 'run.py' })).toBeVisible()
  expect(
    within(screen.getByRole('group', { name: 'MCP' })).getByRole('treeitem', { name: 'services/local.yaml' }),
  ).toBeVisible()
  expect(
    within(screen.getByRole('group', { name: 'Supporting resources' })).getByRole('treeitem', { name: 'notes.txt' }),
  ).toBeVisible()
  expect(
    within(screen.getByRole('group', { name: 'Package metadata' })).getByRole('treeitem', { name: 'digests.json' }),
  ).toBeVisible()
  const root = screen.getByRole('treeitem', { name: /diagnostics package/ })
  expect(root).toHaveTextContent('Static checks complete')
  root.focus()
  await fireEvent.keyDown(root, { key: 'ArrowDown' })
  expect(screen.getByRole('treeitem', { name: 'main.yaml' })).toHaveFocus()
  await fireEvent.click(screen.getByRole('treeitem', { name: 'main.yaml' }))
  expect(open).toHaveBeenCalledWith({ packageId: 'diagnostics', kind: 'workflow', path: 'p/main.yaml' })
})

it('provides keyboard artifact context actions and restores the row when cancelled', async () => {
  const pkg: WorkflowPackageProjection = {
    id: 'diagnostics',
    root: 'p',
    manifestPath: 'p/workflow-package.json',
    manifest: JSON.parse(manifestText),
    workflows: [{ definition: 'main.yaml' }],
    artifacts: [{ path: 'notes.txt', workspacePath: 'p/notes.txt', kind: 'file', size: 1, readOnly: false }],
  }
  const onAction = vi.fn()
  render(PackageTree, { catalog: { packages: [pkg], findings: [] }, onOpen: vi.fn(), onAction })
  const row = screen.getByRole('treeitem', { name: 'notes.txt' })
  row.focus()
  await fireEvent.keyDown(row, { key: 'F10', shiftKey: true })
  const menu = await screen.findByRole('menu', { name: 'Artifact actions' })
  for (const name of ['Rename', 'Replace', 'Reveal', 'Open externally', 'Trash'])
    expect(within(menu).getByRole('menuitem', { name })).toBeVisible()
  expect(within(menu).getByRole('menuitem', { name: 'Rename' })).toHaveFocus()
  await fireEvent.keyDown(within(menu).getByRole('menuitem', { name: 'Rename' }), { key: 'ArrowDown' })
  expect(within(menu).getByRole('menuitem', { name: 'Replace' })).toHaveFocus()
  await fireEvent.keyDown(within(menu).getByRole('menuitem', { name: 'Replace' }), { key: 'End' })
  expect(within(menu).getByRole('menuitem', { name: 'Trash' })).toHaveFocus()
  await fireEvent.keyDown(menu, { key: 'Escape' })
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  expect(row).toHaveFocus()
  expect(onAction).not.toHaveBeenCalled()
  await fireEvent.contextMenu(row)
  await fireEvent.click(await screen.findByRole('menuitem', { name: 'Reveal' }))
  expect(onAction).toHaveBeenCalledWith(pkg, 'reveal', 'p/notes.txt', row)
})
