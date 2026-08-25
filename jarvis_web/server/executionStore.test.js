const assert = require("node:assert/strict");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ExecutionStore, sanitizeRuntimeData } = require("./executionStore");

test("execution history replaces raw binary bytes with metadata", () => {
  assert.deepEqual(sanitizeRuntimeData(Buffer.from("video-bytes")), { binary: true, size: 11 });
  assert.doesNotMatch(JSON.stringify(sanitizeRuntimeData(Buffer.from("video-bytes"))), /video-bytes/);
});

test("execution history persists and strips OAuth data", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-executions-"));
  const dbPath = path.join(directory, "history.sqlite3");
  const db = new DatabaseSync(dbPath);
  const store = new ExecutionStore(db); store.open();
  const saved = store.save({ workflowName: "Test", status: "success", triggerMode: "manual",
    startedAt: "2026-01-01T00:00:00Z", finishedAt: "2026-01-01T00:00:01Z",
    nodes: [{ nodeId: "a", output: { id: 1, access_token: "secret" }, refresh_token: "secret2", error: "Authorization: Bearer exposed-value" }] });
  db.close();
  const reopenedDb = new DatabaseSync(dbPath);
  const reopened = new ExecutionStore(reopenedDb); reopened.open();
  assert.equal(reopened.list()[0].executionId, saved.executionId);
  assert.equal(reopened.get(saved.executionId).nodes[0].output.id, 1);
  assert.doesNotMatch(JSON.stringify(reopened.get(saved.executionId)), /secret|access_token|refresh_token|authorization|exposed-value/i);
  reopenedDb.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test("legacy executions migrate to Admin and history remains workspace-isolated", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-execution-tenancy-")); const dbPath = path.join(directory, "history.sqlite3"); const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE workflow_executions (id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, workflow_name TEXT NOT NULL, status TEXT NOT NULL, trigger_mode TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT NOT NULL, nodes_json TEXT NOT NULL)");
  db.prepare("INSERT INTO workflow_executions VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("exec_1234567890123456789012", "wf_legacy", "Legacy", "success", "manual", "2026-01-01", "2026-01-02", '[]');
  const store = new ExecutionStore(db); store.open(); const admin = { ownerType: "admin", ownerId: "primary" }; const a = { ownerType: "additional", ownerId: "profile_a" }; const b = { ownerType: "additional", ownerId: "profile_b" };
  assert.equal(store.list(50, admin)[0].workflowName, "Legacy"); assert.equal(store.list(50, a).length, 0);
  const saved = store.save({ workflowId: "wf_a", workflowName: "A", status: "success", startedAt: "2026-02-01", finishedAt: "2026-02-02", nodes: [] }, a);
  assert.equal(store.get(saved.executionId, a).workflowName, "A"); assert.equal(store.get(saved.executionId, b), null); assert.equal(store.list(50, b).length, 0);
  db.close(); fs.rmSync(directory, { recursive: true, force: true });
});
