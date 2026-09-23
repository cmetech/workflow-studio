import { render, screen, fireEvent, waitFor } from '@testing-library/svelte'
import { expect, it, vi } from 'vitest'
import PackageAuthoringDialogs from './PackageAuthoringDialogs.svelte'
const mocks = vi.hoisted(() => ({
  captureDependencies: vi.fn(),
  prepare: vi.fn(),
  create: vi.fn(),
  importWorkflow: vi.fn(),
  addTextArtifact: vi.fn(),
  importArtifact: vi.fn(),
}))
vi.mock('./package-authoring-controller', () => ({
  createPackageAuthoringController: (deps: unknown) => {
    mocks.captureDependencies(deps)
    return mocks
  },
}))
it('dismisses the authoring modal when opening its help page', async () => {
  mocks.prepare.mockResolvedValueOnce({ sources: [], snapshot: {}, context: {} })
  const onHelp = vi.fn()
  const { component } = render(PackageAuthoringDialogs, { deps: {} as never, onHelp })
  await component.openArtifact({ root: 'pkg', manifest: { displayName: 'Example' } } as never)
  await fireEvent.click(screen.getByRole('button', { name: 'Help' }))
  expect(onHelp).toHaveBeenCalledWith('guide:creating-a-package')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
it('opens creation through its imperative API and reports preparation errors accessibly', async () => {
  mocks.prepare.mockRejectedValueOnce(Error('The source changed; try again.'))
  const { component } = render(PackageAuthoringDialogs, { deps: {} as never })
  await component.openCreate()
  expect(await screen.findByRole('alert')).toHaveTextContent('The source changed')
  await fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})
it('offers an exact filename and explicit text or file import actions', async () => {
  mocks.prepare.mockResolvedValueOnce({ sources: [], snapshot: {}, context: {} })
  mocks.addTextArtifact.mockResolvedValueOnce(undefined)
  const { component } = render(PackageAuthoringDialogs, { deps: {} as never })
  await component.openArtifact({ root: 'pkg', manifest: { displayName: 'Example' } } as never)
  await fireEvent.input(screen.getByLabelText('Package-relative filename'), { target: { value: 'assets/readme.txt' } })
  await fireEvent.input(screen.getByLabelText('Initial text'), { target: { value: 'exact content\n' } })
  await fireEvent.click(screen.getByRole('button', { name: 'Create text artifact' }))
  await waitFor(() =>
    expect(mocks.addTextArtifact).toHaveBeenCalledWith(
      expect.anything(),
      'pkg',
      'assets/readme.txt',
      'exact content\n',
    ),
  )
})

it('keeps the exact filename after cancelling the native source chooser', async () => {
  mocks.prepare.mockResolvedValueOnce({ sources: [], snapshot: {}, context: {} })
  mocks.importArtifact.mockResolvedValueOnce(false)
  const { component } = render(PackageAuthoringDialogs, { deps: {} as never })
  await component.openArtifact({ root: 'pkg', manifest: { displayName: 'Example' } } as never)
  await fireEvent.input(screen.getByLabelText('Package-relative filename'), { target: { value: 'assets/exact.bin' } })
  await fireEvent.click(screen.getByRole('button', { name: 'Choose file to import' }))
  await waitFor(() => expect(mocks.importArtifact).toHaveBeenCalled())
  expect(screen.getByLabelText('Package-relative filename')).toHaveValue('assets/exact.bin')
})

it('exposes pending creation to the workspace-close guard and prevents cancelling or replacing the dialog', async () => {
  const source = { kind: 'blank', definition: { path: 'main.yaml', text: 'exact' }, companion: null, resources: [] }
  mocks.prepare.mockResolvedValueOnce({ sources: [{ id: 'blank', label: 'Blank', source }], snapshot: {}, context: {} })
  let complete!: () => void
  mocks.create.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      complete = resolve
    }),
  )
  const { component } = render(PackageAuthoringDialogs, { deps: {} as never })
  await component.openCreate()
  for (const [label, value] of [
    ['Package ID', 'support'],
    ['Display name', 'Support'],
    ['Description', 'Help'],
    ['License', 'MIT'],
    ['Publisher', 'team'],
  ])
    await fireEvent.input(screen.getByLabelText(label!), { target: { value } })
  await fireEvent.click(screen.getByRole('button', { name: 'Create Package' }))
  await waitFor(() => expect(component.isBusy()).toBe(true))
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  await component.openArtifact({ root: 'other', manifest: { displayName: 'Other' } } as never)
  expect(screen.getByRole('heading', { name: 'New Package' })).toBeVisible()
  complete()
  await waitFor(() => expect(component.isBusy()).toBe(false))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('retains a successful artifact-operation recovery receipt until the user closes it', async () => {
  mocks.prepare.mockResolvedValueOnce({ sources: [], snapshot: {}, context: {} })
  const { component } = render(PackageAuthoringDialogs, { deps: {} as never })
  await component.openArtifact({ root: 'pkg', manifest: { displayName: 'Example' } } as never)
  mocks.addTextArtifact.mockImplementationOnce(async () => {
    const deps = mocks.captureDependencies.mock.calls.at(-1)![0] as { onRecovery: (receipt: unknown) => void }
    deps.onRecovery({
      pathResults: [
        {
          relativePath: 'pkg/notes.txt',
          destinationPath: '/vault/exact-original',
          status: 'recoveryRetained',
          message: 'Retained original',
        },
      ],
      omittedPathResults: 0,
    })
  })
  await fireEvent.click(screen.getByRole('button', { name: 'Create text artifact' }))
  expect(await screen.findByText('/vault/exact-original')).toBeVisible()
  expect(screen.getByRole('heading', { name: 'Changes saved with retained recovery files' })).toBeVisible()
  await fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it.each(['Escape', 'backdrop', 'native cancel'])(
  'keeps a pending artifact operation and its eventual recovery error visible after %s',
  async (dismissal) => {
    mocks.prepare.mockResolvedValueOnce({ sources: [], snapshot: {}, context: {} })
    let reject!: (reason: unknown) => void
    mocks.addTextArtifact.mockReturnValueOnce(
      new Promise<void>((_, fail) => {
        reject = fail
      }),
    )
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const error = Object.assign(new Error('Original retained after cleanup failure'), {
      pathResults: [
        {
          relativePath: 'pkg/assets/new-file.txt',
          destinationPath: '/vault/exact-original',
          status: 'recoveryRetained',
          message: 'Inspect retained original',
        },
      ],
    })
    try {
      const { component } = render(PackageAuthoringDialogs, { deps: {} as never })
      await component.openArtifact({ root: 'pkg', manifest: { displayName: 'Example' } } as never, opener)
      await fireEvent.click(screen.getByRole('button', { name: 'Create text artifact' }))
      await waitFor(() => expect(component.isBusy()).toBe(true))
      const dialog = screen.getByRole('dialog')
      if (dismissal === 'Escape') await fireEvent.keyDown(dialog, { key: 'Escape' })
      else if (dismissal === 'backdrop') await fireEvent.click(dialog)
      else await fireEvent(dialog, new Event('cancel', { cancelable: true }))
      expect(dialog).toHaveAttribute('open')
      reject(error)
      expect(await screen.findByRole('alert')).toHaveTextContent(error.message)
      expect(screen.getByText('/vault/exact-original')).toBeVisible()
      expect(dialog).toHaveAttribute('open')
      await fireEvent.click(screen.getByRole('button', { name: 'Close' }))
      await waitFor(() => expect(opener).toHaveFocus())
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    } finally {
      reject(error)
      opener.remove()
    }
  },
)
