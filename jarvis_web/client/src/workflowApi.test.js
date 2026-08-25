import assert from "node:assert/strict";
import test from "node:test";
import { createWorkflow, createWorkflowPayload, getWorkflow, listWorkflows, normalizeWorkflowName, updateWorkflow } from "./workflowApi.js";

function response(body, { ok = true, status = 200 } = {}) { return { ok, status, json: async () => body }; }

test("workflow list requests one bounded summary page and handles 100 workflow summaries", async () => {
  const summaries = Array.from({ length: 100 }, (_, index) => ({ id: `wf_${String(index).padStart(8, "0")}`, name: `Workflow ${index}`, status: index % 3 === 0 ? "DRAFT" : index % 3 === 1 ? "ACTIVE" : "PAUSED", updatedAt: "2026-08-24T10:00:00.000Z" }));
  const calls = [];
  const items = await listWorkflows(async (...args) => { calls.push(args); return response({ workflows: summaries }); }, "https://jarvis.test");
  assert.equal(calls.length, 1); assert.equal(calls[0][0], "https://jarvis.test/api/workflows?limit=100&offset=0"); assert.deepEqual(calls[0][1], { credentials: "include" }); assert.equal(items.length, 100); assert.equal(items[99].name, "Workflow 99");
});

test("workflow creation trims names and posts only the initial DRAFT definition", async () => {
  const calls = [];
  const created = await createWorkflow(async (...args) => { calls.push(args); return response({ id: "wf_abcdefgh", name: "Daily workflow", status: "DRAFT", updatedAt: "2026-08-24T10:00:00.000Z" }); }, "https://jarvis.test", "  Daily workflow  ");
  assert.equal(created.id, "wf_abcdefgh"); assert.equal(calls[0][0], "https://jarvis.test/api/workflows"); assert.equal(calls[0][1].method, "POST"); assert.equal(calls[0][1].credentials, "include"); assert.deepEqual(JSON.parse(calls[0][1].body), { name: "Daily workflow", status: "DRAFT", nodes: [], connections: [], schedule: null, timezone: null });
});
test("private workflow workspace identity stays server-derived for Admin, Child, and Additional sessions", async () => { const calls = []; const visible = [{ id: "wf_private01", name: "My workflow" }]; assert.deepEqual(await listWorkflows(async (...args) => { calls.push(args); return response({ workflows: visible }); }, "https://jarvis.test"), visible); await createWorkflow(async (...args) => { calls.push(args); return response({ id: "wf_private02", name: "New" }); }, "https://jarvis.test", "New"); assert.equal(calls.every(([, options]) => options.credentials === "include"), true); assert.doesNotMatch(calls.map(([url]) => url).join(" "), /owner|profile|admin|child/i); assert.equal(Object.keys(JSON.parse(calls[1][1].body)).some((key) => /owner|profile/i.test(key)), false); });

test("workflow create validation and safe API errors do not expose response details", async () => {
  assert.equal(normalizeWorkflowName("  Name  "), "Name"); assert.throws(() => createWorkflowPayload("   "), /Enter a workflow name/); assert.throws(() => createWorkflowPayload("x".repeat(201)), /200 characters/);
  await assert.rejects(() => listWorkflows(async () => response({ error: "C:\\private\\workflows.sqlite3" }, { ok: false, status: 500 }), ""), (error) => error.message === "Could not load workflows. Try again.");
  await assert.rejects(() => createWorkflow(async () => response({ error: "token-value" }, { ok: false, status: 403 }), "", "Name"), (error) => error.message === "You do not have permission to manage workflows.");
});

test("workflow detail GET and definition-only PATCH use the selected opaque workflow ID", async () => {
  const calls = [];
  await getWorkflow(async (...args) => { calls.push(args); return response({ id: "wf_abcdefgh", nodes: [], connections: [] }); }, "https://jarvis.test", "wf_abcdefgh");
  await updateWorkflow(async (...args) => { calls.push(args); return response({ id: "wf_abcdefgh", name: "Stored", status: "DRAFT", version: 2, nodes: [], connections: [] }); }, "https://jarvis.test", "wf_abcdefgh", { nodes: [{ id: "node" }], connections: [] });
  assert.equal(calls[0][0], "https://jarvis.test/api/workflows/wf_abcdefgh"); assert.equal(calls[0][1].credentials, "include"); assert.equal(calls[1][0], "https://jarvis.test/api/workflows/wf_abcdefgh"); assert.equal(calls[1][1].method, "PATCH"); assert.deepEqual(JSON.parse(calls[1][1].body), { nodes: [{ id: "node" }], connections: [] });
});
