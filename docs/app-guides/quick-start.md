# Quick Start

Use this path to create, understand, and save a small Hermes workflow without leaving the local editor. Workflow Studio works offline and does not execute workflows.

## 1. Open a local folder

Choose **Open Folder** and select the folder where you keep workflow files. The editor discovers definition files with `.yaml` or `.yml` names and their optional companion files.

## 2. Create a workflow or start from an example

Create a new workflow in the workspace, or open the **Examples** activity and create an editable copy of a bundled example. An example is a starting point; save your copy in your own workspace before editing it.

## 3. Understand the workflow pair

The definition YAML contains the workflow name, description, nodes, and dependencies. An optional `.hermes.yaml` companion contains policy and profile metadata; it does not add nodes or replace the definition graph. Read [Workflow pairs](#guide:workflow-pairs) when you need to choose where a setting belongs.

## 4. Add a node in Visual or YAML mode

In **Visual** mode, add a node from the palette and edit known fields in the Inspector. In **YAML** mode, type the definition directly. Both views edit the same authoritative YAML text, so you can switch modes without creating a second graph model.

This small definition is a structurally valid starting point for the `archon-2026-07` profile:

```yaml
name: first-review
description: Prepare a change and ask for a review.
nodes:
  - id: prepare
    bash: "printf 'ready\\n'"
  - id: review
    prompt: Review the prepared change.
    depends_on: [prepare]
```

## 5. Connect nodes without creating a cycle

Connect a later node to an earlier node by adding a dependency. The graph must remain directed and acyclic: each dependency must name an existing upstream node, and a node cannot depend on itself. [DAG dependencies](#guide:dag-dependencies) explains ordering and cycle errors.

## 6. Use the Inspector and contextual Docs

Select a node to edit supported fields in the Inspector. Open its **Docs** tab for the exact field topic, including its profile status, constraints, defaults, and applicable node kinds. Contract metadata remains the authority for field behavior.

## 7. Read Problems before saving

The **Problems** panel separates syntax, contract/schema, semantic graph, compatibility, and operational findings. Syntax, schema, profile-disallowed, and DAG issues are structural blockers; missing runtime tools and services are advisories. Read [Problems and validation](#guide:problems-and-validation) when a save or export is blocked.

## 8. Save the structurally valid pair

Save the definition and optional companion only after the blocking Problems are resolved. Workflow Studio checks syntax and structure before save/export. It cannot prove that an external command, provider, service, credential, or script is available, and it never claims that a saved workflow will execute successfully.

## 9. Optionally review a local Git version

Use the **Git** activity to inspect a local diff, history, or create an explicit local commit for the workflow pair. Git integration is local-only in version one; it does not push, pull, or contact a remote.

Continue with [Workflow pairs](#guide:workflow-pairs), [DAG dependencies](#guide:dag-dependencies), [Problems and validation](#guide:problems-and-validation), and [Keyboard shortcuts](#guide:keyboard-shortcuts). To begin from a bundled workflow, open the **Examples** activity.

Workflow Studio does not execute this workflow. It cannot verify external tools, providers, services, credentials, or scripts are available.
