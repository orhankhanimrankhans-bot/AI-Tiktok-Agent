"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const STATUSES = new Set(["DRAFT", "ACTIVE", "PAUSED"]);
const SECRET_KEY = /^(access[_-]?token|refresh[_-]?token|authorization|api[_-]?key|client[_-]?secret|password)$/i;
const ADMIN_OWNER = Object.freeze({ ownerType: "admin", ownerId: "primary" });

class WorkflowStoreError extends Error { constructor(code, message) { super(message); this.code = code; } }

function cloneJson(value, label) {
  try {
    const text = JSON.stringify(value);
    if (text === undefined) throw new Error("not JSON");
    return JSON.parse(text);
  } catch { throw new WorkflowStoreError("INVALID_DEFINITION", `${label} must be JSON-serializable.`); }
}

function rejectSecrets(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) throw new WorkflowStoreError("INVALID_DEFINITION", "Workflow definitions must not contain circular values.");
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) throw new WorkflowStoreError("SECRET_FIELD", "Workflow definitions must not contain credential secrets.");
    rejectSecrets(child, seen);
  }
}

function normalizeDefinition(input, { partial = false } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new WorkflowStoreError("INVALID_DEFINITION", "Workflow definition must be an object.");
  const allowed = new Set(["name", "status", "nodes", "connections", "schedule", "timezone", "lastRunAt", "nextRunAt"]);
  for (const key of Object.keys(input)) {
    if (key === "id" || key === "createdAt") throw new WorkflowStoreError("IMMUTABLE_FIELD", `${key} cannot be updated.`);
    if (!allowed.has(key)) throw new WorkflowStoreError("INVALID_FIELD", `Unsupported workflow field: ${key}.`);
  }
  const result = {};
  if (!partial || Object.hasOwn(input, "name")) {
    if (typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 200) throw new WorkflowStoreError("INVALID_NAME", "Workflow name is required and must be at most 200 characters.");
    result.name = input.name.trim();
  }
  if (!partial || Object.hasOwn(input, "status")) {
    const status = input.status === undefined && !partial ? "DRAFT" : input.status;
    if (!STATUSES.has(status)) throw new WorkflowStoreError("INVALID_STATUS", "Workflow status must be DRAFT, ACTIVE, or PAUSED.");
    result.status = status;
  }
  for (const key of ["nodes", "connections"]) {
    if (!partial || Object.hasOwn(input, key)) {
      if (!Array.isArray(input[key])) throw new WorkflowStoreError("INVALID_DEFINITION", `${key} must be an array.`);
      result[key] = cloneJson(input[key], key);
    }
  }
  if (!partial || Object.hasOwn(input, "schedule")) {
    const schedule = input.schedule === undefined && !partial ? null : input.schedule;
    if (schedule !== null && (typeof schedule !== "object" || Array.isArray(schedule))) throw new WorkflowStoreError("INVALID_DEFINITION", "schedule must be null or an object.");
    result.schedule = schedule === null ? null : cloneJson(schedule, "schedule");
  }
  for (const key of ["timezone", "lastRunAt", "nextRunAt"]) {
    if (Object.hasOwn(input, key)) {
      if (input[key] !== null && (typeof input[key] !== "string" || input[key].length > 255)) throw new WorkflowStoreError("INVALID_DEFINITION", `${key} must be null or a string.`);
      result[key] = input[key];
    } else if (!partial) result[key] = null;
  }
  rejectSecrets(result);
  return result;
}

function parseRow(row) {
  if (!row) return null;
  return { id: row.id, name: row.name, status: row.status, nodes: JSON.parse(row.nodes_json), connections: JSON.parse(row.connections_json), schedule: row.schedule_json ? JSON.parse(row.schedule_json) : null, timezone: row.timezone, createdAt: row.created_at, updatedAt: row.updated_at, lastRunAt: row.last_run_at, nextRunAt: row.next_run_at, version: row.version };
}

function normalizeOwner(owner = ADMIN_OWNER) {
  const ownerType = String(owner?.ownerType || ""); const ownerId = String(owner?.ownerId || "");
  if (!new Set(["admin", "child", "additional"]).has(ownerType) || !/^[A-Za-z0-9_-]{1,255}$/.test(ownerId)) throw new WorkflowStoreError("INVALID_OWNER", "Workflow owner is invalid.");
  return { ownerType, ownerId };
}

