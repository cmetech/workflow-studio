import type { DocumentationRenderer, GuideGroupId, ReferenceGroupId } from './types'

export interface GuideGroup { readonly id: GuideGroupId; readonly title: string }
export interface GuidePresentation {
  readonly group: GuideGroupId
  readonly order: number
  readonly description: string
  readonly useWhen: string
  readonly renderer?: DocumentationRenderer
}
export interface DocumentationTask { readonly id: string; readonly title: string; readonly description: string; readonly topicId: string }
export interface ReferenceEntryPoint { readonly group: ReferenceGroupId; readonly title: string; readonly description: string }

export const GUIDE_GROUPS: readonly GuideGroup[] = [
  { id: 'getting-started', title: 'Getting started' }, { id: 'build-graph', title: 'Build the graph' },
  { id: 'configure-behavior', title: 'Configure behavior' }, { id: 'review-recover', title: 'Review and recover' },
  { id: 'use-application', title: 'Use the application' },
  { id: 'workflow-packages', title: 'Workflow packages' },
]

export const GUIDE_PRESENTATION: Readonly<Record<string, GuidePresentation>> = {
  'workflow-packages': { group: 'workflow-packages', order: 130, description: "Understand the files that travel together as one reusable workflow package.", useWhen: "Understand the files that travel together as one reusable workflow package." },
  'package-folder-structure': { group: 'workflow-packages', order: 135, description: "Arrange workflow members and supporting files under a contained package root.", useWhen: "Arrange workflow members and supporting files under a contained package root." },
  'creating-a-package': { group: 'workflow-packages', order: 140, description: "Create a package from a supported workflow and explicit resource sources.", useWhen: "Create a package from a supported workflow and explicit resource sources." },
  'multiple-workflows-per-package': { group: 'workflow-packages', order: 145, description: "Share resources across explicitly listed workflow members.", useWhen: "Share resources across explicitly listed workflow members." },
  'command-resources': { group: 'workflow-packages', order: 150, description: "Edit command Markdown with bounded metadata parsing and passive previews.", useWhen: "Edit command Markdown with bounded metadata parsing and passive previews." },
  'script-resources': { group: 'workflow-packages', order: 155, description: "Write packaged scripts with offline syntax checks and contract-based resolution.", useWhen: "Write packaged scripts with offline syntax checks and contract-based resolution." },
  'mcp-and-supporting-resources': { group: 'workflow-packages', order: 160, description: "Include the packaged resource closure and distinguish destination services.", useWhen: "Include the packaged resource closure and distinguish destination services." },
  'packaged-and-external-requirements': { group: 'workflow-packages', order: 165, description: "Separate distributed bytes from tools, services, secrets, and trust.", useWhen: "Separate distributed bytes from tools, services, secrets, and trust." },
  'package-readiness': { group: 'workflow-packages', order: 170, description: "Interpret static blockers separately from destination-dependent advisories.", useWhen: "Interpret static blockers separately from destination-dependent advisories." },
  'package-versions-digests-trust': { group: 'workflow-packages', order: 175, description: "Understand exact-byte identity and why resource edits require review.", useWhen: "Understand exact-byte identity and why resource edits require review." },
  'preparing-packages': { group: 'workflow-packages', order: 180, description: "Validate, review, and record a package without remote publication.", useWhen: "Validate, review, and record a package without remote publication." },
  'updating-packages': { group: 'workflow-packages', order: 185, description: "Review shared resource changes and prepare a new local version.", useWhen: "Review shared resource changes and prepare a new local version." },
  'publishing-packages-with-git': { group: 'workflow-packages', order: 190, description: "Make prepared local content available through an external repository operation.", useWhen: "Make prepared local content available through an external repository operation." },
  'coworker-package-installation': { group: 'workflow-packages', order: 195, description: "Understand the destination marketplace review and trust boundary.", useWhen: "Understand the destination marketplace review and trust boundary." },
  'package-troubleshooting': { group: 'workflow-packages', order: 200, description: "Recover drafts and diagnose stale snapshots, conflicts, and unsupported contexts.", useWhen: "Recover drafts and diagnose stale snapshots, conflicts, and unsupported contexts." },
  'quick-start': {
    group: 'getting-started',
    order: 10,
    description: 'Create and save a small structurally valid workflow.',
    useWhen: 'Use this when you want to create and save your first workflow.',
  },
  'node-types': {
    group: 'getting-started',
    order: 15,
    description: 'Choose the node kind that matches the work you want loop24 to perform.',
    useWhen: 'Use this when you are deciding which node type to add.',
  },
  'workflow-pairs': {
    group: 'getting-started',
    order: 20,
    description: 'Understand how definition and companion YAML files work together.',
    useWhen: 'Use this when you need to understand definition and companion YAML files.',
  },
  'dag-dependencies': {
    group: 'build-graph',
    order: 30,
    description: 'Connect nodes with valid acyclic dependencies.',
    useWhen: 'Use this when you are connecting steps or resolving dependency order.',
  },
  'conditions-and-outputs': {
    group: 'build-graph',
    order: 40,
    description: 'Reference upstream outputs safely in conditions.',
    useWhen: 'Use this when a condition or output should control a later step.',
  },
  'loops-and-approvals': {
    group: 'build-graph',
    order: 50,
    description: 'Use loop and approval nodes inside an acyclic graph.',
    useWhen: 'Use this when your graph needs repeated work or an approval gate.',
  },
  'loop-groups': {
    group: 'build-graph',
    order: 55,
    description: 'Drill into loop bodies and use scoped output references safely.',
    useWhen: 'Use this when authoring a loop group or its child graph.',
  },
  'retry-and-triggers': {
    group: 'configure-behavior',
    order: 60,
    description: 'Configure retry policies and trigger rules.',
    useWhen: 'Use this when you need to configure retries or trigger rules.',
  },
  'companion-policies': {
    group: 'configure-behavior',
    order: 70,
    description: 'Place delivery and policy settings in companion YAML.',
    useWhen: 'Use this when workflow policy belongs in the companion file.',
  },
  'profiles-and-compatibility': {
    group: 'configure-behavior',
    order: 80,
    description: 'Choose profiles and interpret compatibility findings.',
    useWhen: 'Use this when a workflow profile or compatibility finding needs review.',
  },
  'problems-and-validation': {
    group: 'review-recover',
    order: 90,
    description: 'Resolve structural blockers and distinguish runtime advisories.',
    useWhen: 'Use this when a validation problem blocks saving or export.',
  },
  'git-versions': {
    group: 'review-recover',
    order: 100,
    description: 'Review and record local workflow versions with Git.',
    useWhen: 'Use this when you want to inspect or create a local Git version.',
  },
  troubleshooting: {
    group: 'review-recover',
    order: 110,
    description: 'Recover from common authoring problems.',
    useWhen: 'Use this when an authoring problem needs practical recovery steps.',
  },
  'keyboard-shortcuts': {
    group: 'use-application',
    order: 120,
    description: 'Find registered commands, node chords, and canvas gestures.',
    useWhen: 'Use this when you want to work faster with keyboard shortcuts.',
    renderer: 'keyboard-shortcuts',
  },
}

