import { nodeConnectionHealth } from "./workflowCanvas.js";

function statusForWorkflow(workflow, { activeWorkflowId, workflowActive, workflowError, executions }) {
  if (workflow.id === activeWorkflowId && workflowActive) return "running";
  if (workflow.id === activeWorkflowId && workflowError) return "error";
  const execution = executions.find((item) => item.workflowId === workflow.id);
  if (execution?.status === "error") return "error";
  if (workflow.status === "DISABLED") return "offline";
  return "ready";
}

function WorkflowNode({ workflow, status, onOpen }) {
  const label = { running: "RUNNING", ready: "READY", error: "ERROR", offline: "OFFLINE" }[status];
  return <button type="button" className={`pipeline-workflow workflow-${status}`} onClick={() => onOpen?.(workflow.id)} title={workflow.error || `Open ${workflow.name} in Workflow Editor`}>
    <span className="workflow-node-led" /><span className="workflow-node-copy"><strong>{workflow.name}</strong><small>{label}{workflow.updatedAt ? ` / ${new Date(workflow.updatedAt).toLocaleDateString()}` : ""}</small></span>
  </button>;
}

function RoutingCore() {
  return <div className="pipeline-routing-core" aria-label="Central J Route core"><span className="pipeline-core-ring core-ring-outer" /><span className="pipeline-core-ring core-ring-middle" /><span className="pipeline-core-ring core-ring-inner" /><div className="pipeline-core-orb"><span>J</span><small>ROUTE</small></div></div>;
}

function StrongEngine({ state }) {
  return <div className="strong-engine" data-engine-state={state}><div className="strong-engine-orb" aria-label="Strong Engine activity orb"><span className="engine-ring engine-ring-one" /><span className="engine-ring engine-ring-two" /><span className="engine-ring engine-ring-three" /><svg viewBox="0 0 160 160" aria-hidden="true"><ellipse cx="80" cy="80" rx="58" ry="22" /><ellipse cx="80" cy="80" rx="58" ry="22" transform="rotate(60 80 80)" /><ellipse cx="80" cy="80" rx="58" ry="22" transform="rotate(120 80 80)" /><circle cx="80" cy="80" r="12" /></svg></div><strong>STRONG ENGINE</strong><small>{state.toUpperCase()}</small><button type="button" disabled title="Engine configuration backend is not available">CONFIGURE</button></div>;
}

function WorkflowWires({ workflows }) {
  const count = Math.max(workflows.length, 1);
  return <svg className="workflow-wire-layer" viewBox="0 0 1000 520" preserveAspectRatio="none" aria-hidden="true">{workflows.map((workflow, index) => { const y = count === 1 ? 260 : 55 + (410 * index) / (count - 1); return <g key={workflow.id} className={`wire-${workflow.dashboardStatus}`}><path className="wire-base" d={`M120 ${y} C330 ${y} 310 260 495 260`} /><path className="wire-energy" d={`M120 ${y} C330 ${y} 310 260 495 260`} /></g>; })}<path className="core-engine-wire" d="M570 260 C700 260 715 260 865 260" /></svg>;
}

export default function CommandPipeline({ graph, workflows = [], activeWorkflowId = "local-workflow", workflowActive = false, workflowError = false, healthContext = {}, executions = [], onOpenWorkflow }) {
  const healthStates = graph.nodes.map((node) => nodeConnectionHealth(node, healthContext));
  const state = workflowError ? "error" : workflowActive ? "running" : healthStates.includes("error") ? "error" : !graph.nodes.length || healthStates.includes("disconnected") ? "disconnected" : "ready";
  const displayed = workflows.map((workflow) => ({ ...workflow, dashboardStatus: statusForWorkflow(workflow, { activeWorkflowId, workflowActive, workflowError, executions }) }));
  return <section className={`command-pipeline pipeline-${state}`} data-pipeline-state={state} aria-label="Command Pipeline"><header className="command-pipeline-heading"><div><span>LIVE WORKFLOW ROUTING</span><h2>COMMAND PIPELINE</h2></div><small>{state.toUpperCase()}</small></header><div className="pipeline-live-stage"><WorkflowWires workflows={displayed} /><div className="pipeline-workflow-stack">{displayed.length ? displayed.map((workflow) => <WorkflowNode key={workflow.id} workflow={workflow} status={workflow.dashboardStatus} onOpen={onOpenWorkflow} />) : <div className="pipeline-empty-copy"><strong>No connected workflow</strong><span>Create or connect a workflow in the editor.</span></div>}</div><RoutingCore /><StrongEngine state={state} /></div><footer className="pipeline-routing-status"><span className="routing-status-light" />J/Route <b aria-hidden="true">-&gt;</b> <strong>{workflowActive ? "ACTIVE DATA FLOW" : workflowError ? "ATTENTION REQUIRED" : displayed.length ? "STANDBY" : "WAITING"}</strong><span className="pipeline-count-summary">{displayed.length} workflows / {graph.nodes.length} active nodes / {graph.connections.length} connections</span></footer></section>;
}
