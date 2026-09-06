# Retry and triggers

Use `trigger_rule` to express which dependency outcomes allow a node to run. Add `retry` only to a node kind and profile whose contract reference lists that field.

The active contract accepts four trigger rules:

- `all_success` requires all dependencies to succeed.
- `one_success` requires at least one dependency to succeed.
- `none_failed_min_one_success` requires at least one success and no failure.
- `all_done` waits for dependency completion regardless of outcome.

The retry object can set `max_attempts`, `on_error`, and `delay_ms`. `on_error` is `transient` or `all`, and an explicit delay is from 1,000 through 60,000 milliseconds. The meaning and lower bound of `max_attempts` depend on the selected profile and node kind.

## Archon retry counts

In `archon-2026-07` contract v6, `max_attempts` means retries after the initial attempt for every node kind that supports `retry`.

- Prompt and Command accept 0 through 5. Zero explicitly disables retries; omitting the retry count uses the contract's AI default of two retries.
- Bash and Script accept an explicit count from 1 through 5. To use their deterministic default of zero retries, omit the `retry` field instead of writing `max_attempts: 0`.

This Archon example disables retries explicitly for the AI nodes and enables one retry for the deterministic nodes:

```yaml profile=archon-2026-07 invalid-in=hermes-legacy
name: archon-retry-bounds
description: Use node-specific Archon retry bounds.
nodes:
  - id: prompt-review
    prompt: Review the change.
    retry:
      max_attempts: 0
  - id: command-review
    command: /review
    retry:
      max_attempts: 0
  - id: bash-check
    bash: "printf 'ok\\n'"
    retry:
      max_attempts: 1
  - id: script-check
    script: "print('ok')"
    runtime: uv
    retry:
      max_attempts: 1
```

## Legacy total attempts

In `hermes-legacy` contract v2, `max_attempts` accepts 1 through 5 and retains total-attempt semantics. Authoring that field produces the non-blocking compatibility finding `legacy_retry_total_attempts`; consult its migration guidance before relying on it. Zero is invalid in this profile.

```yaml profile=hermes-legacy
name: legacy-retry
description: Preserve a legacy total-attempt retry value.
nodes:
  - id: review
    prompt: Review the change.
    retry:
      max_attempts: 2
      on_error: transient
      delay_ms: 1000
```

Workflow Studio validates enum values, ranges, types, and profile status. Hermes owns dependency outcomes, retry classification, delays, and execution. An unavailable command, provider, script runtime, service, or credential remains a runtime concern rather than proof that the YAML structure is invalid. See [Trigger rule](#field:prompt.node.trigger_rule), [Retry](#field:prompt.node.retry), and [Problems and validation](#guide:problems-and-validation).
