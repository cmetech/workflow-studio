import { atom } from 'nanostores'
import type { GitVersionResult } from '$src/lib/git/types'
import type { PackageAnalysis } from '$src/lib/packages/readiness'
import type { PackageChange, PreparePackageFailure, PreparePackageView } from './prepare-package-view'

export interface PackageVersionInput {
  readonly version: string
  readonly message: string
}
export interface PreparationReview<Snapshot> {
  readonly snapshot: Snapshot
  readonly analysis: PackageAnalysis
  readonly changes: readonly PackageChange[]
  readonly includedPaths: readonly string[]
  readonly trustChanges: readonly string[]
  readonly suggestedVersion: string
  readonly suggestionReasons: readonly string[]
}
export interface FinalPackagePreview extends PackageVersionInput {
  readonly authorizationToken: string
  readonly diff: string
  readonly includedPaths: readonly string[]
}
export interface PreparePackageDependencies<Snapshot> {
  /** Persist or reject every relevant draft before a source snapshot is captured. */
  readonly flush: () => Promise<void>
  readonly validate: () => Promise<PreparationReview<Snapshot>>
  /** Revalidate the review snapshot, apply the explicit version, generate files, then obtain a native preview. */
  readonly prepare: (snapshot: Snapshot, input: PackageVersionInput) => Promise<FinalPackagePreview>
  /** The native token is single-use and binds source bytes, paths, HEAD, diff, and message. */
  readonly commit: (authorizationToken: string) => Promise<GitVersionResult>
}

function failure(cause: unknown): PreparePackageFailure {
  const message =
    cause instanceof Error
      ? cause.message
      : cause && typeof cause === 'object' && 'message' in cause
        ? String(cause.message)
        : 'Package preparation failed.'
  return {
    message: message.slice(0, 4096),
    recovery: [
      'Inspect saved and generated files before retrying.',
      'Resolve the reported issue, then validate and review a fresh preview.',
    ],
  }
}

function clearPreview(view: Extract<PreparePackageView, { step: 'review' | 'version' }>) {
  const clean = { ...view }
  delete clean.error
  delete clean.finalPreview
  return clean
}

/** Owns dialog transitions; filesystem and Git authority remain in the native-backed dependencies. */
export class PreparePackageController<Snapshot> {
  readonly state = atom<PreparePackageView>({ step: 'validate' })
  private generation = 0
  private mutationPending = false
  private review: PreparationReview<Snapshot> | null = null
  private preview: FinalPackagePreview | null = null
  constructor(private readonly deps: PreparePackageDependencies<Snapshot>) {}

  async validate(): Promise<void> {
    if (this.mutationPending) return
    const generation = ++this.generation
    this.review = null
    this.preview = null
    this.state.set({ step: 'validate', busy: true })
    try {
      await this.deps.flush()
      if (generation !== this.generation) return
      const review = await this.deps.validate()
      if (generation !== this.generation) return
      if (!review.analysis.ready || review.analysis.blockers.length) {
        this.state.set({ step: 'validate', analysis: review.analysis })
        return
      }
      this.review = review
      this.state.set({
        step: 'review',
        analysis: review.analysis,
        changes: review.changes,
        includedPaths: review.includedPaths,
        trustChanges: review.trustChanges,
        suggestedVersion: review.suggestedVersion,
        suggestionReasons: review.suggestionReasons,
      })
    } catch (cause) {
      if (generation === this.generation) this.state.set({ step: 'validate', error: failure(cause) })
    }
  }

  acceptReview(): void {
    const view = this.state.get()
    if (view.step !== 'review' || view.busy || !this.review || !view.analysis.ready || view.analysis.blockers.length)
      return
    this.state.set({ ...view, step: 'version' })
  }

  async prepare(input: PackageVersionInput): Promise<void> {
    const view = this.state.get(),
      review = this.review
    if (this.mutationPending || view.step !== 'version' || !review) return
    this.preview = null
    if (!input.version.trim() || !input.message.trim()) {
      this.state.set({ ...clearPreview(view), error: failure(new Error('Version and commit message are required.')) })
      return
    }
    this.mutationPending = true
    this.state.set({ ...clearPreview(view), busy: true })
    try {
      const preview = await this.deps.prepare(review.snapshot, { ...input })
      if (!preview.authorizationToken || preview.version !== input.version || preview.message !== input.message)
        throw new Error('The generated preview does not match the requested version and message.')
      this.preview = preview
      this.state.set({
        ...clearPreview(view),
        busy: false,
        includedPaths: preview.includedPaths,
        finalPreview: { diff: preview.diff, version: preview.version, message: preview.message },
      })
    } catch (cause) {
      this.review = null
      this.state.set({ step: 'validate', error: failure(cause) })
    } finally {
      this.mutationPending = false
    }
  }

  async commit(input: PackageVersionInput): Promise<void> {
    const view = this.state.get(),
      preview = this.preview
    if (this.mutationPending || view.step !== 'version') return
    if (!preview || input.version !== preview.version || input.message !== preview.message) {
      this.preview = null
      this.state.set({
        ...clearPreview(view),
        error: failure(new Error('Review a fresh preview for this version and message.')),
      })
      return
    }
    this.preview = null
    this.mutationPending = true
    this.state.set({ ...clearPreview(view), busy: true })
    try {
      const result = await this.deps.commit(preview.authorizationToken)
      if (result.outcome !== 'committed') throw new Error(result.message)
      this.state.set({
        step: 'complete',
        commitOid: result.oid,
        version: preview.version,
        includedPaths: preview.includedPaths,
        warnings: result.warnings,
      })
    } catch (cause) {
      this.state.set({ ...clearPreview(view), busy: false, error: failure(cause) })
    } finally {
      this.mutationPending = false
    }
  }

  /** In-flight filesystem/Git mutations cannot be dismissed as though they were cancelled. */
  cancel(): boolean {
    if (this.mutationPending) return false
    ++this.generation
    this.review = null
    this.preview = null
    this.state.set({ step: 'validate' })
    return true
  }
}
