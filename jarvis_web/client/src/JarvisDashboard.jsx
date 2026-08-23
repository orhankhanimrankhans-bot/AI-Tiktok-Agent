import { useEffect, useMemo, useRef, useState } from "react";
import CommandPipeline from "./CommandPipeline.jsx";
import { controlCenterState, dashboardFacts } from "./dashboardControlCenter.js";
import { nodeConnectionHealth } from "./workflowCanvas.js";

const CONTROL_ICONS = { upload: "⇧", workflow: "⌁", facebook: "f", youtube: "▶", storage: "◇" };
const INTEGRATION_ICONS = { chat: "▤", voice: "◉", whatsapp: "◌", tiktok: "♪", tools: "⌘", memory: "⌬" };

function OperationalDetail({ detail, facts, state, onClose }) {
  const content = {
    upload: ["Upload Queue", facts.queuedItems.length ? `${facts.queuedItems.length} real item${facts.queuedItems.length === 1 ? "" : "s"} found in current Search output.` : "No queued media is available in current workflow output."],
    workflow: ["Workflow Control", `${facts.nodeCount} reachable nodes, ${facts.connectionCount} connections, ${facts.branchCount} branches. Current state: ${state}.`],
    facebook: ["Facebook", facts.facebookCredentials.length ? `${facts.facebookCredentials.length} connected credential record${facts.facebookCredentials.length === 1 ? "" : "s"}: ${facts.facebookCredentials.map((item) => item.name || item.pageName || "Facebook credential").join(", ")}.` : "No Facebook Page credential is connected."],
    youtube: ["YouTube", "Integration not configured."],
    storage: ["Storage & Media", facts.googleCredentials.length ? `${facts.googleCredentials.length} Google Drive credential record${facts.googleCredentials.length === 1 ? "" : "s"} available across ${facts.driveNodes.length} connected Drive steps.` : "Google Drive is not connected."],
    voice: ["Voice", "Voice transcription is unavailable in this web dashboard. No microphone session has been started."],
    whatsapp: ["WhatsApp", "Not connected."],
    tiktok: ["TikTok", "Not connected in this web dashboard."],
    tools: ["Tools", facts.nodeCount ? `${facts.nodeCount} actual connected workflow tools are available in the Workflow Editor.` : "No connected workflow tools are available."],
    memory: ["Memory", "No safe dashboard memory interface is configured."],
  }[detail];
  if (!content) return null;
  return <div className="control-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="control-detail-drawer" role="dialog" aria-modal="true" aria-labelledby="control-detail-title">
      <header><div><span>CONTROL MODULE</span><h2 id="control-detail-title">{content[0]}</h2></div><button type="button" onClick={onClose} aria-label="Close detail panel">×</button></header>
      <p>{content[1]}</p>
      {detail === "upload" && facts.queuedItems.length > 0 && <ul>{facts.queuedItems.slice(0, 10).map((item, index) => <li key={item.id || index}>{item.name || item.fileName || `Media item ${index + 1}`}</li>)}</ul>}
      {detail === "workflow" && <dl><div><dt>Triggers</dt><dd>{facts.triggerCount}</dd></div><div><dt>Last execution</dt><dd>{facts.lastExecutionAt ? new Date(facts.lastExecutionAt).toLocaleString() : "None"}</dd></div></dl>}
    </aside>
  </div>;
}

function ConversationPanel({ inputRef, messages, draft, onDraft, onSend }) {
  return <aside className="jarvis-conversation" aria-label="Jarvis Conversation">
    <header><div><span>SECURE LOCAL SESSION</span><h2>JARVIS CONVERSATION</h2></div><i aria-label="Text chat ready" /></header>
    <div className="conversation-thread" aria-live="polite">
      {messages.length ? messages.map((message) => <article key={message.id} className={`conversation-message ${message.role}`}><strong>{message.role === "user" ? "USER" : "JARVIS"}</strong><p>{message.text}</p></article>)
        : <div className="conversation-empty"><b>WAITING FOR INPUT</b><span>Text conversation is ready. Voice transcription is not configured.</span></div>}
    </div>
    <form className="conversation-input" onSubmit={onSend}>
      <button type="button" className="conversation-mic" disabled title="Voice transcription is not configured" aria-label="Microphone unavailable">◉</button>
      <input ref={inputRef} value={draft} onChange={(event) => onDraft(event.target.value)} placeholder="Type a message..." aria-label="Type a message" />
      <button type="submit" disabled={!draft.trim()}>SEND</button>
    </form>
  </aside>;
}

