const assert = require("node:assert/strict");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ExecutionStore } = require("./executionStore");

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
