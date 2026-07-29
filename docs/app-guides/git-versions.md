# Git versions

Use local Git status, diffs, history, initialization, and explicit commits to review YAML changes.

```yaml
name: review-workflow
description: Review a change
nodes:
  - id: review
    prompt: Review the change.
```

Git records local versions; it does not validate workflow execution. Save/export requires structural validity, while missing runtime dependencies stay advisory. See [Workflow definition](#contract:workflow-definition).