export default function JarvisDashboard({ graph, workflowActive = false, workflowError = false, healthContext = {}, executions = [], lastExecutionAt = null }) {
  const [detail, setDetail] = useState(null);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState([]);
  const inputRef = useRef(null);
  const healthStates = graph.nodes.map((node) => nodeConnectionHealth(node, healthContext));
  const state = controlCenterState({ graph, workflowActive, workflowError, healthStates });
  const facts = useMemo(() => dashboardFacts({ graph, googleCredentials: healthContext.googleCredentials, facebookCredentials: healthContext.facebookCredentials, executions, lastExecutionAt }), [graph, healthContext.googleCredentials, healthContext.facebookCredentials, executions, lastExecutionAt]);

  useEffect(() => {
    if (!detail) return undefined;
    const closeOnEscape = (event) => { if (event.key === "Escape") setDetail(null); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [detail]);

  const focusConversation = () => { setDetail(null); window.requestAnimationFrame(() => inputRef.current?.focus()); };
  const sendMessage = (event) => {
    event.preventDefault(); const text = draft.trim(); if (!text) return;
    setMessages((current) => [...current, { id: `${Date.now()}-${current.length}`, role: "user", text }]); setDraft("");
  };
  const operationalCards = [
    ["upload", "UPLOAD QUEUE", `${facts.queuedItems.length} ready items`],
    ["workflow", "WORKFLOW CONTROL", `${state} · ${facts.branchCount} branches`],
    ["facebook", "FACEBOOK", facts.facebookCredentials.length ? `${facts.facebookCredentials.length} credential${facts.facebookCredentials.length === 1 ? "" : "s"}` : "Not connected"],
    ["youtube", "YOUTUBE", "Not connected"],
    ["storage", "STORAGE & MEDIA", facts.googleCredentials.length ? `${facts.googleCredentials.length} Drive credential${facts.googleCredentials.length === 1 ? "" : "s"}` : "Not connected"],
  ];
  const integrations = [["chat", "CHAT", "Text ready"], ["voice", "VOICE", "Unavailable"], ["whatsapp", "WHATSAPP", "Not connected"], ["tiktok", "TIKTOK", "Not connected"], ["tools", "TOOLS", `${facts.nodeCount} connected`], ["memory", "MEMORY", "Unavailable"]];

  return <section className={`dashboard-page jarvis-control-center control-${state}`} data-control-state={state}>
    <div className="dashboard-main-column">
      <header className="jarvis-core-header">
        <div><span>AI CONTROL SYSTEM</span><h1>JARVIS CORE</h1><p>Conversation and command center</p></div>
        <button type="button" className="core-restart" disabled title="No safe restart backend is configured">RESTART</button>
        <button type="button" className="isk-core-button" onClick={focusConversation} aria-label="ISK - focus Jarvis conversation"><span>ISK</span></button>
        <div className="core-state"><i />{state.toUpperCase()}</div>
      </header>
      <div className="control-center-grid">
        <nav className="operational-controls" aria-label="Operational controls">{operationalCards.map(([id, label, summary]) => <button type="button" key={id} onClick={() => setDetail(id)}><i>{CONTROL_ICONS[id]}</i><span><strong>{label}</strong><small>{summary}</small></span><b>›</b></button>)}</nav>
        <CommandPipeline graph={graph} workflowActive={workflowActive} workflowError={workflowError} healthContext={healthContext} />
      </div>
      <nav className="integration-controls" aria-label="Jarvis integrations">{integrations.map(([id, label, summary]) => <button type="button" key={id} onClick={() => id === "chat" ? focusConversation() : setDetail(id)}><i>{INTEGRATION_ICONS[id]}</i><strong>{label}</strong><small>{summary}</small></button>)}</nav>
    </div>
    <ConversationPanel inputRef={inputRef} messages={messages} draft={draft} onDraft={setDraft} onSend={sendMessage} />
    <OperationalDetail detail={detail} facts={facts} state={state} onClose={() => setDetail(null)} />
  </section>;
}
