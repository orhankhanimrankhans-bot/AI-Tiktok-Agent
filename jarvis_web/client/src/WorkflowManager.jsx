import { useEffect, useState } from "react";
import { deleteWorkflow, listWorkflows, MAX_WORKFLOW_NAME_LENGTH, normalizeWorkflowName, updateWorkflow } from "./workflowApi.js";

function formatUpdatedAt(value) {
  if (!value) return "Not updated yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Recently updated" : date.toLocaleString();
}

export default function WorkflowManager({ apiBaseUrl, onClose, selectedWorkflowId, onSelectWorkflow, onNewWorkflow, onWorkflowUpdated, onWorkflowDeleted, activeWorkflowId, runningWorkflowId, onOpenWorkflow, pendingOpenWorkflowId, onCancelOpen, onDiscardAndOpen, openingWorkflowId, refreshKey }) {
  const [workflows, setWorkflows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [renaming, setRenaming] = useState(null);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState("");
  const [renameError, setRenameError] = useState("");
  const [renamingId, setRenamingId] = useState("");
  const [deleting, setDeleting] = useState(null);
  const [deletingId, setDeletingId] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [statusChangingId, setStatusChangingId] = useState("");
  const [statusError, setStatusError] = useState("");

  const load = async () => {
    setLoading(true); setLoadError("");
    try { setWorkflows(await listWorkflows(fetch, apiBaseUrl)); } catch (error) { setLoadError(error.message || "Could not load workflows. Try again."); } finally { setLoading(false); }
  };
  useEffect(() => {
    let cancelled = false;
    listWorkflows(fetch, apiBaseUrl).then((items) => { if (!cancelled) setWorkflows(items); }).catch((error) => { if (!cancelled) setLoadError(error.message || "Could not load workflows. Try again."); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [apiBaseUrl, refreshKey]);

  const selected = workflows.find((workflow) => workflow.id === selectedWorkflowId) || null;
  const startNew = async () => { await onNewWorkflow?.(); };
  const submitRename = async (event) => {
    event.preventDefault();
    const trimmedName = normalizeWorkflowName(name);
    if (!trimmedName) { setNameError("Enter a workflow name."); return; }
    if (trimmedName.length > MAX_WORKFLOW_NAME_LENGTH) { setNameError(`Workflow names must be ${MAX_WORKFLOW_NAME_LENGTH} characters or fewer.`); return; }
    setRenamingId(renaming.id); setNameError(""); setRenameError("");
    try { const updated = await updateWorkflow(fetch, apiBaseUrl, renaming.id, { name: trimmedName }); setWorkflows((items) => items.map((item) => item.id === updated.id ? { ...item, ...updated } : item)); onWorkflowUpdated?.(updated); setName(""); setRenaming(null); }
    catch (error) { setRenameError(error.message || "Could not rename the workflow. Try again."); } finally { setRenamingId(""); }
  };
  const changeStatus = async (workflow) => {
    setStatusChangingId(workflow.id); setStatusError("");
    try { const updated = await updateWorkflow(fetch, apiBaseUrl, workflow.id, { status: workflow.status === "ACTIVE" ? "PAUSED" : "ACTIVE" }); setWorkflows((items) => items.map((item) => item.id === updated.id ? { ...item, ...updated } : item)); onWorkflowUpdated?.(updated); }
    catch (error) { setStatusError(error.message || "Could not update the workflow schedule state."); } finally { setStatusChangingId(""); }
  };
  const confirmDelete = async () => {
    if (!deleting) return;
    setDeletingId(deleting.id); setDeleteError("");
    try { await deleteWorkflow(fetch, apiBaseUrl, deleting.id); setWorkflows((items) => items.filter((item) => item.id !== deleting.id)); onSelectWorkflow(null); onWorkflowDeleted?.(deleting); setDeleting(null); }
    catch (error) { setDeleteError(error.message || "Could not delete the workflow. Try again."); } finally { setDeletingId(""); }
  };

  return <div className="workflow-manager-overlay" role="presentation" onMouseDown={onClose}>
    <aside className="workflow-manager" role="dialog" aria-modal="true" aria-labelledby="workflow-manager-heading" onMouseDown={(event) => event.stopPropagation()}>
      <header className="workflow-manager-header"><div><span>WORKFLOW MANAGER</span><h2 id="workflow-manager-heading">Workflows</h2></div><button type="button" onClick={onClose} aria-label="Close workflows">×</button></header>
      <div className="workflow-manager-toolbar"><button type="button" className="workflow-manager-new" onClick={startNew}>+ New Workflow</button><button type="button" onClick={load} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button></div>
      <div className="workflow-manager-body">
        {loading && <p className="workflow-manager-state" role="status">Loading workflows…</p>}
        {!loading && loadError && <div className="workflow-manager-state workflow-manager-error" role="alert"><p>{loadError}</p><button type="button" onClick={load}>Try again</button></div>}
        {!loading && !loadError && !workflows.length && <p className="workflow-manager-state">No saved workflows yet.</p>}
        {!loading && !loadError && workflows.length > 0 && <div className="workflow-manager-list" aria-label="Saved workflows">{workflows.map((workflow) => <button type="button" key={workflow.id} className={`workflow-manager-row${workflow.id === selectedWorkflowId ? " selected" : ""}${workflow.id === activeWorkflowId ? " open" : ""}${workflow.id === runningWorkflowId ? " running" : ""}`} onClick={() => onSelectWorkflow(workflow.id)}><span className="workflow-manager-row-main"><strong>{workflow.name}</strong><small>Updated {formatUpdatedAt(workflow.updatedAt)}</small>{workflow.id === runningWorkflowId && <small className="workflow-manager-running-indicator"><i />RUNNING</small>}{workflow.id === activeWorkflowId && <small className="workflow-manager-open-label">Open in editor</small>}</span><span className={`workflow-manager-status ${String(workflow.status || "DRAFT").toLowerCase()}`}>{workflow.status || "DRAFT"}</span></button>)}</div>}
      </div>
      {selected && <footer className="workflow-manager-selection"><span>Selected</span><div className="workflow-manager-selection-summary"><strong>{selected.name}</strong><span className={`workflow-manager-status ${String(selected.status || "DRAFT").toLowerCase()}`}>{selected.status || "DRAFT"}</span></div><div className="workflow-manager-selection-actions"><button type="button" className="workflow-manager-new" onClick={() => onOpenWorkflow(selected.id)} disabled={openingWorkflowId === selected.id}>{openingWorkflowId === selected.id ? "Opening…" : "Open Workflow"}</button><button type="button" onClick={() => { setRenaming(selected); setName(selected.name); setNameError(""); setRenameError(""); }}>Rename</button><button type="button" onClick={() => changeStatus(selected)} disabled={statusChangingId === selected.id}>{statusChangingId === selected.id ? "Updating schedule..." : selected.status === "ACTIVE" ? "Pause Schedule" : "Activate Schedule"}</button><button type="button" className="workflow-manager-delete" onClick={() => { setDeleting(selected); setDeleteError(""); }}>Delete Workflow</button></div>{selected.id === activeWorkflowId && <small className="workflow-manager-open-label">Open in editor</small>}{statusError && <p className="workflow-manager-error" role="alert">{statusError}</p>}{pendingOpenWorkflowId === selected.id && <div className="workflow-manager-discard"><p>You have unsaved changes. Open another workflow and discard them?</p><button type="button" onClick={onCancelOpen}>Cancel</button><button type="button" className="workflow-manager-new" onClick={() => onDiscardAndOpen(selected.id)}>Discard and Open</button></div>}<small className="workflow-manager-selection-helper">ACTIVE workflows run saved schedules; DRAFT and PAUSED workflows do not.</small></footer>}
      {renaming && <div className="workflow-manager-confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="rename-workflow-title"><form className="workflow-manager-confirm" onSubmit={submitRename}><h3 id="rename-workflow-title">Rename workflow</h3><label htmlFor="rename-workflow-name">Workflow name</label><input id="rename-workflow-name" autoFocus value={name} maxLength={MAX_WORKFLOW_NAME_LENGTH} onChange={(event) => setName(event.target.value)} />{nameError && <p className="workflow-manager-error" role="alert">{nameError}</p>}{renameError && <p className="workflow-manager-error" role="alert">{renameError}</p>}<div><button type="button" onClick={() => setRenaming(null)}>Cancel</button><button type="submit" className="workflow-manager-new" disabled={renamingId === renaming.id}>{renamingId ? "Renaming..." : "Save Name"}</button></div></form></div>}
      {deleting && <div className="workflow-manager-confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="delete-workflow-title"><div className="workflow-manager-confirm"><h3 id="delete-workflow-title">Delete &quot;{deleting.name}&quot;?</h3><p>This permanently deletes this workflow and its saved configuration. This action cannot be undone.</p>{deleteError && <p className="workflow-manager-error" role="alert">{deleteError}</p>}<div><button type="button" onClick={() => setDeleting(null)}>Cancel</button><button type="button" className="workflow-manager-delete" onClick={confirmDelete} disabled={deletingId === deleting.id}>{deletingId ? "Deleting..." : "Delete Workflow"}</button></div></div></div>}
    </aside>
  </div>;
}
