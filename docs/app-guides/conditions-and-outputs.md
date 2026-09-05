# Conditions and outputs

Use `when` only with outputs from upstream nodes.

```yaml
name: conditional-review
description: Review only a ready upstream result.
nodes:
  - id: prepare
    bash: |-
      printf '%s\n' '{"status":"ready"}'
    output_format:
      type: object
      additionalProperties: false
      required: [status]
      properties:
        status: {type: string, enum: [ready, blocked]}
  - id: review
    prompt: Review the change.
    depends_on: [prepare]
    when: "$prepare.output.status == 'ready'"
```

References and upstream ordering are structural validation. Actual output values remain operational and are not simulated by the editor. See [When](#field:prompt.node.when).
