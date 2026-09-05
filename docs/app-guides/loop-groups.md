# Loop groups

A loop group is one compound node on the root canvas. Select **Open loop body** to edit its child graph. The scope breadcrumb names the workflow and group; use **Back** to return to the root canvas. Each scope keeps its own selection and viewport.

## Create and repair a group

Adding a loop group creates the exact repairable draft `loop_group: { nodes: [] }`. The draft remains in YAML, but save and export stay blocked until the required group controls and at least one valid child are present. In an empty body, use **Add First Node** or **Edit Group Settings**.

This complete group has one body node:

```yaml
name: bounded-refinement
description: Refine a draft in a bounded loop group.
nodes:
  - id: refine
    loop_group:
      until: complete
      max_iterations: 2
      nodes:
        - id: draft
          prompt: Draft a concise summary.
```

## Reference current, outer, and previous outputs

- `$child.output` reads a current body node and requires a direct body dependency on that child.
- `$outer.output` reads a root node only when the loop group has a direct root dependency on that node. **Add group dependency** is an explicit YAML change; **Copy** and **Insert** never add it automatically.
- `$LOOP_PREV.child.output` reads that child's previous-iteration output. A whole previous output resolves to an empty value on the first iteration.

A body ID shadows an equal outer ID. The reference bar lists only references valid for the active field and scope. **Copy** copies exact reference text, while **Insert** changes only the currently focused compatible field.

## Output and companion paths

When a body has multiple terminal children, the loop-group output comes from the first terminal child in YAML definition order. Canvas position does not choose it. Companion paths qualify a child with its group, for example `summarize/publish`.

## Visual capacity and YAML fallback

Capacity applies independently to each graph scope. A scope is visual at up to **250 nodes** and **500 edges**. If a body exceeds either limit, Studio preserves it intact in **YAML-only mode**; the root can remain visual and **Back** remains available. Edit the oversized body in YAML or reduce it below the limit.

Workflow Studio validates authoring structure. It does not execute a group, predict its iterations, or resolve tools, services, credentials, and other runtime advisories.
