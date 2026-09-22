import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { afterEach, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve, dirname, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { auditPackageExecutionSurface } from './package-execution-audit'
import ts from 'typescript'
import ArtifactEditor from '$src/features/artifacts/ArtifactEditor.svelte'
import { ArtifactWorkspaceController } from '$src/features/artifacts/artifact-workspace-controller'
import { capturePackageAnalysis } from '$src/features/packages/package-analysis'
import { loadBundledAuthoringContracts } from '$src/lib/contract/bundled-contracts'
import {
  loadBundledWorkflowPackageContract,
  loadBundledResourceResolution,
} from '$src/lib/package-contract/bundled-package-contract'
import { createBrowserBridge } from '$src/lib/native/browser-bridge'
import { createArtifactRecoveryStore } from '$src/lib/recovery/recovery-store'
import { prepareGeneratedPackageFiles } from '$src/lib/packages/preparation'
import { $artifactSession } from '$src/stores/artifacts'
import manifest from '../fixtures/workflow-packages/laptop-diagnostic/workflow-package.json'
const allowed = new Set([
  'workspaceScan',
  'workspaceReadTextArtifact',
  'workspaceWriteTextArtifact',
  'workspaceHashPackage',
  'workspaceReplaceGeneratedFiles',
  'recoveryList',
  'recoveryWrite',
  'recoveryDelete',
])
afterEach(() => {
  vi.unstubAllGlobals()
  $artifactSession.set(null)
})
it('edits, saves, analyzes and prepares authored script bytes without execution or network access', async () => {
  const fetch = vi.fn(() => {
    throw Error('Forbidden network access')
  })
  vi.stubGlobal('fetch', fetch)
  vi.stubGlobal('__packageExecutionProbe', false)
  const payload =
    'globalThis.__packageExecutionProbe = true;\nfetch("https://execution.invalid/");\nthrow new Error("must remain source text");\n'
  const original = createBrowserBridge({
    initialFiles: {
      'package/workflow-package.json': JSON.stringify({
        ...manifest,
        workflows: [{ definition: 'main.yaml', companion: 'main.hermes.yaml' }],
        externalRequirements: { runtimes: ['bun'], tools: [], providers: [], services: [], secrets: [] },
      }),
      'package/main.yaml':
        'name: Inert script\ndescription: No execution\nnodes:\n  - id: inert\n    script: inert\n    runtime: bun\n',
      'package/main.hermes.yaml': 'language_compatibility: archon-2026-07\n',
      'package/scripts/inert.ts': payload,
    },
  })
  const calls: string[] = []
  const native = new Proxy(original, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver)
      if (typeof value !== 'function') return value
      return (...args: unknown[]) => {
        const name = String(key)
        calls.push(name)
        if (!allowed.has(name)) throw Error('Undeclared package capability: ' + name)
        return Reflect.apply(value, target, args)
      }
    },
  })
  const controller = new ArtifactWorkspaceController({
    workspaceId: 'browser-workspace',
    native,
    recovery: createArtifactRecoveryStore(native),
  })
  try {
    await controller.open('package/scripts/inert.ts', 'typescript')
    const view = render(ArtifactEditor, {
      document: $artifactSession.get()!,
      onTextChange: (text) => controller.edit(text),
      onSave: () => controller.save(),
    })
    controller.edit(payload + '// edited as data\n')
    await view.rerender({ document: $artifactSession.get()! })
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect($artifactSession.get()?.dirty).toBe(false))
    const contract = await loadBundledWorkflowPackageContract()
    const index = { committedIndexText: null, workingIndexText: null, workingIndexHash: null }
    const captured = await capturePackageAnalysis({
      packageRoot: 'package',
      native,
      contract,
      resourceContract: (await loadBundledResourceResolution()).contract,
      authoring: await loadBundledAuthoringContracts(),
      index,
    })
    expect(captured.analysis.blockers).toEqual([])
    const prepared = await prepareGeneratedPackageFiles({ ...captured, contract, ...index })
    await native.workspaceReplaceGeneratedFiles(prepared.request)
    expect((await native.workspaceReadTextArtifact('package/scripts/inert.ts')).text).toBe(
      payload + '// edited as data\n',
    )
    expect(Reflect.get(globalThis, '__packageExecutionProbe')).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
    expect(calls).toEqual(
      expect.arrayContaining([
        'workspaceReadTextArtifact',
        'workspaceWriteTextArtifact',
        'workspaceHashPackage',
        'workspaceReplaceGeneratedFiles',
      ]),
    )
    expect(calls.every((call) => allowed.has(call))).toBe(true)
  } finally {
    await controller.dispose()
  }
})
it('keeps artifact/package Tauri methods on an explicit data-only command allowlist', () => {
  const source = ts.createSourceFile(
    'tauri-bridge.ts',
    readFileSync('src/lib/native/tauri-bridge.ts', 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  )
  const allowedCommands = new Set([
    'workspace_apply_transaction',
    'workspace_hash_package',
    'workspace_replace_generated_files',
    'dialog_choose_import_artifact',
    'workspace_read_artifact',
    'workspace_read_text_artifact',
    'workspace_write_text_artifact',
    'workspace_import_artifact',
    'workspace_replace_artifact',
    'workspace_reveal_artifact',
    'workspace_open_artifact',
    'git_read_package_context',
    'git_preview_package_version',
    'git_commit_package_version',
  ])
  const methods = new Set([
    'workspaceApplyTransaction',
    'workspaceHashPackage',
    'workspaceReplaceGeneratedFiles',
    'chooseImportArtifact',
    'workspaceReadArtifact',
    'workspaceReadTextArtifact',
    'workspaceWriteTextArtifact',
    'workspaceImportArtifact',
    'workspaceReplaceArtifact',
    'workspaceRevealArtifact',
    'workspaceOpenArtifact',
    'gitReadPackageContext',
    'gitPreviewPackageVersion',
    'gitCommitPackageVersion',
  ])
  const found = new Set<string>()
  function walk(node: ts.Node) {
    if (ts.isPropertyAssignment(node) && methods.has(node.name.getText(source))) {
      const method = node.name.getText(source)
      found.add(method)
      expect(ts.isArrowFunction(node.initializer), method).toBe(true)
      if (ts.isArrowFunction(node.initializer)) expect(ts.isCallExpression(node.initializer.body), method).toBe(true)
      function check(child: ts.Node) {
        if (ts.isCallExpression(child)) {
          expect(child.expression.getText(source), method).toBe('invokeTyped')
          const command = child.arguments[0]
          expect(command && ts.isStringLiteral(command), method).toBe(true)
          if (command && ts.isStringLiteral(command))
            expect(allowedCommands.has(command.text), method + ': ' + command.text).toBe(true)
        }
        ts.forEachChild(child, check)
      }
      check(node.initializer)
    }
    ts.forEachChild(node, walk)
  }
  walk(source)
  expect(found).toEqual(methods)
})

it('audits the transitive runtime dependency surface of every package and artifact entry point', () => {
  const roots = ['src/features/packages', 'src/features/artifacts'].flatMap((root) =>
    readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(ts|svelte)$/.test(entry.name) && !entry.name.includes('.test.'))
      .map((entry) => join(entry.parentPath, entry.name)),
  )
  roots.push('src/features/examples/ExampleGallery.svelte', 'src/lib/examples/package-examples.ts')
  const audit = auditPackageExecutionSurface(roots)
  expect(audit.files).toContain(resolve('src/lib/packages/creation.ts'))
  expect(audit.files).toContain(resolve('src/lib/examples/package-examples.ts'))
  expect(audit.files).toContain(resolve('src/features/packages/package-analysis-worker.ts'))
  expect(audit.files).toContain(resolve('src/lib/validation/analyze-workflow.ts'))
  expect(audit.violations).toEqual([])
})
it('the dependency audit rejects transitive process imports, dynamic authored imports, network calls and code evaluation', () => {
  const directory = mkdtempSync(join(tmpdir(), 'studio-package-security-'))
  try {
    writeFileSync(join(directory, 'entry.ts'), "export {unsafe} from './unsafe'", 'utf8')
    writeFileSync(
      join(directory, 'unsafe.ts'),
      "import spawn from 'node:child_process'; export const unsafe = (source:string) => { import(source); fetch(source); new Worker(new URL(source, import.meta.url)); return new Function(source)(); }",
      'utf8',
    )
    const audit = auditPackageExecutionSurface([join(directory, 'entry.ts')])
    expect(audit.violations.some((item) => item.includes('node:child_process'))).toBe(true)
    expect(audit.violations.some((item) => item.includes('dynamic import'))).toBe(true)
    expect(audit.violations.some((item) => item.includes('fetch'))).toBe(true)
    expect(audit.violations.some((item) => item.includes('Function'))).toBe(true)
    expect(audit.violations.some((item) => item.includes('Worker'))).toBe(true)
  } finally {
    if (dirname(resolve(directory)) === resolve(tmpdir()) && basename(directory).startsWith('studio-package-security-'))
      rmSync(directory, { recursive: true })
  }
})
