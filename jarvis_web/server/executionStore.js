const crypto = require("crypto");

const EXECUTION_ID_PATTERN = /^exec_[A-Za-z0-9_-]{22}$/;
const SECRET_KEYS = /^(access_token|refresh_token|authorization|client_secret|token_ciphertext|token_iv|token_tag|tokens?)$/i;

function sanitizeRuntimeData(value, depth = 0) {
  if (depth > 8) return "[TRUNCATED]";
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) return { binary: true, size: value.byteLength };
  if (typeof value === "string") {
    return value
      .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "[REDACTED]")
      .replace(/(access_token|refresh_token|authorization|client_secret)\s*[:=]\s*[^\s,;}]+/gi, "[REDACTED]")
      .slice(0, 2000);
  }
  if (Array.isArray(value)) return value.slice(0, 1000).map((item) => sanitizeRuntimeData(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !SECRET_KEYS.test(key))
      .map(([key, child]) => [key, sanitizeRuntimeData(child, depth + 1)]));
  }
  return value;
}

class ExecutionStore {
  constructor(db) {
    this.db = db;
  }

  static generateId() {
    return `exec_${crypto.randomBytes(16).toString("base64url")}`;
  }

  static isValidId(id) {
    return typeof id === "string" && EXECUTION_ID_PATTERN.test(id);
  }

  open() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_executions (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        workflow_name TEXT NOT NULL,
        status TEXT NOT NULL,
        trigger_mode TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT NOT NULL,
        nodes_json TEXT NOT NULL
      )
    `);
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_workflow_executions_started ON workflow_executions(started_at DESC)");
  }

  save(record) {
    const id = ExecutionStore.isValidId(record.executionId) ? record.executionId : ExecutionStore.generateId();
    const safeNodes = sanitizeRuntimeData(record.nodes || []);
    this.db.prepare(`INSERT INTO workflow_executions
      (id, workflow_id, workflow_name, status, trigger_mode, started_at, finished_at, nodes_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, String(record.workflowId || "local-workflow"), String(record.workflowName || "My Workflow"),
        record.status === "success" ? "success" : "error", String(record.triggerMode || "manual"),
        record.startedAt, record.finishedAt, JSON.stringify(safeNodes));
    return this.get(id);
  }

  list(limit = 50) {
    return this.db.prepare(`SELECT id, workflow_id, workflow_name, status, trigger_mode, started_at, finished_at
      FROM workflow_executions ORDER BY started_at DESC LIMIT ?`).all(Math.min(100, Math.max(1, Number(limit) || 50))).map((row) => ({
      executionId: row.id, workflowId: row.workflow_id, workflowName: row.workflow_name,
      status: row.status, triggerMode: row.trigger_mode, startedAt: row.started_at, finishedAt: row.finished_at,
    }));
  }

  get(id) {
    if (!ExecutionStore.isValidId(id)) return null;
    const row = this.db.prepare("SELECT * FROM workflow_executions WHERE id = ?").get(id);
    if (!row) return null;
    return { executionId: row.id, workflowId: row.workflow_id, workflowName: row.workflow_name,
      status: row.status, triggerMode: row.trigger_mode, startedAt: row.started_at,
      finishedAt: row.finished_at, nodes: JSON.parse(row.nodes_json) };
  }
}

module.exports = { ExecutionStore, sanitizeRuntimeData };
