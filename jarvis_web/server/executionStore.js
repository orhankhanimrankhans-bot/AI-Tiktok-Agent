const crypto = require("crypto");

const EXECUTION_ID_PATTERN = /^exec_[A-Za-z0-9_-]{22}$/;
const SECRET_KEYS = /^(access_token|refresh_token|authorization|client_secret|token_ciphertext|token_iv|token_tag|tokens?)$/i;
function normalizeOwner(owner = { ownerType: "admin", ownerId: "primary" }) { const ownerType = String(owner?.ownerType || ""); const ownerId = String(owner?.ownerId || ""); if (!new Set(["admin", "child", "additional"]).has(ownerType) || !/^[A-Za-z0-9_-]{1,255}$/.test(ownerId)) throw new Error("Execution owner is invalid."); return { ownerType, ownerId }; }

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
    const columns = new Set(this.db.prepare("PRAGMA table_info(workflow_executions)").all().map((column) => column.name));
    if (!columns.has("owner_type")) this.db.exec("ALTER TABLE workflow_executions ADD COLUMN owner_type TEXT NOT NULL DEFAULT 'admin'");
    if (!columns.has("owner_id")) this.db.exec("ALTER TABLE workflow_executions ADD COLUMN owner_id TEXT NOT NULL DEFAULT 'primary'");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_workflow_executions_started ON workflow_executions(started_at DESC)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_workflow_executions_owner_started ON workflow_executions(owner_type, owner_id, started_at DESC)");
  }

  save(record, owner) {
    const identity = normalizeOwner(owner);
    const id = ExecutionStore.isValidId(record.executionId) ? record.executionId : ExecutionStore.generateId();
    const safeNodes = sanitizeRuntimeData(record.nodes || []);
    this.db.prepare(`INSERT INTO workflow_executions
      (id, workflow_id, workflow_name, status, trigger_mode, started_at, finished_at, nodes_json, owner_type, owner_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, String(record.workflowId || "local-workflow"), String(record.workflowName || "My Workflow"),
        record.status === "success" ? "success" : "error", String(record.triggerMode || "manual"),
        record.startedAt, record.finishedAt, JSON.stringify(safeNodes), identity.ownerType, identity.ownerId);
    return this.get(id, identity);
  }

  list(limit = 50, owner) {
    const identity = normalizeOwner(owner);
    return this.db.prepare(`SELECT id, workflow_id, workflow_name, status, trigger_mode, started_at, finished_at
      FROM workflow_executions WHERE owner_type = ? AND owner_id = ? ORDER BY started_at DESC LIMIT ?`).all(identity.ownerType, identity.ownerId, Math.min(100, Math.max(1, Number(limit) || 50))).map((row) => ({
      executionId: row.id, workflowId: row.workflow_id, workflowName: row.workflow_name,
      status: row.status, triggerMode: row.trigger_mode, startedAt: row.started_at, finishedAt: row.finished_at,
    }));
  }

  get(id, owner) {
    if (!ExecutionStore.isValidId(id)) return null;
    const identity = normalizeOwner(owner); const row = this.db.prepare("SELECT * FROM workflow_executions WHERE id = ? AND owner_type = ? AND owner_id = ?").get(id, identity.ownerType, identity.ownerId);
    if (!row) return null;
    return { executionId: row.id, workflowId: row.workflow_id, workflowName: row.workflow_name,
      status: row.status, triggerMode: row.trigger_mode, startedAt: row.started_at,
      finishedAt: row.finished_at, nodes: JSON.parse(row.nodes_json) };
  }
}

module.exports = { ExecutionStore, normalizeOwner, sanitizeRuntimeData };
