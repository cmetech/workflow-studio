# Retry and triggers

Set a trigger rule and, where your profile supports it, retry settings.

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

Field shape is structural; retry behavior and external failures are operational advisories. Check the profile status before relying on deferred fields. See [Trigger rule](#field:prompt.node.trigger_rule) and [Retry](#field:prompt.node.retry).
