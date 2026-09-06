# Loops and approvals

Use a loop for bounded repeated work, an approval for a human gate, and cancel for an explicit cancellation outcome. These remain ordinary nodes in an acyclic workflow graph.

```yaml
name: approval-gate
description: Request an approval before continuing.
nodes:
  - id: approve-review
    approval:
      message: Continue?
```

## Ordinary loops

An ordinary [Loop](#node:loop) repeats one `prompt` or one `command`. The loop object requires `until`, `max_iterations`, and exactly one of those two work fields. The current contract bounds `max_iterations` from 1 through 100. When `interactive: true`, add a non-empty `gate_message`.

```yaml
name: bounded-revision
description: Revise a draft no more than three times.
nodes:
  - id: revise
    loop:
      prompt: Revise the draft.
      until: done
      max_iterations: 3
```

A [Loop group](#node:loop_group) repeats a child DAG instead of one prompt or command. Its `nodes`, `until`, and `max_iterations` fields are required. Open the body canvas to author its children, then use [Loop groups](#guide:loop-groups) for scoped dependencies and current, outer, or previous-iteration output references.

## Approval and rejection

An [Approval](#node:approval) requires a non-empty [Message](#field:approval.approval.message). `capture_response` and `on_reject` are optional contract fields. When `on_reject` is present, it requires a prompt and can bound its attempts.

Approval is a runtime interaction. Workflow Studio checks its YAML shape and graph references but does not display the live approval, collect a response, or predict the rejection path.

## Cancellation

A [Cancel](#node:cancel) carries a non-empty cancellation message. It can use the same dependency and trigger fields published for that node kind, which lets the graph describe when cancellation is eligible.

```yaml
name: cancel-after-review
description: Request cancellation after a review step.
nodes:
  - id: review
    prompt: Check whether the workflow should continue.
  - id: stop
    cancel: Review requested cancellation.
    depends_on: [review]
```

Workflow Studio validates loop bounds, required fields, dependencies, output-reference visibility, and DAG topology. Hermes performs iterations, approvals, rejection handling, and cancellation during execution. Runtime tools, commands, services, credentials, and actual results remain outside the editor.
