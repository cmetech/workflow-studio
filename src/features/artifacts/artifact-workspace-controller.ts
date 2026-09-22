import { atom } from 'nanostores'
import type { WorkspaceNativeBridge } from '$src/lib/native/types'
import type { WorkspaceReadResult } from '$src/lib/native/types'
import type { ArtifactDocument, ArtifactLanguage } from '$src/lib/artifacts/types'
import {
  createArtifactDocument,
  editArtifactDocument,
  confirmArtifactSaved,
  reloadArtifactDocument,
} from '$src/lib/artifacts/artifact-session'
import { createArtifactRecoveryDraft, type ArtifactRecoveryStore } from '$src/lib/recovery/recovery-store'
import type { ArtifactRecoveryDraft } from '$src/lib/recovery/types'
import { $artifactSession } from '$src/stores/artifacts'

export type ArtifactExternalChangeChoice = 'keep-mine' | 'reload-disk' | 'compare'
export interface ArtifactExternalChange {
  readonly path: string
  readonly disk: WorkspaceReadResult | null
  readonly choices: readonly ArtifactExternalChangeChoice[]
  readonly comparedRevision: number | null
}
export interface ArtifactWorkspaceState {
  readonly externalChange: ArtifactExternalChange | null
  readonly recoveryOffers: readonly ArtifactRecoveryDraft[]
}
export interface ArtifactWorkspaceControllerDependencies {
  readonly workspaceId: string
  readonly native: Pick<WorkspaceNativeBridge, 'workspaceReadTextArtifact' | 'workspaceWriteTextArtifact'>
  readonly recovery: ArtifactRecoveryStore
  readonly now?: () => string
}

export class ArtifactWorkspaceController {
  readonly state = atom<ArtifactWorkspaceState>({ externalChange: null, recoveryOffers: [] })
  private publishedDocument: ArtifactDocument | null = null
  private generation = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private pending: ArtifactDocument | null = null
  private recoveryQueue: Promise<void> = Promise.resolve()
  private recoveryVersion = 0
  private saving: Promise<void> | null = null
  private closing = false
  private disposed = false
  private externalGeneration = 0

  constructor(private readonly dependencies: ArtifactWorkspaceControllerDependencies) {}

  async open(path: string, language: ArtifactLanguage): Promise<void> {
    this.assertAvailable()
    const generation = ++this.generation
    const previous = $artifactSession.get()
    if (this.saving) await this.saving
    await this.flush()
    const disk = await this.readDisk(path)
    const offers = await this.dependencies.recovery.list()
    if (generation !== this.generation || this.disposed || this.closing || $artifactSession.get() !== previous) return
    await this.flush()
    if (generation !== this.generation || this.disposed || this.closing || $artifactSession.get() !== previous) return
    const document = createArtifactDocument(
      this.dependencies.workspaceId,
      path,
      language,
      disk?.text ?? '',
      disk?.sha256 ?? null,
      disk?.readOnly ?? false,
    )
    this.publish(document)
    this.state.set({
      externalChange: null,
      recoveryOffers: offers.filter(
        (draft) => draft.artifactId === document.artifactId && (!disk || draft.text !== disk.text),
      ),
    })
  }

  edit(text: string): void {
    this.assertAvailable()
    const current = this.current()
    const next = editArtifactDocument(current, text)
    if (next === current) return
    this.publish(next)
    const state = this.state.get()
    if (state.externalChange)
      this.state.set({ ...state, externalChange: { ...state.externalChange, comparedRevision: null } })
    this.changed(next)
  }

  save(): Promise<void> {
    this.assertAvailable()
    if (this.saving) return Promise.reject(new Error('Artifact save already in progress'))
    if (this.state.get().externalChange) return Promise.reject(new Error('Resolve the external change before saving'))
    return this.startSave(this.current())
  }

  private startSave(captured: ArtifactDocument, expectedHash = captured.diskHash): Promise<void> {
    if (captured.readOnly) return Promise.reject(new Error('Artifact is read-only'))
    const generation = this.generation
    const operation = this.dependencies.native
      .workspaceWriteTextArtifact({
        relativePath: captured.path,
        text: captured.text,
        expectedCurrentHash: expectedHash,
      })
      .then((result) => {
        const current = $artifactSession.get()
        if (
          generation !== this.generation ||
          !current ||
          current !== this.publishedDocument ||
          current.artifactId !== captured.artifactId ||
          result.relativePath !== captured.path
        )
          return
        const next = confirmArtifactSaved(current, captured, result.sha256)
        this.publish(next)
        this.state.set({ ...this.state.get(), externalChange: null })
        this.changed(next)
      })
      .catch(async (error: unknown) => {
        if (
          generation === this.generation &&
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'workspace_revision_conflict'
        ) {
          try {
            await this.externalChanged()
          } catch {
            /* Preserve the original write conflict. */
          }
        }
        throw error
      })
    this.saving = operation
    void operation
      .finally(() => {
        if (this.saving === operation) this.saving = null
      })
      .catch(() => undefined)
    return operation
  }

  async externalChanged(): Promise<void> {
    const captured = this.current()
    const generation = this.generation
    const externalGeneration = ++this.externalGeneration
    const disk = await this.readDisk(captured.path)
    const current = $artifactSession.get()
    if (
      generation !== this.generation ||
      externalGeneration !== this.externalGeneration ||
      !current ||
      current !== this.publishedDocument ||
      current.artifactId !== captured.artifactId ||
      this.disposed ||
      this.closing
    )
      return
    if (disk && disk.sha256 === current.diskHash) return
    if (disk && !current.dirty) {
      const next = { ...reloadArtifactDocument(current, disk.text, disk.sha256), readOnly: disk.readOnly }
      this.publish(next)
      this.state.set({ ...this.state.get(), externalChange: null })
      this.changed(next)
    } else {
      this.state.set({
        ...this.state.get(),
        externalChange: {
          path: current.path,
          disk,
          choices: ['keep-mine', 'reload-disk', 'compare'],
          comparedRevision: null,
        },
      })
    }
  }

