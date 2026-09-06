# Conditions and outputs

Use `when` to compare outputs from direct upstream dependencies. A reference starts with `$`, uses a node ID, then `.output`; optional dotted name or array-index segments select a structured value.

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

The current condition grammar accepts comparisons with `==`, `!=`, `<`, `<=`, `>`, or `>=`, joined with `&&` and `||`. Each referenced node must be both upstream and listed directly in `depends_on`. A plain output reference is not a complete `when` expression.

`output_format` describes the output shape expected from a node. It lets Workflow Studio validate the authored schema and statically check a known structured path. It does not create an output, run the producer, coerce a runtime value, or prove that the producer returns that shape.

Output references also work in contract-published text fields such as prompts. Studio checks the closed `$ID.output(.path)*` grammar and direct dependency. Command and script values can represent authenticated resources in some scopes, so use the field's contextual Docs instead of assuming every string is interpolated.

Inside a loop group, reference visibility depends on scope. Body siblings use `$child.output`, outer inputs use `$outer.output` after the group directly depends on the outer node, and previous-iteration values use `$LOOP_PREV.child.output`. Read [Loop groups](#guide:loop-groups) before inserting scoped references.

References, paths, expression syntax, and upstream ordering are authoring validation. Actual output values and condition results exist only during Hermes execution and are not simulated by Workflow Studio. See [When](#field:prompt.node.when) and [DAG and conditions](#contract:dag-and-conditions).
