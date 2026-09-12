import { useEffect, useMemo, useRef, useState } from "react";
import OfficeSimulation from "./OfficeSimulation.jsx";
import { handoffIntent } from "./officeMovement.js";
import { listWorkflows } from "./workflowApi.js";
import { facebookPerformanceScore, getFacebookControl } from "./facebookControlApi.js";
import { controlCenterState, dashboardFacts } from "./dashboardControlCenter.js";
import { nodeConnectionHealth } from "./workflowCanvas.js";

const CONTROLS = [["upload", "UP", "UPLOAD QUEUE"], ["workflow", "WF", "WORKFLOW CONTROL"], ["facebook", "f", "FACEBOOK"], ["youtube", "YT", "YOUTUBE"], ["storage", "ST", "STORAGE & MEDIA"]];
const AGENT_NAMES = { nova: "NOVA", pulse: "PULSE", orbit: "ORBIT", atlas: "ATLAS", link: "LINK", amazon: "AMAZON OPERATIONS" };
const MEMBERS = [{ id: "imran", name: "Imran", role: "Main Access" }, { id: "sulaiman", name: "Sulaiman", role: "Team Workspace" }, { id: "kazim", name: "Kazim", role: "Team Workspace" }];

function OperationalDetail({ detail, facts, state, onClose }) {
  const content = {
    upload: ["Upload Queue", facts.queuedItems.length ? `${facts.queuedItems.length} real items found in current Search output.` : "No queued media is available in current workflow output."],
    workflow: ["Workflow Control", `${facts.workflowCount} workflows visible. ${facts.nodeCount} nodes and ${facts.connectionCount} connections in the open workflow. State: ${state}.`],
    facebook: ["Facebook", facts.facebookCredentials.length ? `${facts.facebookCredentials.length} connected credential record(s).` : "NOT CONNECTED"],
    youtube: ["YouTube", "NOT CONNECTED - no YouTube connector is configured."], storage: ["Storage & Media", facts.googleCredentials.length ? `${facts.googleCredentials.length} Google Drive credential record(s) available.` : "NOT CONNECTED"],
    whatsapp: ["WhatsApp", "NOT CONNECTED - no WhatsApp connector is available in this dashboard."], tiktok: ["TikTok", "NOT CONNECTED - no TikTok analytics connector is available in this dashboard."],
  }[detail];
  if (!content) return null;
  return <div className="control-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="control-detail-drawer" role="dialog" aria-modal="true" aria-labelledby="control-detail-title"><header><div><span>CONTROL MODULE</span><h2 id="control-detail-title">{content[0]}</h2></div><button type="button" onClick={onClose} aria-label="Close detail panel">X</button></header><p>{content[1]}</p></aside></div>;
}

function ConversationPanel({ inputRef, messages, draft, onDraft, onSend }) {
  return <aside className="jarvis-conversation" aria-label="Corex Conversation"><header><div><span>SECURE LOCAL SESSION</span><h2>COREX CONVERSATION</h2></div><i aria-label="Text chat ready" /></header><div className="conversation-thread" aria-live="polite">{messages.length ? messages.map((message) => <article key={message.id} className={`conversation-message ${message.role}`}><strong>{message.role === "user" ? "USER" : "COREX"}</strong><p>{message.text}</p></article>) : <div className="conversation-empty"><b>WAITING FOR INPUT</b><span>Ask about workflows, storage, Facebook, WhatsApp, YouTube, TikTok, or system status.</span></div>}</div><form className="conversation-input" onSubmit={onSend}><button type="button" className="conversation-mic" disabled title="Voice transcription is not configured" aria-label="Microphone unavailable">MIC</button><input ref={inputRef} value={draft} onChange={(event) => onDraft(event.target.value)} placeholder="Type a command..." aria-label="Type a command" /><button type="submit" disabled={!draft.trim()}>SEND</button></form></aside>;
}



