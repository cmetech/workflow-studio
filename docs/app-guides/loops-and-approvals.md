# Loops and approvals

Use loop and approval nodes inside an otherwise acyclic workflow graph.

```yaml
nodes:
  - id: approve-review
    approval:
      message: Continue?
```

The editor validates node structure and graph topology. It does not perform approvals or execute loop work. See [Approval](#node:approval) and [Message](#field:approval.approval.message).
