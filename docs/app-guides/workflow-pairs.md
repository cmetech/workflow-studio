# Workflow pairs

Create a definition YAML file and, when policy metadata is needed, an optional `.hermes.yaml` companion. The definition is the graph authority; the companion cannot add graph nodes.

```yaml
name: review-workflow
description: Review a change
nodes:
  - id: review
    prompt: Review the change.
```

Structural validation checks the YAML shape and graph. Missing providers, tools, credentials, or services are operational advisories and do not prove that a workflow will execute. See [Workflow definition](#contract:workflow-definition) and [Prompt](#field:prompt.node.prompt).