export const START_HERE = [
  { topicId: 'guide:quick-start', title: 'Quick Start' },
  { topicId: 'guide:node-types', title: 'Choose a node type' },
  { topicId: 'guide:workflow-pairs', title: 'Workflow pairs' },
  { topicId: 'guide:dag-dependencies', title: 'DAG dependencies' },
  { topicId: 'guide:problems-and-validation', title: 'Problems and validation' },
  { topicId: 'guide:keyboard-shortcuts', title: 'Keyboard shortcuts' },
] as const

export const DOCUMENTATION_TASKS: readonly DocumentationTask[] = [
  { id: 'create-workflow', title: 'Create or open a workflow', description: 'Start a workflow in a local folder.', topicId: 'guide:quick-start' },
  { id: 'choose-node-type', title: 'Choose the right node type', description: 'Match a workflow step to a contract-supported node kind.', topicId: 'guide:node-types' },
  { id: 'add-connect-steps', title: 'Add and connect steps', description: 'Build an acyclic workflow graph.', topicId: 'guide:dag-dependencies' },
  { id: 'conditions-outputs', title: 'Add conditions and use outputs', description: 'Control later steps with earlier results.', topicId: 'guide:conditions-and-outputs' },
  { id: 'retries-triggers', title: 'Configure retries and trigger rules', description: 'Set execution behavior for a node.', topicId: 'guide:retry-and-triggers' },
  { id: 'loops-approvals', title: 'Use loops and approvals', description: 'Add bounded repetition or a review gate.', topicId: 'guide:loops-and-approvals' },
  { id: 'loop-groups', title: 'Author a loop group', description: 'Edit a loop body and its scoped references.', topicId: 'guide:loop-groups' },
  { id: 'companion-profiles', title: 'Configure companion policy and profiles', description: 'Manage companion settings and compatibility.', topicId: 'guide:companion-policies' },
  { id: 'git-versions', title: 'Review local Git versions', description: 'Inspect or record local workflow history.', topicId: 'guide:git-versions' },
  { id: 'fix-problem', title: 'Fix a validation problem', description: 'Understand save-blocking issues and advisories.', topicId: 'guide:problems-and-validation' },
  { id: 'keyboard-shortcuts', title: 'Work faster with keyboard shortcuts', description: 'Find commands, chords, and canvas gestures.', topicId: 'guide:keyboard-shortcuts' },
  { id: 'prepare-package', title: 'Prepare a workflow package', description: 'Validate scripts and resources, then create a local Git version.', topicId: 'guide:preparing-packages' },
]

export const REFERENCE_ENTRY_POINTS: readonly ReferenceEntryPoint[] = [
  { group: 'node-types', title: 'Node types', description: 'Browse node kinds supplied by this contract.' },
  { group: 'common-node-settings', title: 'Common node settings', description: 'Browse fields shared across node kinds.' },
  { group: 'workflow-fields', title: 'Workflow fields', description: 'Browse definition-level workflow settings.' },
  { group: 'companion-policy', title: 'Companion policy', description: 'Browse companion YAML policy settings.' },
  { group: 'language-contract', title: 'Language contract', description: 'Browse contract topics and semantic rules.' },
]
