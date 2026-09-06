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

## Reuse outputs with References

Inside a loop body, open **References** beside **Problems** in the bottom panel. The canvas keeps its compact scope header above the graph. The Problems and blocking counts remain visible whichever tab is selected.

The panel groups references by where an output comes from:

- **Earlier nodes in this iteration** lists current body outputs such as `$child.output`. The focused body field must support the reference, and its node must depend directly on that child.
- **Inputs from the main workflow** lists root outputs such as `$outer.output` when the loop already depends directly on that root node.
- **Outputs from the previous iteration** lists body outputs such as `$LOOP_PREV.child.output`. A whole previous output resolves to an empty value on the first iteration.
- **More workflow outputs** explains unavailable root outputs. An action such as **Allow this loop to use seed** explicitly adds that group dependency when safe. **Copy** and **Insert** never add dependencies automatically.

A body ID shadows an equal outer ID. Suggestions follow the active field and scope; they do not preview runtime values. **Copy** copies exact reference text and works without an insertion target. To use **Insert**, focus a compatible Inspector text field. The banner then shows **Insert target:** followed by the node and field names. That remembered field remains the target while you use the panel; **Apply** commits the edited field to YAML. If no valid target exists, the banner asks you to focus a compatible Inspector text field and Insert is disabled.

Each scope remembers its selected tab and each tab's scroll position. On the first visit, a body opens Problems if blocking issues exist and References otherwise. Use the Left and Right arrow keys, Home, or End to switch tabs from the tab bar; Tab moves into the selected panel.

## Output and companion paths

When a body has multiple terminal children, the loop-group output comes from the first terminal child in YAML definition order. Canvas position does not choose it. Companion paths qualify a child with its group, for example `summarize/publish`.

## Visual capacity and YAML fallback

Capacity applies independently to each graph scope. A scope is visual at up to **250 nodes** and **500 edges**. If a body exceeds either limit, Studio preserves it intact in **YAML-only mode**; the root can remain visual and **Back** remains available. Edit the oversized body in YAML or reduce it below the limit.

Workflow Studio validates authoring structure. It does not execute a group, predict its iterations, or resolve tools, services, credentials, and other runtime advisories.