function createWorkflowStore({ dbPath = path.join(__dirname, "data", "workflows.sqlite3"), database = null, now = () => new Date().toISOString(), generateId = () => `wf_${crypto.randomUUID().replace(/-/g, "")}` } = {}) {
  const ownsDatabase = !database;
  if (ownsDatabase) fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = database || new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE IF NOT EXISTS workflow_definitions (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL, nodes_json TEXT NOT NULL, connections_json TEXT NOT NULL,
    schedule_json TEXT, timezone TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    last_run_at TEXT, next_run_at TEXT, version INTEGER NOT NULL
  ); CREATE INDEX IF NOT EXISTS idx_workflow_definitions_updated_at ON workflow_definitions(updated_at DESC);`);
  const columns = new Set(db.prepare("PRAGMA table_info(workflow_definitions)").all().map((column) => column.name));
  if (!columns.has("owner_type")) db.exec("ALTER TABLE workflow_definitions ADD COLUMN owner_type TEXT NOT NULL DEFAULT 'admin'");
  if (!columns.has("owner_id")) db.exec("ALTER TABLE workflow_definitions ADD COLUMN owner_id TEXT NOT NULL DEFAULT 'primary'");
  db.exec("CREATE INDEX IF NOT EXISTS idx_workflow_definitions_owner_updated ON workflow_definitions(owner_type, owner_id, updated_at DESC)");
  const getStatement = db.prepare("SELECT * FROM workflow_definitions WHERE id = ? AND owner_type = ? AND owner_id = ?");
  const summaryStatement = db.prepare("SELECT id, name, status, created_at, updated_at, last_run_at, next_run_at, version FROM workflow_definitions WHERE owner_type = ? AND owner_id = ? ORDER BY updated_at DESC, id ASC LIMIT ? OFFSET ?");
  const countStatement = db.prepare("SELECT count(*) AS count FROM workflow_definitions WHERE owner_type = ? AND owner_id = ?");
  const insertStatement = db.prepare("INSERT INTO workflow_definitions (id, name, status, nodes_json, connections_json, schedule_json, timezone, created_at, updated_at, last_run_at, next_run_at, version, owner_type, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const deleteStatement = db.prepare("DELETE FROM workflow_definitions WHERE id = ? AND owner_type = ? AND owner_id = ?");
  let closed = false;
  const assertOpen = () => { if (closed) throw new WorkflowStoreError("STORE_CLOSED", "Workflow store is closed."); };
  const getWorkflow = (id, owner = ADMIN_OWNER) => { assertOpen(); const value = normalizeOwner(owner); return parseRow(getStatement.get(id, value.ownerType, value.ownerId)); };
  return Object.freeze({
    createWorkflow(input, owner = ADMIN_OWNER) { assertOpen(); const value = normalizeDefinition(input); const identity = normalizeOwner(owner); const id = generateId(); if (typeof id !== "string" || !/^wf_[A-Za-z0-9_-]{8,255}$/.test(id)) throw new WorkflowStoreError("INVALID_ID", "Generated workflow ID is invalid."); const timestamp = now(); insertStatement.run(id, value.name, value.status, JSON.stringify(value.nodes), JSON.stringify(value.connections), value.schedule === null ? null : JSON.stringify(value.schedule), value.timezone, timestamp, timestamp, value.lastRunAt, value.nextRunAt, 1, identity.ownerType, identity.ownerId); return getWorkflow(id, identity); },
    getWorkflow,
    listWorkflows({ limit = 100, offset = 0, owner = ADMIN_OWNER } = {}) { assertOpen(); if (!Number.isInteger(limit) || limit < 1 || limit > 1000 || !Number.isInteger(offset) || offset < 0) throw new WorkflowStoreError("INVALID_PAGINATION", "limit and offset are invalid."); const identity = normalizeOwner(owner); return { items: summaryStatement.all(identity.ownerType, identity.ownerId, limit, offset).map((row) => ({ id: row.id, name: row.name, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at, lastRunAt: row.last_run_at, nextRunAt: row.next_run_at, version: row.version })), total: countStatement.get(identity.ownerType, identity.ownerId).count, limit, offset }; },
    updateWorkflow(id, changes, owner = ADMIN_OWNER) { assertOpen(); const identity = normalizeOwner(owner); const current = getWorkflow(id, identity); if (!current) return null; const update = normalizeDefinition(changes, { partial: true }); if (!Object.keys(update).length) throw new WorkflowStoreError("INVALID_DEFINITION", "At least one workflow field must be updated."); const next = { ...current, ...update, updatedAt: now(), version: current.version + 1 }; db.prepare("UPDATE workflow_definitions SET name = ?, status = ?, nodes_json = ?, connections_json = ?, schedule_json = ?, timezone = ?, updated_at = ?, last_run_at = ?, next_run_at = ?, version = ? WHERE id = ? AND owner_type = ? AND owner_id = ?").run(next.name, next.status, JSON.stringify(next.nodes), JSON.stringify(next.connections), next.schedule === null ? null : JSON.stringify(next.schedule), next.timezone, next.updatedAt, next.lastRunAt, next.nextRunAt, next.version, id, identity.ownerType, identity.ownerId); return getWorkflow(id, identity); },
    deleteWorkflow(id, owner = ADMIN_OWNER) { assertOpen(); const identity = normalizeOwner(owner); return deleteStatement.run(id, identity.ownerType, identity.ownerId).changes === 1; },
    close() { if (!closed && ownsDatabase) db.close(); closed = true; },
  });
}

module.exports = { ADMIN_OWNER, createWorkflowStore, normalizeOwner, WorkflowStoreError, STATUSES };
