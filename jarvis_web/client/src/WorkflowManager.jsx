import { useEffect, useState } from "react";
import { createWorkflow, listWorkflows, MAX_WORKFLOW_NAME_LENGTH, normalizeWorkflowName } from "./workflowApi.js";

function formatUpdatedAt(value) {
  if (!value) return "Not updated yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Recently updated" : date.toLocaleString();
}

export default function WorkflowManager({ apiBaseUrl, onClose, selectedWorkflowId, onSelectWorkflow, activeWorkflowId, onOpenWorkflow, pendingOpenWorkflowId, onCancelOpen, onDiscardAndOpen, openingWorkflowId, refreshKey }) {
  const [workflows, setWorkflows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState("");
  const [createError, setCreateError] = useState("");
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true); setLoadError("");
    try { setWorkflows(await listWorkflows(fetch, apiBaseUrl)); } catch (error) { setLoadError(error.message || "Could not load workflows. Try again."); } finally { setLoading(false); }
  };

  useEffect(() => {
    let cancelled = false;
    listWorkflows(fetch, apiBaseUrl)
      .then((items) => { if (!cancelled) setWorkflows(items); })
      .catch((error) => { if (!cancelled) setLoadError(error.message || "Could not load workflows. Try again."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [apiBaseUrl, refreshKey]);

  const submitCreate = async (event) => {
    event.preventDefault();
    const trimmedName = normalizeWorkflowName(name);
    if (!trimmedName) { setNameError("Enter a workflow name."); return; }
    if (trimmedName.length > MAX_WORKFLOW_NAME_LENGTH) { setNameError(`Workflow names must be ${MAX_WORKFLOW_NAME_LENGTH} characters or fewer.`); return; }
    setCreating(true); setNameError(""); setCreateError("");
    try {
      const created = await createWorkflow(fetch, apiBaseUrl, trimmedName);
      setWorkflows((items) => [created, ...items.filter((item) => item.id !== created.id)]);
      onSelectWorkflow(created.id);
      setName(""); setShowCreate(false);
    } catch (error) { setCreateError(error.message || "Could not create the workflow. Try again."); } finally { setCreating(false); }
  };

  const selected = workflows.find((workflow) => workflow.id === selectedWorkflowId) || null;
  return <div className="workflow-manager-overlay" role="presentation" onMouseDown={onClose}>
    <aside className="workflow-manager" role="dialog" aria-modal="true" aria-labelledby="workflow-manager-heading" onMouseDown={(event) => event.stopPropagation()}>
      <header className="workflow-manager-header"><div><span>WORKFLOW MANAGER</span><h2 id="workflow-manager-heading">Workflows</h2></div><button type="button" onClick={onClose} aria-label="Close workflows">×</button></header>
      <div className="workflow-manager-toolbar"><button type="button" className="workflow-manager-new" onClick={() => setShowCreate(true)}>+ New Workflow</button><button type="button" onClick={load} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button></div>
      {showCreate && <form className="workflow-manager-create" onSubmit={submitCreate}><label htmlFor="new-workflow-name">Workflow name</label><input id="new-workflow-name" autoFocus value={name} maxLength={MAX_WORKFLOW_NAME_LENGTH} onChange={(event) => setName(event.target.value)} placeholder="Example: Daily content" />{nameError && <p className="workflow-manager-error" role="alert">{nameError}</p>}{createError && <p className="workflow-manager-error" role="alert">{createError}</p>}<div><button type="button" onClick={() => { setShowCreate(false); setName(""); setNameError(""); setCreateError(""); }}>Cancel</button><button type="submit" className="workflow-manager-new" disabled={creating}>{creating ? "Creating…" : "Create DRAFT"}</button></div></form>}
      {loading && <p className="workflow-manager-state" role="status">Loading workflows…</p>}
      {!loading && loadError && <div className="workflow-manager-state workflow-manager-error" role="alert"><p>{loadError}</p><button type="button" onClick={load}>Try again</button></div>}
      {!loading && !loadError && !workflows.length && <p className="workflow-manager-state">No saved workflows yet.</p>}
      {!loading && !loadError && workflows.length > 0 && <div className="workflow-manager-list" aria-label="Saved workflows">{workflows.map((workflow) => <button type="button" key={workflow.id} className={`workflow-manager-row${workflow.id === selectedWorkflowId ? " selected" : ""}${workflow.id === activeWorkflowId ? " open" : ""}`} onClick={() => onSelectWorkflow(workflow.id)}><span className="workflow-manager-row-main"><strong>{workflow.name}</strong><small>Updated {formatUpdatedAt(workflow.updatedAt)}</small>{workflow.id === activeWorkflowId && <small className="workflow-manager-open-label">Open in editor</small>}</span><span className={`workflow-manager-status ${String(workflow.status || "DRAFT").toLowerCase()}`}>{workflow.status || "DRAFT"}</span></button>)}</div>}
      {selected && <footer className="workflow-manager-selection"><span>Selected in Manager</span><strong>{selected.name}</strong><small>{selected.id}</small>{selected.id === activeWorkflowId && <small className="workflow-manager-open-label">Open in editor</small>}<button type="button" className="workflow-manager-new" onClick={() => onOpenWorkflow(selected.id)} disabled={openingWorkflowId === selected.id}>{openingWorkflowId === selected.id ? "Opening…" : "Open Workflow"}</button>{pendingOpenWorkflowId === selected.id && <div className="workflow-manager-discard"><p>You have unsaved changes. Open another workflow and discard them?</p><button type="button" onClick={onCancelOpen}>Cancel</button><button type="button" className="workflow-manager-new" onClick={() => onDiscardAndOpen(selected.id)}>Discard and Open</button></div>}<p>This selection does not replace the current editor.</p></footer>}
    </aside>
  </div>;
}
