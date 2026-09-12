import { useEffect, useMemo, useRef, useState } from "react";
import OfficeSimulation from "./OfficeSimulation.jsx";
import { handoffIntent } from "./officeMovement.js";
import { listWorkflows } from "./workflowApi.js";
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


function TechnicalPipelineBoard({ facts, workflows, state, workflowActive, workflowError, onControl, onOpenWorkflow, onFocusConversation }) {
  const workflowItems = workflows.slice(0, 4);
  const inputChannels = [
    ["web", "Web App", "Dashboard"],
    ["mobile", "Mobile App", "Responsive"],
    ["api", "API / SDK", `${facts.nodeCount} nodes`],
    ["enterprise", "Enterprise Systems", `${facts.connectionCount} links`],
  ];
  const toolItems = [
    ["Search", facts.queuedItems.length ? `${facts.queuedItems.length} queued` : "Ready"],
    ["Code Executor", "Workflow runner"],
    ["Data Analyzer", `${facts.workflowCount} workflows`],
    ["Integrations", facts.facebookCredentials.length ? "Facebook connected" : "Limited"],
  ];
  const memoryItems = [
    ["Conversation Memory", "Local session"],
    ["Vector Store", "Not connected"],
    ["Knowledge Base", "Project data"],
    ["User Preferences", "Saved theme"],
  ];
  return <section className="technical-pipeline-board compact-technical-board balanced-technical-board" aria-label="Corex technical pipeline dashboard">
    <div className="pipeline-frame-corner top-left" /><div className="pipeline-frame-corner top-right" /><div className="pipeline-frame-corner bottom-left" /><div className="pipeline-frame-corner bottom-right" />
    <header className="technical-pipeline-header"><div><span>AI CONTROL SYSTEM</span><h1>COREX CORE</h1><p>Live command headquarters</p></div><button type="button" className="technical-isk-core" onClick={onFocusConversation} aria-label="ISK - focus Corex conversation"><span>ISK</span></button><strong><i />{state.toUpperCase()}</strong></header>
    <div className="compact-pipeline-grid">
      <section className="technical-column input-channel-column"><h2>INPUT<br />CHANNELS</h2><div className="technical-stack input-grid">{inputChannels.map(([id, label, meta]) => <button type="button" key={id} onClick={() => onControl(id === "enterprise" ? "workflow" : id === "api" ? "workflow" : "upload")}><i>{id === "web" ? "◎" : id === "mobile" ? "▯" : id === "api" ? "&lt;/&gt;" : "▥"}</i><span>{label}</span><small>{meta}</small></button>)}</div></section>
      <div className="compact-flow-arrow" aria-hidden="true"><span /><i /></div>
      <section className="technical-column tools-column compact-tools-column"><h2>TOOLS</h2><div className="technical-stack compact tool-grid">{toolItems.map(([label, meta]) => <button type="button" key={label} onClick={() => onControl(label === "Integrations" ? "facebook" : label === "Data Analyzer" ? "workflow" : "storage")}><i>{label === "Search" ? "⌕" : label === "Code Executor" ? "▣" : label === "Data Analyzer" ? "▥" : "✚"}</i><span>{label}</span><small>{meta}</small></button>)}</div><h2 className="memory-title">MEMORY SERVICES</h2><div className="technical-stack compact memory-stack memory-grid">{memoryItems.map(([label, meta]) => <button type="button" key={label} onClick={() => onControl(label === "Conversation Memory" ? "whatsapp" : "storage")}><i>{label === "Conversation Memory" ? "☰" : label === "Vector Store" ? "✤" : label === "Knowledge Base" ? "▤" : "●"}</i><span>{label}</span><small>{meta}</small></button>)}</div></section>
    </div>
    <footer className="technical-workflow-strip compact-workflow-strip"><div><span>LIVE WORKFLOWS</span><strong>COMMAND PIPELINE</strong></div><div className="technical-workflow-list">{workflowItems.map((workflow) => <button type="button" key={workflow.id} onClick={() => onOpenWorkflow?.(workflow.id)}><i /> <span>{workflow.name}</span><small>{workflow.updatedAt ? new Date(workflow.updatedAt).toLocaleDateString() : "READY"}</small></button>)}</div><button type="button" className="technical-add-workflow" onClick={() => onControl("workflow")}>+ ADD WORKFLOW</button><p>{facts.workflowCount} workflows / {facts.nodeCount} active nodes / {facts.connectionCount} connections</p></footer>
  </section>;
}
export default function JarvisDashboard({ apiBaseUrl = "", graph, workflowActive = false, workflowError = false, healthContext = {}, executions = [], lastExecutionAt = null, activeWorkflowId = "local-workflow", onOpenWorkflow }) {
  const [detail, setDetail] = useState(null); const [draft, setDraft] = useState(""); const [messages, setMessages] = useState([]); const [savedWorkflows, setSavedWorkflows] = useState([]); const [agentStates, setAgentStates] = useState({}); const [tasks, setTasks] = useState([]); const [activeWorkspace, setActiveWorkspace] = useState(null); const [officeHandoff, setOfficeHandoff] = useState(null); const inputRef = useRef(null); const taskSequence = useRef(0);
  const healthStates = graph.nodes.map((node) => nodeConnectionHealth(node, healthContext)); const state = controlCenterState({ graph, workflowActive, workflowError, healthStates });
  const workflows = useMemo(() => [{ id: "local-workflow", name: "My Workflow", status: "LOCAL", updatedAt: lastExecutionAt }, ...savedWorkflows.filter((item) => item.id !== "local-workflow")], [savedWorkflows, lastExecutionAt]);
  const facts = useMemo(() => ({ ...dashboardFacts({ graph, googleCredentials: healthContext.googleCredentials, facebookCredentials: healthContext.facebookCredentials, executions, lastExecutionAt }), workflowCount: workflows.length }), [graph, healthContext.googleCredentials, healthContext.facebookCredentials, executions, lastExecutionAt, workflows.length]);
  useEffect(() => { let cancelled = false; listWorkflows(fetch, apiBaseUrl).then((items) => { if (!cancelled) setSavedWorkflows(items); }).catch(() => { if (!cancelled) setSavedWorkflows([]); }); return () => { cancelled = true; }; }, [apiBaseUrl]);
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
  return <section className={`dashboard-page jarvis-control-center technical-dashboard control-${state}`} data-control-state={state}><div className="dashboard-main-column"><TechnicalPipelineBoard facts={facts} workflows={workflows} state={state} workflowActive={workflowActive} workflowError={workflowError} onControl={setDetail} onOpenWorkflow={onOpenWorkflow} onFocusConversation={focusConversation} /><OfficeSimulation agentStates={{ ...agentStates, orbit: workflowActive ? "WORKING" : workflowError ? "ERROR" : agentStates.orbit }} activeWorkspace={activeWorkspace} tasks={tasks} handoff={officeHandoff} onHandoffComplete={(id) => setOfficeHandoff((current) => current?.id === id ? null : current)} platformStates={{ amazon: "NOT CONNECTED", facebook: facts.facebookCredentials.length ? "CONNECTED" : "NOT CONNECTED", tiktok: "NOT CONNECTED", youtube: "NOT CONNECTED" }} onPlatformSelect={setDetail} /></div><ConversationPanel inputRef={inputRef} messages={messages} draft={draft} onDraft={setDraft} onSend={sendMessage} /><OperationalDetail detail={detail} facts={facts} state={state} onClose={() => setDetail(null)} /></section>;
}
