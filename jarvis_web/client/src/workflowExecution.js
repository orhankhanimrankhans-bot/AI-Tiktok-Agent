export const NODE_STATUSES = ["idle", "running", "success", "error"];

const STRUCTURED_EXECUTION_ERROR = Symbol("structuredExecutionError");
const DIAGNOSTIC_KEYS = ["stage", "reasonCode", "metaCode", "metaSubcode", "httpStatus", "responseKind", "phaseStatus", "publishStatus", "copyrightStatus", "reason", "isTransient", "traceId"];
const UPLOAD_RESPONSE_KINDS = new Set(["graph_error", "success_false", "missing_success", "empty", "non_json"]);

function safeCode(value, limit = 64) {
  if (Number.isSafeInteger(value)) return value;
  if (typeof value !== "string") return undefined;
  const text = value.trim(); return text && text.length <= limit && /^[A-Za-z0-9_.-]+$/.test(text) ? text : undefined;
}

function safeDiagnosticText(value, limit) {
  if (typeof value !== "string") return undefined;
  const text = value.trim().slice(0, limit)
    .replace(/access_token=[^&\s]+/gi, "access_token=[REDACTED]")
    .replace(/(?:Bearer|OAuth)\s+[^\s]+/gi, "Authorization [REDACTED]")
    .replace(/(?:sk-|ya29\.|EAA)[A-Za-z0-9._-]{8,}/g, "[REDACTED]")
    .replace(/https?:\/\/[^\s]+/gi, "[REDACTED_URL]")
    .replace(/[A-Za-z]:\\[^\r\n]*/g, "[REDACTED_PATH]")
    .replace(/\/(?:home|Users|tmp)\/[^\s]*/g, "[REDACTED_PATH]");
  return text || undefined;
}

export function sanitizeExecutionDiagnostic(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const diagnostic = {};
  for (const key of DIAGNOSTIC_KEYS) {
    const item = value[key];
    if (["metaCode", "metaSubcode"].includes(key)) {
      const code = safeCode(item, 32); if (code !== undefined) diagnostic[key] = code;
    } else if (key === "httpStatus") {
      if (Number.isInteger(item) && item >= 100 && item <= 599) diagnostic[key] = item;
    } else if (key === "responseKind") {
      if (UPLOAD_RESPONSE_KINDS.has(item)) diagnostic[key] = item;
    } else if (key === "isTransient") {
      if (typeof item === "boolean") diagnostic[key] = item;
    } else if (key === "traceId") {
      const traceId = safeCode(item, 128); if (traceId !== undefined) diagnostic[key] = traceId;
    } else {
      const text = safeDiagnosticText(item, key === "reason" ? 240 : 64); if (text) diagnostic[key] = text;
    }
  }
  return Object.keys(diagnostic).length ? diagnostic : undefined;
}

export function createStructuredExecutionError({ message, code, diagnostic } = {}) {
  const safeMessage = safeDiagnosticText(message, 600) || "Operation failed.";
  const output = { status: "error", message: safeMessage };
  const safeErrorCode = safeCode(code); if (typeof safeErrorCode === "string") output.code = safeErrorCode;
  const safeDiagnostic = sanitizeExecutionDiagnostic(diagnostic); if (safeDiagnostic) output.diagnostic = safeDiagnostic;
  const error = new Error(safeMessage);
  Object.defineProperty(error, STRUCTURED_EXECUTION_ERROR, { value: output });
  return error;
}

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
  const structured = error instanceof Error ? error[STRUCTURED_EXECUTION_ERROR] : null;
  return {
    ...node,
    status: "error",
    output: structured ? { ...structured } : { status: "error", message },
    error: message,
    executionFinishedAt: now.toISOString(),
  };
}

export function upstreamInputError(error) {
  return {
    status: "error",
    message: error?.message || "Upstream execution failed.",
  };
}

export function applyManualNodeResult(nodes, connections, updatedNode) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node.id === updatedNode.id ? updatedNode : node]));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  for (const connection of connections) if (outgoing.has(connection.source)) outgoing.get(connection.source).push(connection.target);
  const queue = (outgoing.get(updatedNode.id) || []).map((nodeId) => ({ nodeId, input: updatedNode.output ?? null }));
  const invalidated = new Set();
  while (queue.length) {
    const { nodeId, input } = queue.shift();
    if (invalidated.has(nodeId) || !nodeMap.has(nodeId)) continue;
    invalidated.add(nodeId);
    const node = nodeMap.get(nodeId);
    nodeMap.set(nodeId, { ...node, input, output: null, error: null, status: "idle",
      executionStartedAt: null, executionFinishedAt: null });
    for (const nextId of outgoing.get(nodeId) || []) queue.push({ nodeId: nextId, input: null });
  }
  return nodes.map((node) => nodeMap.get(node.id));
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
  const targetIncoming = connections.filter((connection) => connection.target === targetNodeId);

  if (targetIncoming.length === 0) {
    throw new Error("No upstream node is connected.");
  }

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
      if (executed?.status === "error") {
        const error = new Error(executed.error || executed.output?.message || `Upstream node ${node.name || node.id} failed.`);
        error.updatedNodes = nodes.map((item) => nodeMap.get(item.id) || item);
        throw error;
      }
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
