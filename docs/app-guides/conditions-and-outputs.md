# Conditions and outputs

Use `when` only with outputs from upstream nodes.

```yaml
nodes:
  - id: prepare
    bash: "printf 'ok\\n'"
  - id: review
    prompt: Review the change.
    depends_on: [prepare]
    when: "$prepare.output.status == 'ready'"
```

References and upstream ordering are structural validation. Actual output values remain operational and are not simulated by the editor. See [When](#field:prompt.node.when).
