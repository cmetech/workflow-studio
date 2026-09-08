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

## Arrange Graph and routed dependencies

Choose **More → Arrange Graph** in the visual toolbar when connections overlap or the diagram needs more room. Arrange Graph places nodes from left to right and routes dependencies around other nodes. Separate attachment points help you follow branches leaving one node and joining another.

Arrange Graph changes only the **active canvas**: the main workflow, or the loop body you have opened. To arrange a loop body, choose **Open loop body** on its group, then use Arrange Graph there. The main workflow and each loop body keep their own positions, connections, and zoom when you return to them.

You can pan, zoom, and select while the graph is arranging. Moving nodes and changing connections become available again when it finishes. If arrangement fails before updating the diagram, the editor keeps your current layout and lets you try again.

If interrupted after the diagram updates, the editor reports **Arrange Graph was interrupted after updating the canvas.** The updated diagram remains unless you change it or leave that view, but the interrupted Arrange action does not finish saving its layout. Run Arrange Graph again when the canvas is available.

Some complex graphs still need crossing lines. A small gap separates their strokes at a crossing. Hover over a connection, select it, or reach it with the keyboard to bring it forward and highlight the two nodes it connects. Arrowheads show the dependency direction.

Dragging a node keeps your **manual placement** and makes connections follow it using the live preview. They may overlap again after a drag or dependency edit; rerun Arrange Graph when you want a fresh routed layout. Editing node text keeps existing routes when the card dimensions and dependencies stay the same.

Positions, routed connections, and zoom are saved as local editor settings on this computer. Arrange Graph does not change workflow YAML, execution order, or workflow behavior, and does not create an undo step or Git change. This feature works offline. The **Svelte Flow** label identifies the canvas library; a Pro subscription is not needed to arrange the graph.
