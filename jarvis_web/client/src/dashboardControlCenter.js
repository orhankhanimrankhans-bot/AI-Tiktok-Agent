export function controlCenterState({ graph, workflowActive = false, workflowError = false, healthStates = [] } = {}) {
  if (workflowError) return "error";
  if (workflowActive) return "running";
  if (!graph?.nodes?.length) return "disconnected";
  if (healthStates.includes("error")) return "error";
  if (healthStates.includes("disconnected")) return "disconnected";
  return "ready";
}

function outputItems(node) {
  const output = node?.output;
  if (Array.isArray(output)) return output;
  if (Array.isArray(output?.items)) return output.items;
  if (Array.isArray(output?.files)) return output.files;
  return [];
}

export function dashboardFacts({ graph = { nodes: [], branches: [], connections: [] }, googleCredentials = [], facebookCredentials = [], executions = [], lastExecutionAt = null } = {}) {
  const nodes = graph.nodes || [];
  const searchNodes = nodes.filter((node) => /Search Files|Search Files and Folders/i.test(node.name || ""));
  const queuedItems = searchNodes.flatMap(outputItems);
  const driveNodes = nodes.filter((node) => node.provider === "Google Drive" || /^Google Drive/.test(node.name || "") || /Move File|Download File|Search Files/i.test(node.name || ""));
  const facebookNodes = nodes.filter((node) => node.name === "Facebook Graph API");
  const lastExecution = executions[0] || null;
  return {
    queuedItems,
    driveNodes,
    facebookNodes,
    googleCredentials,
    facebookCredentials,
    lastExecution,
    lastExecutionAt,
    nodeCount: nodes.length,
    connectionCount: graph.connections?.length || 0,
    branchCount: graph.branches?.length || 0,
    triggerCount: graph.triggers?.length || 0,
  };
}
