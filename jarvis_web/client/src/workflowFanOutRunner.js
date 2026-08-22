import { failedNode, runningNode, successfulNode } from "./workflowExecution.js";

export const FAN_OUT_CONCURRENCY = 4;

function buildTopology(nodes, connections) {
  if (!nodes.length) throw new Error("Add nodes before running the workflow.");
  const nodeMap = new Map();
  for (const node of nodes) {
    if (!node?.id || nodeMap.has(node.id)) throw new Error("Workflow contains a missing or duplicate node ID.");
    nodeMap.set(node.id, node);
  }
  const incoming = new Map(nodes.map((node) => [node.id, []]));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  const edgeKeys = new Set();
  for (const connection of connections) {
    if (!incoming.has(connection.target) || !outgoing.has(connection.source)) throw new Error("Workflow contains a connection to a missing node.");
    if (connection.source === connection.target) throw new Error("Workflow self connections are not supported.");
    const edgeKey = `${connection.source}\u0000${connection.target}`;
    if (edgeKeys.has(edgeKey)) throw new Error("Workflow contains a duplicate connection.");
    edgeKeys.add(edgeKey);
    incoming.get(connection.target).push(connection.source);
    outgoing.get(connection.source).push(connection.target);
  }
  return { nodeMap, incoming, outgoing };
}

export function validateFanOutTopology(nodes, connections) {
  const topology = buildTopology(nodes, connections);
  const triggers = nodes.filter((node) => node.name === "Schedule Trigger");
  if (triggers.length !== 1) throw new Error("A fan-out workflow requires exactly one Schedule Trigger.");
  const trigger = triggers[0];
  if (topology.incoming.get(trigger.id).length) throw new Error("Schedule Trigger must be the workflow start node.");
  if (topology.outgoing.get(trigger.id).length < 2) throw new Error("Fan-out execution requires at least two branches from Schedule Trigger.");
  for (const node of nodes) {
    if (topology.incoming.get(node.id).length > 1) throw new Error("Workflow merges are not supported in this phase.");
    if (node.id !== trigger.id && topology.outgoing.get(node.id).length > 1) {
      throw new Error("Only Schedule Trigger may branch in this phase.");
    }
  }

  const reached = new Set();
  const visiting = new Set();
  const visit = (nodeId) => {
    if (visiting.has(nodeId)) throw new Error("Workflow cycle detected. Execution stopped safely.");
    if (reached.has(nodeId)) return;
    visiting.add(nodeId);
    for (const nextId of topology.outgoing.get(nodeId)) visit(nextId);
    visiting.delete(nodeId);
    reached.add(nodeId);
  };
  visit(trigger.id);
  if (reached.size !== nodes.length) throw new Error("Workflow contains disconnected nodes and cannot run as one fan-out workflow.");

  const branches = topology.outgoing.get(trigger.id).map((firstNodeId, branchIndex) => {
    const nodeIds = [];
    let nodeId = firstNodeId;
    while (nodeId) {
      nodeIds.push(nodeId);
      nodeId = topology.outgoing.get(nodeId)[0] || null;
    }
    return { branchId: firstNodeId, branchIndex, nodeIds };
  });
  return { ...topology, trigger, branches };
}

function summary(node, status, branch) {
  const result = { nodeId: node.id, name: node.name, status, startedAt: node.executionStartedAt, finishedAt: node.executionFinishedAt };
  if (branch) Object.assign(result, { branchId: branch.branchId, branchIndex: branch.branchIndex });
  if (status === "error") result.error = node.error;
  return result;
}

async function runBounded(items, limit, worker) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}

export async function runFanOutWorkflow({ nodes, connections, executeNode, onNodeTransition, now = () => new Date(), concurrency = FAN_OUT_CONCURRENCY }) {
  const topology = validateFanOutTopology(nodes, connections);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error("Fan-out concurrency must be between 1 and 16.");
  const runtimeNodes = new Map(nodes.map((node) => [node.id, { ...node, status: "idle" }]));
  const transition = (node) => { runtimeNodes.set(node.id, node); onNodeTransition?.(node); };

  const triggerRunning = runningNode(runtimeNodes.get(topology.trigger.id), null, now());
  transition(triggerRunning);
  let triggerOutput;
  let triggerSummary;
  try {
    triggerOutput = await executeNode(triggerRunning, null, { triggerMode: "workflow" });
    const triggerSuccess = successfulNode(triggerRunning, triggerOutput, now());
    transition(triggerSuccess);
    triggerSummary = summary(triggerSuccess, "success");
  } catch (error) {
    const triggerFailure = failedNode(triggerRunning, error, now());
    transition(triggerFailure);
    return { status: "error", error: triggerFailure.error, nodes: nodes.map((node) => runtimeNodes.get(node.id)), summaries: [summary(triggerFailure, "error")], branches: [] };
  }

  const branchResults = new Array(topology.branches.length);
  await runBounded(topology.branches, concurrency, async (branch, branchIndex) => {
    let input = triggerOutput;
    const summaries = [];
    for (const nodeId of branch.nodeIds) {
      const running = runningNode(runtimeNodes.get(nodeId), input, now());
      transition(running);
      try {
        const output = await executeNode(running, input, { triggerMode: "workflow", branchId: branch.branchId, branchIndex });
        const success = successfulNode(running, output, now());
        transition(success);
        summaries.push(summary(success, "success", branch));
        input = output;
      } catch (error) {
        const failed = failedNode(running, error, now());
        transition(failed);
        summaries.push(summary(failed, "error", branch));
        branchResults[branchIndex] = { branchId: branch.branchId, branchIndex, status: "error", failedNodeId: nodeId, error: failed.error, summaries };
        return;
      }
    }
    branchResults[branchIndex] = { branchId: branch.branchId, branchIndex, status: "success", summaries };
  });

  const failedBranches = branchResults.filter((branch) => branch.status === "error");
  return {
    status: failedBranches.length ? "error" : "success",
    error: failedBranches.length ? `${failedBranches.length} of ${branchResults.length} workflow branches failed.` : undefined,
    nodes: nodes.map((node) => runtimeNodes.get(node.id)),
    summaries: [triggerSummary, ...branchResults.flatMap((branch) => branch.summaries)],
    branches: branchResults,
  };
}

export function isStrictlyLinearWorkflow(nodes, connections) {
  const { incoming, outgoing } = buildTopology(nodes, connections);
  return [...incoming.values()].every((edges) => edges.length <= 1)
    && [...outgoing.values()].every((edges) => edges.length <= 1);
}
