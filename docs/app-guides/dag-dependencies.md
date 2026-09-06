# DAG dependencies

Use `depends_on` to declare the nodes whose results a step needs. Workflow Studio draws those relationships as directed edges and validates them as a graph.

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

Every dependency must name an existing node in the same graph scope. A node cannot depend on itself, list the same dependency twice, or take part in a cycle. YAML order is kept as authored; `depends_on` supplies the graph relationship.

Output references have a tighter rule: the producer must be a direct dependency of the node containing the reference. Add the dependency explicitly before using `$prepare.output` or one of its paths. Read [Conditions and outputs](#guide:conditions-and-outputs) for the reference grammar.

Loop-group bodies are separate DAG scopes. Body nodes depend on siblings in that body. A group itself depends on root nodes whose outputs its body uses; the References panel can offer an explicit safe action for that outer dependency. Read [Loop groups](#guide:loop-groups) for current-iteration, outer-workflow, and previous-iteration references.

The editor blocks missing dependencies, duplicate dependencies, self-dependencies, and cycles as authoring errors. It does not schedule or execute nodes, and it cannot verify that a command, prompt, script, or service succeeds at runtime. See [DAG and conditions](#contract:dag-and-conditions) and [Depends on](#field:prompt.node.depends_on).