function WorkflowStatusModal({ title, workflows, tone, onClose, onOpenWorkflow }) {
  return <div className="workflow-status-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className={`workflow-status-modal ${tone}`} role="dialog" aria-modal="true" aria-label={title}><header><div><span>WORKFLOW STATUS</span><h2>{title}</h2></div><button type="button" onClick={onClose} aria-label="Close workflow status">X</button></header>{workflows.length ? <div className="workflow-status-list">{workflows.map((workflow) => <button type="button" key={workflow.id} onClick={() => { onClose(); onOpenWorkflow?.(workflow.id); }}><i /><strong>{workflow.name}</strong><span>{workflow.status}</span><small>{workflow.lastRunAt ? `Last run: ${new Date(workflow.lastRunAt).toLocaleString()}` : workflow.updatedAt ? `Updated: ${new Date(workflow.updatedAt).toLocaleString()}` : "No activity yet"}</small></button>)}</div> : <p className="workflow-status-empty">No workflows in this group.</p>}</aside></div>;
}

function CorexLiveEngine({ activeWorkflows, inactiveWorkflows, facts, facebookPageCount }) {
  const pipelines = [
    ["WORKFLOWS", activeWorkflows.length ? "healthy" : inactiveWorkflows.length ? "warning" : "disabled", `${activeWorkflows.length} active / ${inactiveWorkflows.length} inactive`],
    ["FACEBOOK", facebookPageCount ? "healthy" : facts.facebookCredentials.length ? "warning" : "disabled", facebookPageCount ? `${facebookPageCount} pages` : facts.facebookCredentials.length ? "Credentials ready" : "Not configured"],
    ["WHATSAPP", "disabled", "Not connected"],
    ["TIKTOK", "disabled", "Not connected"],
    ["AI AGENT", facts.nodeCount ? "healthy" : "warning", `${facts.nodeCount} workflow nodes`],
    ["QUEUE", facts.queuedItems.length ? "warning" : "healthy", facts.queuedItems.length ? `${facts.queuedItems.length} queued` : "Clear"],
  ];
  const mixed = inactiveWorkflows.length > 0;
  return <section className={`corex-live-engine ${mixed ? "mixed" : "healthy"}`} aria-label="Corex Live Engine"><header><div><span>LIVE OPERATIONS CORE</span><h2>COREX LIVE ENGINE</h2></div><strong>{mixed ? "MIXED HEALTH" : "READY"}</strong></header><div className="engine-stage"><div className="engine-pipelines left">{pipelines.slice(0, 3).map(([label, status, meta]) => <article key={label} className={`engine-pipeline ${status}`}><b>{label}</b><small>{meta}</small><i /></article>)}</div><div className="engine-core" aria-hidden="true"><span className="ring one" /><span className="ring two" /><span className="ring three" /><strong>AI</strong></div><div className="engine-pipelines right">{pipelines.slice(3).map(([label, status, meta]) => <article key={label} className={`engine-pipeline ${status}`}><b>{label}</b><small>{meta}</small><i /></article>)}</div></div></section>;
}

function CorexSummaryDashboard({ facts, workflows, facebookPages, state, workflowActive, workflowError, onControl, onOpenWorkflow, onFocusConversation, onOpenFacebookPages }) {
  const [modal, setModal] = useState(null);
  const activeWorkflows = workflows.filter((workflow) => workflow.status === "ACTIVE");
  const inactiveWorkflows = workflows.filter((workflow) => workflow.status !== "ACTIVE");
  const stateLabel = workflowError ? "Needs Check" : workflowActive ? "Running" : state.toUpperCase();
  const cards = [
    ["FACEBOOK PAGES", String(facebookPages.length), facebookPages.length ? "Connected page records" : "No pages added yet", "facebook"],
    ["ACTIVE WORKFLOWS", String(activeWorkflows.length), activeWorkflows.length ? "Running normally" : "No active workflows", "active"],
    ["INACTIVE WORKFLOWS", String(inactiveWorkflows.length), inactiveWorkflows.length ? "Need attention" : "All clear", "inactive"],
  ];
  const openCard = (kind) => { if (kind === "facebook") onOpenFacebookPages(); else setModal(kind); };
  return <section className="corex-summary-dashboard" aria-label="Corex dashboard overview">
    <header className="corex-summary-hero"><div><span>AI CONTROL SYSTEM</span><h1>COREX CORE</h1><p>Clean command overview for workflows, Facebook pages, and live operations.</p></div><button type="button" className="corex-summary-orb" onClick={onFocusConversation} aria-label="Focus Corex conversation"><span>ISK</span></button><strong className={`corex-summary-state ${workflowError ? "error" : workflowActive ? "running" : "ready"}`}><i />{stateLabel}</strong></header>
    <div className="corex-summary-grid top-three">{cards.map(([label, value, meta, kind]) => <button type="button" className={`corex-summary-card ${kind}${kind === "inactive" && inactiveWorkflows.length === 0 ? " neutral" : ""}`} key={label} onClick={() => openCard(kind)}><span>{label}</span><strong>{value}</strong><small>{meta}</small></button>)}</div>
    <CorexLiveEngine activeWorkflows={activeWorkflows} inactiveWorkflows={inactiveWorkflows} facts={facts} facebookPageCount={facebookPages.length} />
    {modal === "active" && <WorkflowStatusModal title="Active Workflows" workflows={activeWorkflows} tone="active" onClose={() => setModal(null)} onOpenWorkflow={onOpenWorkflow} />}
    {modal === "inactive" && <WorkflowStatusModal title="Inactive Workflows" workflows={inactiveWorkflows} tone="inactive" onClose={() => setModal(null)} onOpenWorkflow={onOpenWorkflow} />}
  </section>;
}