  compare(): { readonly path: string; readonly mine: string; readonly disk: string | null } {
    this.assertAvailable()
    const current = this.current()
    const conflict = this.state.get().externalChange
    if (!conflict || conflict.path !== current.path) throw new Error('No current external change')
    this.state.set({ ...this.state.get(), externalChange: { ...conflict, comparedRevision: current.revision } })
    return { path: current.path, mine: current.text, disk: conflict.disk?.text ?? null }
  }

  async resolveExternalChange(choice: ArtifactExternalChangeChoice): Promise<void> {
    this.assertAvailable()
    if (choice === 'compare') {
      this.compare()
      return
    }
    const captured = this.current()
    const conflict = this.state.get().externalChange
    if (!conflict || conflict.path !== captured.path) throw new Error('No current external change')
    if (this.saving) throw new Error('Artifact save already in progress')
    if (choice === 'keep-mine') {
      if (conflict.comparedRevision !== captured.revision)
        throw new Error('Compare the current versions before keeping your edits')
      await this.startSave(captured, conflict.disk?.sha256 ?? null)
      return
    }
    const generation = this.generation
    const disk = await this.readDisk(captured.path)
    const current = $artifactSession.get()
    if (generation !== this.generation || current !== captured || this.disposed || this.closing)
      throw new Error('Artifact changed while reloading')
    if (!disk) {
      await this.close()
      return
    }
    const next = { ...reloadArtifactDocument(current, disk.text, disk.sha256), readOnly: disk.readOnly }
    this.publish(next)
    this.state.set({ externalChange: null, recoveryOffers: [] })
    this.changed(next)
    await this.flush()
  }

  async recover(draft: ArtifactRecoveryDraft): Promise<void> {
    this.assertAvailable()
    const current = this.current()
    if (
      draft.artifactId !== current.artifactId ||
      draft.path !== current.path ||
      draft.workspaceId !== current.workspaceId ||
      !this.state.get().recoveryOffers.includes(draft)
    )
      throw new Error('Recovery draft does not belong to the current artifact')
    if (current.readOnly) throw new Error('Artifact is read-only')
    const next = {
      ...editArtifactDocument(current, draft.text, 'recovery'),
      revision: Math.max(current.revision, draft.revision) + 1,
      dirty: true,
    }
    this.publish(next)
    this.state.set({ externalChange: null, recoveryOffers: [] })
    this.changed(next)
    await this.flush()
  }

  async discard(draft?: ArtifactRecoveryDraft): Promise<void> {
    this.assertAvailable()
    const current = this.current()
    if (draft && draft.artifactId !== current.artifactId)
      throw new Error('Recovery draft does not belong to the current artifact')
    const generation = this.generation
    await this.flush()
    if (generation !== this.generation || $artifactSession.get() !== current)
      throw new Error('Artifact changed while discarding recovery')
    const discard = this.recoveryQueue
      .catch(() => undefined)
      .then(() => this.dependencies.recovery.discard(current.artifactId))
    this.recoveryQueue = discard
    await discard
    if (generation === this.generation && $artifactSession.get() === current)
      this.state.set({ ...this.state.get(), recoveryOffers: [] })
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    const pending = this.pending
    this.pending = null
    if (pending) this.enqueueRecovery(pending, this.recoveryVersion)
    await this.recoveryQueue
  }

  async close(): Promise<void> {
    if (this.closing) throw new Error('Artifact close already in progress')
    this.closing = true
    try {
      if (this.saving) await this.saving.catch(() => undefined)
      ++this.generation
      await this.flush()
      if ($artifactSession.get() === this.publishedDocument) $artifactSession.set(null)
      this.publishedDocument = null
      this.state.set({ externalChange: null, recoveryOffers: [] })
    } finally {
      this.closing = false
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    await this.close()
    this.disposed = true
  }

  private changed(document: ArtifactDocument): void {
    this.pending = document
    ++this.recoveryVersion
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      void this.flush().catch(() => undefined)
    }, 750)
  }

  private enqueueRecovery(document: ArtifactDocument, version: number): void {
    this.recoveryQueue = this.recoveryQueue
      .catch(() => undefined)
      .then(async () => {
        try {
          if (document.dirty)
            await this.dependencies.recovery.save(
              createArtifactRecoveryDraft(document, this.dependencies.now?.() ?? new Date().toISOString()),
            )
          else await this.dependencies.recovery.discard(document.artifactId)
        } catch (error: unknown) {
          if (version === this.recoveryVersion && !this.pending) this.pending = document
          throw error
        }
      })
    void this.recoveryQueue.catch(() => undefined)
  }

  private async readDisk(path: string): Promise<WorkspaceReadResult | null> {
    try {
      return await this.dependencies.native.workspaceReadTextArtifact(path)
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'path_not_found') return null
      throw error
    }
  }

  private publish(document: ArtifactDocument): void {
    this.publishedDocument = document
    $artifactSession.set(document)
  }

  private current(): ArtifactDocument {
    const document = $artifactSession.get()
    if (!document || document !== this.publishedDocument || document.workspaceId !== this.dependencies.workspaceId)
      throw new Error('No artifact is open')
    return document
  }

  private assertAvailable(): void {
    if (this.disposed || this.closing) throw new Error('Artifact controller is closed')
  }
}
