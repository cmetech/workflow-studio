import type { WorkflowProjection } from '../projection/types'
import {
  buildReferenceIndex,
  prepareReferenceContract,
  type AuthenticatedReferenceBodies,
} from '../references/reference-index'
import { validateScopedDag } from '../validation/scoped-dag-validator'
import { parseWorkflowYaml } from '../yaml/parse-document'
import { codePointToEditorOffset } from '../references/unicode'
import { analyzeCommandMarkdown } from './command-markdown'
import type { PackageReferenceGraph, PackageReferenceInput } from './package-references'
import type { PackageFinding } from './types'

/** Validate package bytes at each consumer using the published interpolation surface and existing DAG rules. */
export function validateAuthenticatedPackageReferences(
  input: PackageReferenceInput,
  references: PackageReferenceGraph,
): readonly PackageFinding[] {
  const findings: PackageFinding[] = []
  const surfaces: readonly Record<string, unknown>[] = Array.isArray(input.contract.surfaces)
    ? input.contract.surfaces.filter(
        (surface): surface is Record<string, unknown> =>
          surface !== null && typeof surface === 'object' && !Array.isArray(surface),
      )
    : []
  for (const workflow of input.workflows) {
    const consumers = references.references.filter(
      (r) =>
        r.workflowPath === workflow.path &&
        r.artifactPath !== null &&
        surfaces.some((surface) => surface.field_path === r.fieldPath),
    )
    if (!consumers.length || !workflow.analysis.structurallyValid) continue
    // The legacy profile has no authenticated output-reference validation upstream.
    if (workflow.authoring.profile === 'hermes-legacy') continue
    const prepared = prepareReferenceContract(workflow.authoring)
    const projection = workflow.analysis.projection as WorkflowProjection | undefined
    const definitionText = input.artifactTexts.get(workflow.path)
    const parsed =
      definitionText === undefined
        ? null
        : parseWorkflowYaml(definitionText, {
            document: 'definition',
            maxBytes: workflow.authoring.limits.max_document_bytes,
          }).parsed
    if (!prepared || !projection || !parsed) {
      findings.push({
        code: 'package_analysis_required',
        path: workflow.path,
        severity: 'blocking',
        message:
          'Authenticated resource reference validation requires a supported authoring contract and current workflow analysis.',
      })
      continue
    }
    const commandBodies = new Map<string, string>()
    const scriptBodies = new Map<string, string>()
    const bodies: AuthenticatedReferenceBodies = { command_bodies: commandBodies, named_script_bodies: scriptBodies }
    const resources = new Map<string, { path: string; text: string; offset: number }>()
    for (const consumer of consumers) {
      const path = consumer.artifactPath!
      const text = input.artifactTexts.get(path)
      if (text === undefined) continue
      const surface = [...prepared.policies.values()].find((policy) => policy.fieldPath === consumer.fieldPath)
      const source = surface?.authenticatedBodySource
      if (!source) continue
      const command = source === 'command_bodies'
      const parsedCommand = command ? analyzeCommandMarkdown(path, text) : null
      const body = parsedCommand?.body ?? text
      ;(command ? commandBodies : scriptBodies).set(consumer.nodeId, body)
      resources.set(`${source}:${consumer.nodeId}`, { path, text, offset: parsedCommand?.bodyOffset ?? 0 })
    }
    const fullIndex = buildReferenceIndex(projection.definition, projection, prepared, bodies)
    const occurrences = fullIndex.occurrences.filter((o) => o.authenticatedBody)
    // Never silently omit a resolver-bound execution resource if a newer surface is unsupported.
    for (const consumer of consumers) {
      if (
        !occurrences.some(
          (o) =>
            (o.groupId ? `${o.groupId}/${o.consumerId}` : o.consumerId) === consumer.nodeId &&
            o.surfacePath === consumer.fieldPath,
        )
      )
        findings.push({
          code: 'package_analysis_required',
          path: consumer.artifactPath!,
          severity: 'blocking',
          message: `${workflow.path}: ${consumer.nodeId}: authenticated resource surface is unsupported.`,
        })
    }
    const index = { ...fullIndex, occurrences }
    const issues = validateScopedDag(
      projection,
      parsed,
      null,
      workflow.authoring,
      prepared,
      index,
      new Set(),
      true,
    ).issues
    for (const issue of issues) {
      const occurrence = occurrences.find((o) => '/' + o.valuePath.join('/') === issue.path)
      if (!occurrence) continue
      const semanticId = occurrence.groupId ? `${occurrence.groupId}/${occurrence.consumerId}` : occurrence.consumerId
      const source = [...prepared.policies.values()].find(
        (policy) => policy.fieldPath === occurrence.surfacePath,
      )?.authenticatedBodySource
      const resource = source ? resources.get(`${source}:${semanticId}`) : undefined
      if (!resource) continue
      const offset =
        resource.offset +
        codePointToEditorOffset(occurrence.authoredText, issue.referenceStart ?? occurrence.errors[0]?.start ?? 0)
      const before = resource.text.slice(0, offset)
      findings.push({
        code: issue.code,
        path: resource.path,
        severity: issue.blocking ? 'blocking' : 'advisory',
        message: `${workflow.path}: ${semanticId} (${occurrence.field}): ${issue.message}`,
        line: before.split('\n').length,
        column: offset - before.lastIndexOf('\n'),
      })
    }
  }
  return findings
}
