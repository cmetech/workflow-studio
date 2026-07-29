# DAG dependencies

Use `depends_on` to order node work without creating a cycle.

```yaml
name: ordered-review
description: Prepare a result before review.
nodes:
  - id: prepare
    bash: "printf 'ok\\n'"
  - id: review
    prompt: Review the change.
    depends_on: [prepare]
```

The editor blocks missing dependencies and cycles structurally. It cannot verify that the command or prompt succeeds at runtime. See [DAG and conditions](#contract:dag-and-conditions) and [Depends on](#field:prompt.node.depends_on).
