import type { DocumentationRenderer, GuideGroupId, ReferenceGroupId } from './types'

export interface GuideGroup { readonly id: GuideGroupId; readonly title: string }
export interface GuidePresentation { readonly group: GuideGroupId; readonly useWhen: string; readonly renderer?: DocumentationRenderer }
export interface DocumentationTask { readonly id: string; readonly title: string; readonly description: string; readonly topicId: string }
export interface ReferenceEntryPoint { readonly group: ReferenceGroupId; readonly title: string; readonly description: string }

export const GUIDE_GROUPS: readonly GuideGroup[] = [
  { id: 'getting-started', title: 'Getting started' }, { id: 'build-graph', title: 'Build the graph' },
  { id: 'configure-behavior', title: 'Configure behavior' }, { id: 'review-recover', title: 'Review and recover' },
  { id: 'use-application', title: 'Use the application' },
]

export const GUIDE_PRESENTATION: Readonly<Record<string, GuidePresentation>> = {
  'quick-start': { group: 'getting-started', useWhen: 'Use this when you want to create and save your first workflow.' },
  'workflow-pairs': { group: 'getting-started', useWhen: 'Use this when you need to understand definition and companion YAML files.' },
  'dag-dependencies': { group: 'build-graph', useWhen: 'Use this when you are connecting steps or resolving dependency order.' },
  'conditions-and-outputs': { group: 'build-graph', useWhen: 'Use this when a condition or output should control a later step.' },
  'loops-and-approvals': { group: 'build-graph', useWhen: 'Use this when your graph needs repeated work or an approval gate.' },
  'retry-and-triggers': { group: 'configure-behavior', useWhen: 'Use this when you need to configure retries or trigger rules.' },
  'companion-policies': { group: 'configure-behavior', useWhen: 'Use this when workflow policy belongs in the companion file.' },
  'profiles-and-compatibility': { group: 'configure-behavior', useWhen: 'Use this when a workflow profile or compatibility finding needs review.' },
  'problems-and-validation': { group: 'review-recover', useWhen: 'Use this when a validation problem blocks saving or export.' },
  'git-versions': { group: 'review-recover', useWhen: 'Use this when you want to inspect or create a local Git version.' },
  troubleshooting: { group: 'review-recover', useWhen: 'Use this when an authoring problem needs practical recovery steps.' },
  'keyboard-shortcuts': { group: 'use-application', useWhen: 'Use this when you want to work faster with keyboard shortcuts.', renderer: 'keyboard-shortcuts' },
}

export const START_HERE = [
  { topicId: 'guide:quick-start', title: 'Quick Start' },
  { topicId: 'guide:workflow-pairs', title: 'Workflow pairs' },
  { topicId: 'guide:dag-dependencies', title: 'DAG dependencies' },
  { topicId: 'guide:problems-and-validation', title: 'Problems and validation' },
  { topicId: 'guide:keyboard-shortcuts', title: 'Keyboard shortcuts' },
] as const

export const DOCUMENTATION_TASKS: readonly DocumentationTask[] = [
  { id: 'create-workflow', title: 'Create or open a workflow', description: 'Start a workflow in a local folder.', topicId: 'guide:quick-start' },
  { id: 'add-connect-steps', title: 'Add and connect steps', description: 'Build an acyclic workflow graph.', topicId: 'guide:dag-dependencies' },
  { id: 'conditions-outputs', title: 'Add conditions and use outputs', description: 'Control later steps with earlier results.', topicId: 'guide:conditions-and-outputs' },
  { id: 'retries-triggers', title: 'Configure retries and trigger rules', description: 'Set execution behavior for a node.', topicId: 'guide:retry-and-triggers' },
  { id: 'loops-approvals', title: 'Use loops and approvals', description: 'Add bounded repetition or a review gate.', topicId: 'guide:loops-and-approvals' },
  { id: 'companion-profiles', title: 'Configure companion policy and profiles', description: 'Manage companion settings and compatibility.', topicId: 'guide:companion-policies' },
  { id: 'git-versions', title: 'Review local Git versions', description: 'Inspect or record local workflow history.', topicId: 'guide:git-versions' },
  { id: 'fix-problem', title: 'Fix a validation problem', description: 'Understand save-blocking issues and advisories.', topicId: 'guide:problems-and-validation' },
  { id: 'keyboard-shortcuts', title: 'Work faster with keyboard shortcuts', description: 'Find commands, chords, and canvas gestures.', topicId: 'guide:keyboard-shortcuts' },
]

export const REFERENCE_ENTRY_POINTS: readonly ReferenceEntryPoint[] = [
  { group: 'node-types', title: 'Node types', description: 'Browse node kinds supplied by this contract.' },
  { group: 'common-node-settings', title: 'Common node settings', description: 'Browse fields shared across node kinds.' },
  { group: 'workflow-fields', title: 'Workflow fields', description: 'Browse definition-level workflow settings.' },
  { group: 'companion-policy', title: 'Companion policy', description: 'Browse companion YAML policy settings.' },
  { group: 'language-contract', title: 'Language contract', description: 'Browse contract topics and semantic rules.' },
]
