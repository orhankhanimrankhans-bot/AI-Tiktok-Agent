"use strict";

const { WorkflowStoreError } = require("./workflowStore");

const WORKFLOW_ID = /^wf_[A-Za-z0-9_-]{8,255}$/;
const CREATE_FIELDS = new Set(["name", "status", "nodes", "connections", "schedule", "timezone"]);
const UPDATE_FIELDS = new Set(CREATE_FIELDS);

function publicFields(body, fields, { required = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new WorkflowStoreError("INVALID_DEFINITION", "Provide a valid workflow definition.");
  for (const key of Object.keys(body)) if (!fields.has(key)) throw new WorkflowStoreError("INVALID_FIELD", "Workflow request contains an unsupported field.");
  if (required && (!Object.hasOwn(body, "name") || !Object.hasOwn(body, "nodes") || !Object.hasOwn(body, "connections"))) throw new WorkflowStoreError("INVALID_DEFINITION", "Workflow name, nodes, and connections are required.");
  if (!required && !Object.keys(body).length) throw new WorkflowStoreError("INVALID_DEFINITION", "Provide at least one workflow field to update.");
  return body;
}

function validId(id) { return typeof id === "string" && WORKFLOW_ID.test(id); }
function canExecuteWorkflow(workflowStore, workflowId, owner) { return workflowId === "local-workflow" || validId(workflowId) && Boolean(workflowStore.getWorkflow(workflowId, owner)); }
function pagination(query) {
  const parse = (value, fallback, maximum) => { if (value === undefined) return fallback; if (typeof value !== "string" || !/^\d+$/.test(value)) throw new WorkflowStoreError("INVALID_PAGINATION", "limit and offset must be valid integers."); const number = Number(value); if (!Number.isSafeInteger(number) || number < 0 || number > maximum || (maximum === 100 && number < 1)) throw new WorkflowStoreError("INVALID_PAGINATION", "limit or offset is outside the allowed range."); return number; };
  return { limit: parse(query.limit, 50, 100), offset: parse(query.offset, 0, 100000) };
}
function safeError(res, error, logger) {
  if (error instanceof WorkflowStoreError) return res.status(400).json({ error: error.code === "INVALID_STATUS" ? "Workflow status is invalid." : "Workflow request is invalid." });
  logger?.error?.("Workflow CRUD operation failed safely.");
  return res.status(500).json({ error: "Workflow operation could not be completed." });
}

function registerWorkflowRoutes(app, { workflowStore, workspaceForRequest = () => ({ ownerType: "admin", ownerId: "primary" }), logger = console }) {
  if (!workflowStore) throw new Error("workflowStore is required.");
  const workspace = (req, res) => { const value = workspaceForRequest(req); if (!value) { res.status(401).json({ error: "Authentication is required." }); return null; } return value; };
  app.post("/api/workflows", (req, res) => { const owner = workspace(req, res); if (!owner) return; try { return res.status(201).json(workflowStore.createWorkflow(publicFields(req.body, CREATE_FIELDS, { required: true }), owner)); } catch (error) { return safeError(res, error, logger); } });
  app.get("/api/workflows", (req, res) => { const owner = workspace(req, res); if (!owner) return; try { const page = workflowStore.listWorkflows({ ...pagination(req.query), owner }); return res.json({ workflows: page.items, total: page.total, limit: page.limit, offset: page.offset }); } catch (error) { return safeError(res, error, logger); } });
  app.get("/api/workflows/:workflowId", (req, res) => { if (!validId(req.params.workflowId)) return res.status(400).json({ error: "Workflow ID is invalid." }); const owner = workspace(req, res); if (!owner) return; try { const workflow = workflowStore.getWorkflow(req.params.workflowId, owner); return workflow ? res.json(workflow) : res.status(404).json({ error: "Workflow not found." }); } catch (error) { return safeError(res, error, logger); } });
  app.patch("/api/workflows/:workflowId", (req, res) => { if (!validId(req.params.workflowId)) return res.status(400).json({ error: "Workflow ID is invalid." }); const owner = workspace(req, res); if (!owner) return; try { const workflow = workflowStore.updateWorkflow(req.params.workflowId, publicFields(req.body, UPDATE_FIELDS), owner); return workflow ? res.json(workflow) : res.status(404).json({ error: "Workflow not found." }); } catch (error) { return safeError(res, error, logger); } });
  app.delete("/api/workflows/:workflowId", (req, res) => { if (!validId(req.params.workflowId)) return res.status(400).json({ error: "Workflow ID is invalid." }); const owner = workspace(req, res); if (!owner) return; try { return workflowStore.deleteWorkflow(req.params.workflowId, owner) ? res.json({ ok: true, id: req.params.workflowId }) : res.status(404).json({ error: "Workflow not found." }); } catch (error) { return safeError(res, error, logger); } });
}

module.exports = { canExecuteWorkflow, registerWorkflowRoutes };
