import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8");
const app = read("./App.jsx");
const auth = read("./JarvisAuth.jsx");
const dashboard = read("./JarvisDashboard.jsx");
const html = read("../index.html");
const sessionStore = read("../../server/sqliteSessionStore.js");
const accessControl = read("../../server/accessControl.js");
const server = read("../../server/index.js");
const startupScript = read("../../scripts/install-jarvis-startup.ps1");

test("primary product surfaces display COREX branding", () => {
  assert.match(app, />\s*COREX\s*</);
  assert.match(app, /COREX \/ Workflow/);
  assert.match(auth, /LOCK COREX/);
  assert.match(auth, /COREX SECURE ACCESS/);
  assert.match(dashboard, /COREX CORE/);
  assert.match(dashboard, /COREX CONVERSATION/);
  assert.match(html, /<title>COREX<\/title>/);
});

test("old visible JARVIS labels are absent from primary UI", () => {
  for (const source of [app, auth, dashboard]) {
    assert.doesNotMatch(source, />\s*JARVIS\s*</);
    assert.doesNotMatch(source, /LOCK JARVIS|Jarvis \/ Workflow|JARVIS CORE|JARVIS CONVERSATION/);
  }
});

test("legacy persistence and installed-task identifiers remain compatible", () => {
  assert.match(sessionStore, /jarvis_http_sessions/);
  assert.match(accessControl, /jarvis_auth_sessions/);
  assert.match(server, /JARVIS_DB_PATH/);
  assert.match(startupScript, /Jarvis Always-On Backend/);
});
