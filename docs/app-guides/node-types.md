# Choose a node type

Every workflow node has an `id` and exactly one node-kind field. Choose the kind for the work Hermes should perform, then use the selected node's contextual Docs for the fields supplied by the active contract and profile.

## Command

Use a [Command](#node:command) to invoke a Hermes command. The `command` value names the command or command invocation; it is not an inline shell script. Command nodes can use the AI execution settings published by the active contract.

## Prompt

Use a [Prompt](#node:prompt) for an instruction handled by the configured model. Put the instruction in `prompt`. Provider, model, tools, context, and related AI settings are available only where the active contract lists them.

## Bash

Use [Bash](#node:bash) for inline shell text. Put the shell program in `bash`. Workflow Studio checks the field type and workflow structure but does not run the shell, inspect installed programs, or validate generated artifacts.

## Script

Use a [Script](#node:script) for script text with an explicit `runtime`. The bundled contract accepts the runtimes shown in the field reference, including `uv` and `bun`. Studio does not start the runtime, install dependencies, or execute the script.

## Loop

Use a [Loop](#node:loop) to repeat one prompt or one command until a bounded condition is met. It requires `until`, `max_iterations`, and exactly one work field. Use a [Loop group](#node:loop_group) when each iteration needs a child DAG with multiple steps. Read [Loops and approvals](#guide:loops-and-approvals) for loop shape and [Loop groups](#guide:loop-groups) for body scopes and references.

## Approval

Use an [Approval](#node:approval) to place a runtime approval gate in the graph. Its `approval` object requires a message and can optionally describe response capture or rejection handling. Workflow Studio validates the authored object but does not conduct the approval.

## Cancel

Use [Cancel](#node:cancel) to describe an explicit runtime cancellation with a non-empty message. Dependencies, conditions, and trigger rules decide where it sits in the DAG; Hermes decides its execution outcome.

## Valid node examples

This definition shows each current node kind in valid literal YAML. The loop-group kind is included because it is supplied by the active contract alongside the single-work loop kind.

```yaml
name: node-kind-catalog
description: Valid structural examples for every current node kind.
nodes:
  - id: command-step
    command: /review
  - id: prompt-step
    prompt: Summarize the change.
  - id: bash-step
    bash: "printf 'ok\\n'"
  - id: script-step
    script: "print('ok')"
    runtime: uv
  - id: loop-step
    loop:
      prompt: Revise the draft.
      until: done
      max_iterations: 3
  - id: approval-step
    approval:
      message: Continue?
  - id: cancel-step
    cancel: Cancellation requested.
  - id: loop-group-step
    loop_group:
      until: complete
      max_iterations: 2
      nodes:
        - id: child-step
          prompt: Produce one iteration result.
```

## Shared fields and authoring boundary

Common fields include `id`, `depends_on`, `when`, and `trigger_rule`. Other settings such as context, output shape, retries, tools, models, timeouts, and artifacts vary by node kind and profile. The Inspector and Reference views derive their availability, status, constraints, and defaults from the active contract. Read [DAG dependencies](#guide:dag-dependencies), [Conditions and outputs](#guide:conditions-and-outputs), and [Retry and triggers](#guide:retry-and-triggers) for those shared behaviors.

Workflow Studio validates YAML syntax, contract shape, supported profile fields, DAG topology, and statically resolvable references. It saves and exports only structurally valid YAML. It does not execute nodes or confirm that commands, models, runtimes, tools, scripts, services, credentials, approval responders, or produced values exist. Those are Hermes runtime concerns.
