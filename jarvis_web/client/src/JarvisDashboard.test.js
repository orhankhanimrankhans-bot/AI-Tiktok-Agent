import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboard = readFileSync(new URL("./JarvisDashboard.jsx", import.meta.url), "utf8");
const pipeline = readFileSync(new URL("./CommandPipeline.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("./App.css", import.meta.url), "utf8");
const app = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

test("Jarvis Core renders an exact circular ISK conversation control", () => {
  assert.match(dashboard, /<h1>JARVIS CORE<\/h1>/); assert.match(dashboard, /className="isk-core-button"/); assert.match(dashboard, /<span>ISK<\/span>/);
  assert.match(dashboard, /onClick=\{focusConversation\}/); assert.match(dashboard, /inputRef\.current\?\.focus\(\)/);
  assert.match(styles, /\.isk-core-button \{[^}]*width: 82px;[^}]*height: 82px;[^}]*border-radius: 50%;[^}]*aspect-ratio: 1;/);
  assert.doesNotMatch(dashboard, /<span>J<\/span>|<span>JSK<\/span>|<span>JARVIS<\/span>/);
});

test("five operational cards and every detail drawer route are present", () => {
  for (const label of ["UPLOAD QUEUE", "WORKFLOW CONTROL", "FACEBOOK", "YOUTUBE", "STORAGE & MEDIA"]) assert.match(dashboard, new RegExp(label));
  for (const id of ["upload", "workflow", "facebook", "youtube", "storage"]) assert.match(dashboard, new RegExp(`\\["${id}"`));
  assert.match(dashboard, /setDetail\(id\)/); assert.match(dashboard, /role="dialog"/); assert.match(dashboard, /event\.key === "Escape"/);
});

test("six integrations are truthful and Chat focuses the shared conversation", () => {
  for (const label of ["CHAT", "VOICE", "WHATSAPP", "TIKTOK", "TOOLS", "MEMORY"]) assert.match(dashboard, new RegExp(label));
  assert.match(dashboard, /id === "chat" \? focusConversation\(\)/); assert.match(dashboard, /Voice transcription is unavailable/);
  assert.match(dashboard, /WhatsApp", "Not connected/); assert.match(dashboard, /TikTok", "Not connected/);
});

test("large conversation panel supports real typed input without fake replies or transcription", () => {
  assert.match(dashboard, /JARVIS CONVERSATION/); assert.match(dashboard, /className="conversation-thread"/); assert.match(dashboard, /placeholder="Type a message\.\.\."/);
  assert.match(dashboard, /className="conversation-mic" disabled/); assert.match(dashboard, /setMessages\(\(current\) => \[\.\.\.current/);
  assert.match(dashboard, /role: "user"/); assert.doesNotMatch(dashboard, /role: "jarvis", text|SpeechRecognition|webkitSpeechRecognition/);
  assert.match(styles, /\.jarvis-conversation \{[^}]*grid-template-rows: auto 1fr auto/); assert.match(styles, /\.conversation-thread \{[^}]*overflow-y: auto/);
});

test("engine and route states are disconnected, static-ready, running, and error driven", () => {
  assert.match(pipeline, /workflowError \? "error" : workflowActive \? "running" : healthStates\.includes\("error"\)/); assert.match(pipeline, /healthStates\.includes\("disconnected"\)/);
  assert.match(pipeline, /data-engine-state=\{state\}/); assert.match(styles, /\.pipeline-ready \.strong-engine-orb[^}]*--jarvis-engine-ready/);
  assert.match(styles, /\.pipeline-running \.strong-engine-orb[^}]*--jarvis-engine-running/); assert.match(styles, /\.pipeline-error \.strong-engine-orb[^}]*--jarvis-engine-error/);
  assert.match(styles, /\.pipeline-disconnected \.strong-engine-orb[^}]*--jarvis-engine-disconnected/); assert.match(styles, /\.pipeline-running \.strong-engine-orb::before[^}]*animation:/);
  assert.match(styles, /\.pipeline-ready \.engine-ring[^}]*animation: none !important/); assert.doesNotMatch(pipeline, /setInterval|setTimeout|requestAnimationFrame/);
});

test("old status stack is replaced and dashboard remains wired to the actual graph", () => {
  assert.match(app, /<JarvisDashboard graph=\{dashboardGraph\}/); assert.doesNotMatch(app, /dashboard-metrics|dashboard-status-rail/);
  assert.doesNotMatch(dashboard, /Command Runtime|Interfaces|System Health/); assert.match(dashboard, /<CommandPipeline graph=\{graph\}/);
  assert.match(styles, /@media \(max-width: 1450px\)/); assert.match(styles, /@media \(max-width: 1080px\)/); assert.match(styles, /@media \(max-width: 760px\)/);
});
