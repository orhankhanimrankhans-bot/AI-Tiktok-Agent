function validGraph(nodes = [], connections = []) {
  const nodeMap = new Map(nodes.filter((node) => node?.id).map((node) => [node.id, node]));
  const seen = new Set();
  const validConnections = connections.filter((connection) => {
    if (!nodeMap.has(connection?.source) || !nodeMap.has(connection?.target) || connection.source === connection.target) return false;
    const key = `${connection.source}\u0000${connection.target}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  const incoming = new Map([...nodeMap.keys()].map((id) => [id, []]));
  const outgoing = new Map([...nodeMap.keys()].map((id) => [id, []]));
  for (const connection of validConnections) {
    incoming.get(connection.target).push(connection.source);
    outgoing.get(connection.source).push(connection.target);
  }
  return { nodeMap, validConnections, incoming, outgoing };
}

function followBranch(firstNodeId, outgoing, reachable) {
  const nodeIds = []; const visited = new Set(); let nodeId = firstNodeId;
  while (nodeId && reachable.has(nodeId) && !visited.has(nodeId)) {
    visited.add(nodeId); nodeIds.push(nodeId);
    const next = outgoing.get(nodeId)?.filter((id) => reachable.has(id)) || [];
    nodeId = next.length === 1 ? next[0] : null;
  }
  return nodeIds;
}

export function buildDashboardGraph(nodes = [], connections = []) {
  const graph = validGraph(nodes, connections);
  const triggers = nodes.filter((node) => node?.name === "Schedule Trigger" && graph.nodeMap.has(node.id) && graph.incoming.get(node.id).length === 0);
  const roots = triggers.length ? triggers : nodes.filter((node) => graph.nodeMap.has(node?.id)
    && graph.incoming.get(node.id).length === 0 && graph.outgoing.get(node.id).length > 0);
  const reachable = new Set(); const queue = roots.map((node) => node.id);
  while (queue.length) {
    const nodeId = queue.shift();
    if (reachable.has(nodeId)) continue;
    reachable.add(nodeId);
    for (const targetId of graph.outgoing.get(nodeId) || []) queue.push(targetId);
  }
  const connectedNodes = nodes.filter((node) => reachable.has(node.id));
  const connectedConnections = graph.validConnections.filter((connection) => reachable.has(connection.source) && reachable.has(connection.target));
  const trigger = triggers.find((node) => reachable.has(node.id)) || roots[0] || null;
  const firstBranchNodes = trigger ? graph.outgoing.get(trigger.id).filter((id) => reachable.has(id)) : [];
  const branches = firstBranchNodes.map((firstNodeId, branchIndex) => ({
    branchId: firstNodeId, branchIndex, nodes: followBranch(firstNodeId, graph.outgoing, reachable).map((id) => graph.nodeMap.get(id)),
  }));
  return { nodes: connectedNodes, connections: connectedConnections, triggers: triggers.filter((node) => reachable.has(node.id)), trigger, branches };
}

export function dashboardNodeState(node, workflowActive) {
  if (!workflowActive) return "idle";
  return ["running", "success", "error"].includes(node?.status) ? node.status : "queued";
}

export function dashboardRoutingStatus(graph, workflowActive, workflowError = false) {
  if (!workflowActive) return workflowError ? "Last run error" : "Waiting";
  const runningNode = graph.nodes.find((node) => node.status === "running");
  if (graph.branches.length > 1) {
    const activeBranches = graph.branches.filter((branch) => branch.nodes.some((node) => node.status === "running")).length;
    if (activeBranches) return `${activeBranches} active ${activeBranches === 1 ? "branch" : "branches"}`;
    if (runningNode?.id === graph.trigger?.id) return `Starting ${graph.branches.length} branches`;
  }
  return runningNode?.name || "Workflow active";
}
