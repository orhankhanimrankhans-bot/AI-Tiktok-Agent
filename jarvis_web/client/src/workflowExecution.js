export const NODE_STATUSES = ["idle", "running", "success", "error"];

export function runningNode(node, input, now = new Date()) {
  return {
    ...node,
    status: "running",
    input: input ?? null,
    output: null,
    error: null,
    executionStartedAt: now.toISOString(),
    executionFinishedAt: null,
  };
}

export function successfulNode(node, output, now = new Date()) {
  return {
    ...node,
    status: "success",
    output,
    error: null,
    executionFinishedAt: now.toISOString(),
  };
}

export function failedNode(node, error, now = new Date()) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    ...node,
    status: "error",
    output: { status: "error", message },
    error: message,
    executionFinishedAt: now.toISOString(),
  };
}

export async function executeWithLifecycle({ node, input, executor, onTransition, now = () => new Date() }) {
  const running = runningNode(node, input, now());
  onTransition?.(running);
  try {
    const output = await executor(running);
    const success = successfulNode(running, output, now());
    onTransition?.(success);
    return success;
  } catch (error) {
    const failed = failedNode(running, error, now());
    onTransition?.(failed);
    return failed;
  }
}

export function createScheduleManualOutput(config = {}, now = new Date()) {
  const rules = Array.isArray(config.rules) ? config.rules : [];
  return {
    triggeredAt: now.toISOString(),
    mode: "manual-test",
    schedule: {
      rules: rules.map(({ interval, seconds, minutes, hours, days, hour }) => ({
        interval,
        value: interval === "Seconds" ? seconds
          : interval === "Minutes" ? minutes
            : interval === "Hours" ? hours
              : days,
        startTime: ["Days", "Hours"].includes(interval) ? hour || null : null,
      })),
    },
  };
}

export async function executeUpstreamLinear({ targetNodeId, nodes, connections, executeNode }) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const visiting = new Set();
  const completed = new Set();

  const visit = async (nodeId, executeSelf = true) => {
    if (visiting.has(nodeId)) throw new Error("Workflow cycle detected. Upstream execution stopped safely.");
    if (completed.has(nodeId)) return nodeMap.get(nodeId)?.output ?? null;
    const node = nodeMap.get(nodeId);
    if (!node) throw new Error(`Connected workflow node ${nodeId} was not found.`);
    visiting.add(nodeId);
    const incoming = connections.filter((connection) => connection.target === nodeId);
    if (incoming.length > 1) throw new Error("Phase 1 supports one incoming connection per node.");
    let input = null;
    if (incoming.length === 1) input = await visit(incoming[0].source, true);
    if (executeSelf) {
      const executed = await executeNode(node, input);
      nodeMap.set(nodeId, executed);
    } else {
      nodeMap.set(nodeId, { ...node, input });
    }
    visiting.delete(nodeId);
    completed.add(nodeId);
    return executeSelf ? nodeMap.get(nodeId)?.output ?? null : input;
  };

  const input = await visit(targetNodeId, false);
  return {
    input,
    nodes: nodes.map((node) => nodeMap.get(node.id) || node),
  };
}
