# Retry and triggers

Use `trigger_rule` to express which dependency outcomes allow a node to run. Add `retry` only to a node kind and profile whose contract reference lists that field.

```yaml
name: retry-review
description: Review with a trigger rule and retry policy.
nodes:
  - id: review
    prompt: Review the change.
    trigger_rule: all_success
    retry:
      max_attempts: 2
      on_error: transient
      delay_ms: 1000
```

The active contract accepts four trigger rules:

- `all_success` requires all dependencies to succeed.
- `one_success` requires at least one dependency to succeed.
- `none_failed_min_one_success` requires at least one success and no failure.
- `all_done` waits for dependency completion regardless of outcome.

The retry object can set `max_attempts`, `on_error`, and `delay_ms`. In the bundled contract, the `max_attempts` annotation counts retries after the initial attempt; an explicit value is from 1 through 5. `on_error` is `transient` or `all`, and an explicit delay is from 1,000 through 60,000 milliseconds. Omitted retry behavior differs by node category, so inspect the current field Docs instead of writing a synthetic zero value.

Workflow Studio validates enum values, ranges, types, and profile status. Hermes owns dependency outcomes, retry classification, delays, and execution. An unavailable command, provider, script runtime, service, or credential remains a runtime concern rather than proof that the YAML structure is invalid. See [Trigger rule](#field:prompt.node.trigger_rule), [Retry](#field:prompt.node.retry), and [Problems and validation](#guide:problems-and-validation).
