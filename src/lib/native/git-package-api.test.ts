import { expect, it, vi } from 'vitest'
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))
import { tauriBridge } from './tauri-bridge'
import { createBrowserBridge } from './browser-bridge'

it('passes package Git context/preview/token-only commit payloads exactly', async () => {
  invoke.mockResolvedValue({})
  await tauriBridge.gitReadPackageContext('packages/p')
  expect(invoke).toHaveBeenLastCalledWith('git_read_package_context', { packageRoot: 'packages/p' })
  const request = {
    contextToken: 'context',
    sourceSnapshotToken: 'snapshot',
    expectedIndexHash: 'index',
    version: '1.0.0',
    message: 'Package 1.0.0',
  }
  await tauriBridge.gitPreviewPackageVersion(request)
  expect(invoke).toHaveBeenLastCalledWith('git_preview_package_version', { request })
  await tauriBridge.gitCommitPackageVersion('accepted-preview')
  expect(invoke).toHaveBeenLastCalledWith('git_commit_package_version', { authorizationToken: 'accepted-preview' })
})
it('reports browser Git unavailable without pretending to commit', async () => {
  const bridge = createBrowserBridge()
  await expect(bridge.gitReadPackageContext('p')).rejects.toMatchObject({ code: 'git_not_repository' })
  await expect(bridge.gitCommitPackageVersion('invented')).rejects.toMatchObject({ code: 'git_unavailable' })
})
