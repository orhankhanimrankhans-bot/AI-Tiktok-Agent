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
  return <div className="strong-engine" data-engine-state={state}><div className="strong-engine-orb" aria-label="Strong Engine activity orb"><span className="engine-ring engine-ring-one" /><span className="engine-ring engine-ring-two" /><span className="engine-ring engine-ring-three" /><svg viewBox="0 0 160 160" aria-hidden="true"><ellipse className="atom-orbit atom-orbit-one" cx="80" cy="80" rx="58" ry="22" /><ellipse className="atom-orbit atom-orbit-two" cx="80" cy="80" rx="58" ry="22" transform="rotate(60 80 80)" /><ellipse className="atom-orbit atom-orbit-three" cx="80" cy="80" rx="58" ry="22" transform="rotate(120 80 80)" /><circle cx="80" cy="80" r="12" /></svg></div><strong>STRONG ENGINE</strong><small>{state.toUpperCase()}</small><button type="button" disabled title="Engine configuration backend is not available">CONFIGURE</button></div>;
}

function WorkflowNodes({ nodes }) {
  return <div className="pipeline-destination-bay" aria-label="Active workflow nodes"><span className="pipeline-bay-label">WORKFLOW NODES</span><div className="pipeline-module-stack">{nodes.length ? nodes.map((node) => <div className="pipeline-module" key={node.id}><i aria-hidden="true">{String(node.name || "N").slice(0, 2).toUpperCase()}</i><span><strong>{node.name || "Workflow Node"}</strong><small>{node.provider || node.type || "JARVIS"}</small></span></div>) : <div className="pipeline-node-empty">No active nodes</div>}</div></div>;
}

function WorkflowWires({ workflows, nodes }) {
  const count = Math.max(workflows.length, 1);
  const nodeCount = Math.max(nodes.length, 1);
  return <svg className="workflow-wire-layer" viewBox="0 0 1000 520" preserveAspectRatio="none" aria-hidden="true"><defs><filter id="pipeline-wire-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.4" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>{workflows.map((workflow, index) => { const y = count === 1 ? 260 : 55 + (410 * index) / (count - 1); const path = `M225 ${y} C300 ${y} 320 260 400 260`; return <g key={workflow.id} className={`wire-${workflow.dashboardStatus}`}><path className="wire-base" d={path} /><path className="wire-energy" d={path} /><path className="wire-tracer" d={path} /></g>; })}<g className="destination-routes">{nodes.map((node, index) => { const y = nodeCount === 1 ? 260 : 55 + (410 * index) / (nodeCount - 1); const inbound = `M480 260 C545 260 540 ${y} 610 ${y}`; const outbound = `M710 ${y} C770 ${y} 770 260 835 260`; return <g key={node.id}><path className="core-module-wire" d={inbound} /><path className="route-tracer core-module-tracer" d={inbound} /><path className="module-engine-wire" d={outbound} /><path className="route-tracer module-engine-tracer" d={outbound} /></g>; })}</g></svg>;
}

export default function CommandPipeline({ graph, workflows = [], activeWorkflowId = "local-workflow", workflowActive = false, workflowError = false, healthContext = {}, executions = [], onOpenWorkflow }) {
  const healthStates = graph.nodes.map((node) => nodeConnectionHealth(node, healthContext));
  const state = workflowError ? "error" : workflowActive ? "running" : healthStates.includes("error") ? "error" : !graph.nodes.length || healthStates.includes("disconnected") ? "disconnected" : "ready";
  const displayed = workflows.map((workflow) => ({ ...workflow, dashboardStatus: statusForWorkflow(workflow, { activeWorkflowId, workflowActive, workflowError, executions }) }));
  const routedNodes = graph.nodes.filter((node) => node.name !== "Schedule Trigger").slice(0, 6);
  return <section className={`command-pipeline pipeline-${state}`} data-pipeline-state={state} aria-label="Command Pipeline"><header className="command-pipeline-heading"><div><span>LIVE WORKFLOW ROUTING</span><h2>COMMAND PIPELINE</h2></div><small>{state.toUpperCase()}</small></header><div className="pipeline-live-stage"><WorkflowWires workflows={displayed} nodes={routedNodes} /><div className="pipeline-workflow-bay"><span className="pipeline-bay-label">WORKFLOWS</span><div className="pipeline-workflow-stack">{displayed.length ? displayed.map((workflow) => <WorkflowNode key={workflow.id} workflow={workflow} status={workflow.dashboardStatus} onOpen={onOpenWorkflow} />) : <div className="pipeline-empty-copy"><strong>No connected workflow</strong><span>Create or connect a workflow in the editor.</span></div>}</div></div><RoutingCore /><WorkflowNodes nodes={routedNodes} /><StrongEngine state={state} /></div><footer className="pipeline-routing-status"><span className="routing-status-light" />J/Route <b aria-hidden="true">-&gt;</b> <strong>{workflowActive ? "ACTIVE DATA FLOW" : workflowError ? "ATTENTION REQUIRED" : displayed.length ? "STANDBY" : "WAITING"}</strong><span className="pipeline-count-summary">{displayed.length} workflows / {graph.nodes.length} active nodes / {graph.connections.length} connections</span></footer></section>;
}
