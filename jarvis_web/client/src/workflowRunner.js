import { failedNode, runningNode, successfulNode } from "./workflowExecution.js";

export async function runLinearWorkflow({ nodes, connections, executeNode, onNodeTransition, now = () => new Date() }) {
  if (!nodes.length) throw new Error("Add nodes before running the workflow.");
  const incoming = new Map(nodes.map((node) => [node.id, []]));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  for (const connection of connections) {
    if (!incoming.has(connection.target) || !outgoing.has(connection.source)) throw new Error("Workflow contains a connection to a missing node.");
    incoming.get(connection.target).push(connection.source);
    outgoing.get(connection.source).push(connection.target);
  }
  if ([...incoming.values()].some((edges) => edges.length > 1) || [...outgoing.values()].some((edges) => edges.length > 1)) {
    throw new Error("Phase 2 supports linear workflows only; branching or merging is not supported.");
  }
  for (const node of nodes) {
    const seen = new Set();
    let cursor = node.id;
    while (cursor) {
      if (seen.has(cursor)) throw new Error("Workflow cycle detected. Execution stopped safely.");
      seen.add(cursor);
      cursor = outgoing.get(cursor)?.[0];
    }
  }
  const starts = nodes.filter((node) => incoming.get(node.id).length === 0);
  if (starts.length !== 1 || starts[0].name !== "Schedule Trigger") throw new Error("A linear workflow requires exactly one Schedule Trigger start node.");

  const nodeMap = new Map(nodes.map((node) => [node.id, { ...node, status: "idle" }]));
  const visited = new Set();
  const summaries = [];
  let current = starts[0];
  let input = null;
  while (current) {
    if (visited.has(current.id)) throw new Error("Workflow cycle detected. Execution stopped safely.");
    visited.add(current.id);
    const startedAt = now();
    const running = runningNode(nodeMap.get(current.id), input, startedAt);
    nodeMap.set(current.id, running); onNodeTransition?.(running);
    try {
      const output = await executeNode(running, input, { triggerMode: "workflow" });
      const success = successfulNode(running, output, now());
      nodeMap.set(current.id, success); onNodeTransition?.(success);
      summaries.push({ nodeId: current.id, name: current.name, status: "success", startedAt: success.executionStartedAt, finishedAt: success.executionFinishedAt });
      input = output;
    } catch (error) {
      const failed = failedNode(running, error, now());
      nodeMap.set(current.id, failed); onNodeTransition?.(failed);
      summaries.push({ nodeId: current.id, name: current.name, status: "error", startedAt: failed.executionStartedAt, finishedAt: failed.executionFinishedAt, error: failed.error });
      return { status: "error", error: failed.error, nodes: nodes.map((node) => nodeMap.get(node.id)), summaries };
    }
    const nextId = outgoing.get(current.id)[0];
    current = nextId ? nodeMap.get(nextId) : null;
  }
  if (visited.size !== nodes.length) throw new Error("Workflow contains disconnected nodes and cannot run as one linear workflow.");
  return { status: "success", nodes: nodes.map((node) => nodeMap.get(node.id)), summaries };
}
