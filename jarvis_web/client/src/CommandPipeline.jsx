import { dashboardNodeState, dashboardRoutingStatus } from "./dashboardPipeline.js";
import { nodeConnectionHealth } from "./workflowCanvas.js";

function PipelineNodeIcon({ node }) {
  if (node.name === "Schedule Trigger") return <svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="10" /><path d="M16 9v7l5 3" /></svg>;
  if (node.provider === "Google Drive" || /Files|File/.test(node.name || "")) return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M12 4h8l9 16-4 7H7l-4-7L12 4Z" /><path d="m12 4 9 16M20 4 11 20M3 20h26" /></svg>;
  if (node.name === "Facebook Graph API") return <b aria-hidden="true">f</b>;
  if (node.name === "Prepare Content" || node.name === "Prepare Content / AI") return <b aria-hidden="true">AI</b>;
  if (node.name === "Limit") return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M6 9h20M6 16h15M6 23h10" /></svg>;
  return <b aria-hidden="true">{String(node.name || "N").slice(0, 1).toUpperCase()}</b>;
}

function WorkflowNodeCard({ node, workflowActive, healthContext }) {
  const executionState = dashboardNodeState(node, workflowActive);
  const health = nodeConnectionHealth(node, healthContext);
  return <article className={`pipeline-workflow-node node-${executionState}`} data-node-id={node.id} data-execution-state={executionState}>
    <i className="pipeline-node-icon"><PipelineNodeIcon node={node} /></i>
    <div><strong>{node.name}</strong><small>{node.provider || node.type || "Jarvis"}</small></div>
    <span className={`pipeline-health health-${health}`} title={`Connection: ${health}`} />
  </article>;
}

function BranchLines({ branchCount }) {
  const count = Math.max(1, branchCount);
  return <svg className="pipeline-graph-lines" viewBox="0 0 1000 500" preserveAspectRatio="none" aria-hidden="true">
    <path className="trigger-core-line" d="M120 250 C225 250 250 250 380 250" />
    {Array.from({ length: count }, (_, index) => {
      const y = count === 1 ? 250 : 55 + (390 * index) / Math.max(1, count - 1);
      return <path key={index} className="core-branch-line" d={`M485 250 C570 250 560 ${y} 670 ${y}`} />;
    })}
  </svg>;
}

function RoutingCore() {
  return <div className="pipeline-routing-core" aria-label="Central routing core">
    <span className="pipeline-core-ring core-ring-outer" /><span className="pipeline-core-ring core-ring-middle" /><span className="pipeline-core-ring core-ring-inner" />
    <span className="pipeline-core-axis axis-one" /><span className="pipeline-core-axis axis-two" />
    <div className="pipeline-core-orb"><span>J</span><small>ROUTE</small></div>
  </div>;
}

function StrongEngine() {
  return <div className="strong-engine">
    <div className="strong-engine-orb" aria-label="Strong Engine">
      <span className="engine-ring engine-ring-one" /><span className="engine-ring engine-ring-two" /><span className="engine-ring engine-ring-three" />
      <svg viewBox="0 0 160 160" aria-hidden="true"><ellipse cx="80" cy="80" rx="58" ry="22" /><ellipse cx="80" cy="80" rx="58" ry="22" transform="rotate(60 80 80)" />
        <ellipse cx="80" cy="80" rx="58" ry="22" transform="rotate(120 80 80)" /><circle cx="80" cy="80" r="12" /></svg>
    </div>
    <strong>STRONG ENGINE</strong><button type="button" title="Engine configuration is not available yet">CONFIGURE</button>
  </div>;
}

export default function CommandPipeline({ graph, workflowActive = false, workflowError = false, healthContext = {} }) {
  const state = workflowActive ? "running" : workflowError ? "error" : "idle";
  const routingStatus = dashboardRoutingStatus(graph, workflowActive, workflowError);
  return <section className={`command-pipeline pipeline-${state}`} data-pipeline-state={state} aria-label="Command Pipeline">
    <header className="command-pipeline-heading"><div><span>LIVE WORKFLOW ROUTING</span><h2>COMMAND PIPELINE</h2></div><small>{state.toUpperCase()}</small></header>
    {graph.nodes.length ? <div className="command-pipeline-body actual-workflow-pipeline">
      <div className="pipeline-graph-stage">
        <BranchLines branchCount={graph.branches.length} />
        <div className="pipeline-trigger-column">{graph.trigger && <WorkflowNodeCard node={graph.trigger} workflowActive={workflowActive} healthContext={healthContext} />}</div>
        <RoutingCore />
        <div className={`pipeline-branches branch-count-${Math.min(graph.branches.length, 9)}`}>
          {graph.branches.map((branch, index) => <div className="pipeline-branch" key={branch.branchId} data-branch-id={branch.branchId}>
            {graph.branches.length > 1 && <span className="pipeline-branch-label">BRANCH {index + 1}</span>}
            <div className="pipeline-branch-nodes">{branch.nodes.map((node) => <WorkflowNodeCard key={node.id} node={node} workflowActive={workflowActive} healthContext={healthContext} />)}</div>
          </div>)}
        </div>
      </div>
      <StrongEngine />
    </div> : <div className="pipeline-empty-state"><RoutingCore /><strong>No connected workflow</strong><span>Connect nodes in the Workflow Editor to visualize routing.</span><StrongEngine /></div>}
    <footer className="pipeline-routing-status"><span className="routing-status-light" />Routing <b aria-hidden="true">-&gt;</b> <strong>{routingStatus}</strong>
      <span className="pipeline-count-summary">{graph.nodes.length} nodes · {graph.connections.length} connections · {graph.branches.length} branches</span></footer>
  </section>;
}