function formatMetric(value, suffix = "") { return value === null || value === undefined || value === "" ? "Not synced" : `${Number(value).toLocaleString()}${suffix}`; }
function aggregateTeamPages(pages) {
  const grouped = new Map();
  for (const page of pages) {
    const key = page.teamMemberName || "Unassigned";
    const current = grouped.get(key) || { name: key, followers: 0, views: 0, reels: 0, growth: 0, score: 0, pages: 0 };
    current.pages += 1; current.followers += Number(page.metrics?.followers) || 0; current.views += Number(page.metrics?.views) || 0; current.reels += Number(page.metrics?.reels) || 0; current.growth += Number(page.metrics?.followerGrowth) || 0; current.score += page.performanceScore || facebookPerformanceScore(page.metrics);
    grouped.set(key, current);
  }
  return [...grouped.values()].sort((a, b) => b.score - a.score);
}
function FacebookPagesDashboard({ pages, onBack }) {
  const rankedPages = [...pages].map((page) => ({ ...page, performanceScore: page.performanceScore || facebookPerformanceScore(page.metrics) })).sort((a, b) => b.performanceScore - a.performanceScore);
  const teamRows = aggregateTeamPages(rankedPages); const maxTeamScore = Math.max(1, ...teamRows.map((team) => team.score));
  return <section className="facebook-pages-dashboard corex-facebook-performance" aria-label="Facebook Pages performance dashboard"><header className="facebook-pages-header"><div><span>FACEBOOK CONTROL</span><h1>Facebook Performance</h1><p>Real saved page records only. Metrics stay empty until a server-side Meta data connection stores snapshots.</p></div><button type="button" onClick={onBack}>Back to Dashboard</button></header>{!rankedPages.length ? <div className="facebook-empty-state performance"><strong>No Facebook Pages have been added yet.</strong><span>Open Facebook Control to add Page URL, Page ID, manager, and credential connection.</span></div> : <><section className="facebook-performance-section"><header><h2>Facebook Page Performance / Ranking</h2><span>{rankedPages.length} pages</span></header><div className="facebook-ranking-list">{rankedPages.map((page, index) => <article key={page.id} onClick={() => window.open(page.pageUrl, "_blank", "noopener,noreferrer")} role="button" tabIndex={0}><b>#{index + 1}</b><i>{(page.pageName || "FB").slice(0, 2).toUpperCase()}</i><div><strong>{page.pageName}</strong><span>Manager: {page.teamMemberName || "Unassigned"}</span></div><dl><dt>Followers</dt><dd>{formatMetric(page.metrics?.followers)}</dd><dt>Views</dt><dd>{formatMetric(page.metrics?.views)}</dd><dt>Reels</dt><dd>{formatMetric(page.metrics?.reels)}</dd><dt>Score</dt><dd>{page.metrics?.capturedAt ? page.performanceScore : "Pending"}</dd></dl><small>Updated: {page.metrics?.capturedAt ? new Date(page.metrics.capturedAt).toLocaleString() : "Data connection required"}</small><a href={page.pageUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>Open Page</a></article>)}</div></section><section className="facebook-performance-section team-graph"><header><h2>Team Performance Graph</h2><select aria-label="Team performance metric"><option>Overall Performance</option><option>Followers</option><option>Views</option><option>Reels</option><option>Growth</option></select></header>{teamRows.map((team) => <div className="team-performance-row" key={team.name}><span>{team.name}<small>{team.pages} pages</small></span><em><i style={{ width: `${Math.max(6, Math.round(team.score / maxTeamScore * 100))}%` }} /></em><strong>{team.score || "Pending"}</strong></div>)}</section></>}</section>;
}

export default function JarvisDashboard({ apiBaseUrl = "", graph, workflowActive = false, workflowError = false, healthContext = {}, executions = [], lastExecutionAt = null, activeWorkflowId = "local-workflow", onOpenWorkflow }) {
  const [detail, setDetail] = useState(null); const [dashboardView, setDashboardView] = useState("overview"); const [facebookControl, setFacebookControl] = useState({ pages: [], teams: [], sync: { refreshIntervalMinutes: 5, lastSyncAt: null } }); const [draft, setDraft] = useState(""); const [messages, setMessages] = useState([]); const [savedWorkflows, setSavedWorkflows] = useState([]); const [agentStates, setAgentStates] = useState({}); const [tasks, setTasks] = useState([]); const [activeWorkspace, setActiveWorkspace] = useState(null); const [officeHandoff, setOfficeHandoff] = useState(null); const inputRef = useRef(null); const taskSequence = useRef(0);
  const healthStates = graph.nodes.map((node) => nodeConnectionHealth(node, healthContext)); const state = controlCenterState({ graph, workflowActive, workflowError, healthStates });
  const workflows = useMemo(() => savedWorkflows.filter((item) => item.id !== "local-workflow"), [savedWorkflows]);
  const facts = useMemo(() => ({ ...dashboardFacts({ graph, googleCredentials: healthContext.googleCredentials, facebookCredentials: healthContext.facebookCredentials, executions, lastExecutionAt }), workflowCount: workflows.length }), [graph, healthContext.googleCredentials, healthContext.facebookCredentials, executions, lastExecutionAt, workflows.length]);
  useEffect(() => { let cancelled = false; listWorkflows(fetch, apiBaseUrl).then((items) => { if (!cancelled) setSavedWorkflows(items); }).catch(() => { if (!cancelled) setSavedWorkflows([]); }); getFacebookControl(fetch, apiBaseUrl).then((data) => { if (!cancelled) setFacebookControl(data); }).catch(() => { if (!cancelled) setFacebookControl({ pages: [], teams: [], sync: { refreshIntervalMinutes: 5, lastSyncAt: null } }); }); return () => { cancelled = true; }; }, [apiBaseUrl]);
  useEffect(() => { if (!detail) return undefined; const close = (event) => { if (event.key === "Escape") setDetail(null); }; window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, [detail]);
  const focusConversation = () => { setDetail(null); window.requestAnimationFrame(() => inputRef.current?.focus()); };
  const routeCommand = (text) => {
    const value = text.toLowerCase(); const intent = handoffIntent(text); let agent = "atlas"; let panel = null; let result = "System dashboard is ready. No restart or hidden action was performed."; let taskStatus = "DONE";
    if (/amazon/.test(value) && !intent) { agent = "link"; setActiveWorkspace("amazon"); result = "Amazon is not connected. No Amazon operation was performed."; taskStatus = "ERROR"; }
    else if (/link|kazim|sulaiman|imran|transfer|share/.test(value)) { agent = "link"; const member = MEMBERS.find((item) => value.includes(item.id)); setActiveWorkspace(member?.id || null); const transferRequested = /transfer|put|share/.test(value); result = transferRequested ? "File transfer was not performed: no file selection and destination permission were supplied." : member ? `${member.name} workspace is available; connected resource access must be configured before inspection.` : "LINK is ready. Name a workspace and a supported connected resource."; taskStatus = "ERROR"; }
    else if (/whatsapp|message|communication|chat/.test(value)) { agent = "nova"; panel = value.includes("whatsapp") ? "whatsapp" : null; const unavailable = value.includes("whatsapp"); result = unavailable ? "WhatsApp is NOT CONNECTED. No status was fabricated." : "Text conversation is available; no external messaging connector was invoked."; taskStatus = unavailable ? "ERROR" : "DONE"; }
    else if (/tiktok|youtube|facebook|view|social|engagement/.test(value)) { agent = "pulse"; panel = value.includes("facebook") ? "facebook" : value.includes("youtube") ? "youtube" : "tiktok"; const facebookConnected = value.includes("facebook") && facts.facebookCredentials.length > 0; result = value.includes("facebook") ? (facebookConnected ? `${facts.facebookCredentials.length} Facebook credential record(s) are connected. Analytics are unavailable.` : "Facebook is NOT CONNECTED.") : `${value.includes("youtube") ? "YouTube" : "TikTok"} analytics are NOT CONNECTED. No metric was fabricated.`; taskStatus = "ERROR"; }
    else if (/workflow|automation|run|failed|error/.test(value)) { agent = "orbit"; panel = "workflow"; result = `${facts.workflowCount} workflow(s) are visible. Current state is ${state.toUpperCase()}; ${facts.nodeCount} connected nodes and ${facts.connectionCount} connections.`; taskStatus = workflowError ? "ERROR" : "DONE"; }
    else if (/drive|storage|file|media|health|system|tool/.test(value)) { agent = "atlas"; panel = /drive|storage|file|media/.test(value) ? "storage" : null; const driveConnected = facts.googleCredentials.length > 0; result = driveConnected ? `${facts.googleCredentials.length} Google Drive credential record(s) are available. No files were changed.` : "Google Drive is NOT CONNECTED. No file action was performed."; taskStatus = driveConnected || !panel ? "DONE" : "ERROR"; }
    if (intent) { agent = intent.source; panel = null; const amazonDestination = intent.destination === "amazon"; const externalTransfer = intent.packageType === "file" || intent.packageType === "video"; taskStatus = amazonDestination || externalTransfer ? "ERROR" : "DONE"; result = amazonDestination ? "Amazon is not connected. The office delivery can be visualized, but no Amazon upload or operation succeeded." : externalTransfer ? `Office handoff reached ${AGENT_NAMES[intent.destination] || intent.destination}, but no connected file-transfer action was completed.` : `Office task handoff from ${AGENT_NAMES[intent.source]} to ${AGENT_NAMES[intent.destination]} was recorded. No external action was claimed.`; if (amazonDestination || MEMBERS.some((member) => member.id === intent.destination)) setActiveWorkspace(intent.destination); }
    if (panel) setDetail(panel); taskSequence.current += 1; const id = `task-${taskSequence.current}`; const name = AGENT_NAMES[agent] || "LINK";
    setAgentStates((current) => ({ ...current, [agent]: taskStatus, ...(intent ? { [intent.destination]: taskStatus } : {}) }));
    setTasks((current) => [...current, { id, title: text, agent: name, status: taskStatus, result }]);
    if (intent) setOfficeHandoff({ id, ...intent, title: text, result, outcome: taskStatus });
    setMessages((current) => [...current, { id: `${id}-result`, role: "jarvis", text: `${name}: ${result}` }]);
  };
  const sendMessage = (event) => { event.preventDefault(); const text = draft.trim(); if (!text) return; taskSequence.current += 1; setMessages((current) => [...current, { id: `message-${taskSequence.current}`, role: "user", text }]); setDraft(""); routeCommand(text); };
  return <section className={`dashboard-page jarvis-control-center technical-dashboard control-${state}`} data-control-state={state}><div className="dashboard-main-column">{dashboardView === "facebookPages" ? <FacebookPagesDashboard pages={facebookControl.pages} onBack={() => setDashboardView("overview")} /> : <CorexSummaryDashboard facts={facts} workflows={workflows} facebookPages={facebookControl.pages} state={state} workflowActive={workflowActive} workflowError={workflowError} onControl={setDetail} onOpenWorkflow={onOpenWorkflow} onFocusConversation={focusConversation} onOpenFacebookPages={() => setDashboardView("facebookPages")} />}<OfficeSimulation agentStates={{ ...agentStates, orbit: workflowActive ? "WORKING" : workflowError ? "ERROR" : agentStates.orbit }} activeWorkspace={activeWorkspace} tasks={tasks} handoff={officeHandoff} onHandoffComplete={(id) => setOfficeHandoff((current) => current?.id === id ? null : current)} platformStates={{ amazon: "NOT CONNECTED", facebook: facts.facebookCredentials.length ? "CONNECTED" : "NOT CONNECTED", tiktok: "NOT CONNECTED", youtube: "NOT CONNECTED" }} onPlatformSelect={setDetail} /></div><ConversationPanel inputRef={inputRef} messages={messages} draft={draft} onDraft={setDraft} onSend={sendMessage} /><OperationalDetail detail={detail} facts={facts} state={state} onClose={() => setDetail(null)} /></section>;
}
