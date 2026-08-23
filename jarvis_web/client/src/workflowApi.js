const MAX_WORKFLOW_NAME_LENGTH = 200;

function safeRequestError(response, action) {
  if (response.status === 401 || response.status === 403) return new Error("You do not have permission to manage workflows.");
  if (response.status === 400) return new Error("Check the workflow name and try again.");
  return new Error(`Could not ${action}. Try again.`);
}

async function readJson(response, action) {
  if (!response.ok) throw safeRequestError(response, action);
  return response.json();
}

export function normalizeWorkflowName(name) {
  return typeof name === "string" ? name.trim() : "";
}

export function createWorkflowPayload(name) {
  const normalizedName = normalizeWorkflowName(name);
  if (!normalizedName) throw new Error("Enter a workflow name.");
  if (normalizedName.length > MAX_WORKFLOW_NAME_LENGTH) throw new Error(`Workflow names must be ${MAX_WORKFLOW_NAME_LENGTH} characters or fewer.`);
  return { name: normalizedName, status: "DRAFT", nodes: [], connections: [], schedule: null, timezone: null };
}

export async function listWorkflows(fetchImpl, apiBaseUrl) {
  const response = await fetchImpl(`${apiBaseUrl}/api/workflows?limit=100&offset=0`, { credentials: "include" });
  const data = await readJson(response, "load workflows");
  return Array.isArray(data?.workflows) ? data.workflows : [];
}

export async function createWorkflow(fetchImpl, apiBaseUrl, name) {
  const response = await fetchImpl(`${apiBaseUrl}/api/workflows`, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(createWorkflowPayload(name)),
  });
  return readJson(response, "create the workflow");
}

export async function getWorkflow(fetchImpl, apiBaseUrl, workflowId) {
  const response = await fetchImpl(`${apiBaseUrl}/api/workflows/${encodeURIComponent(workflowId)}`, { credentials: "include" });
  return readJson(response, "load the workflow");
}

export async function updateWorkflow(fetchImpl, apiBaseUrl, workflowId, changes) {
  const response = await fetchImpl(`${apiBaseUrl}/api/workflows/${encodeURIComponent(workflowId)}`, {
    method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes),
  });
  return readJson(response, "update the workflow");
}

export async function deleteWorkflow(fetchImpl, apiBaseUrl, workflowId) {
  const response = await fetchImpl(`${apiBaseUrl}/api/workflows/${encodeURIComponent(workflowId)}`, { method: "DELETE", credentials: "include" });
  return readJson(response, "delete the workflow");
}

export { MAX_WORKFLOW_NAME_LENGTH };
