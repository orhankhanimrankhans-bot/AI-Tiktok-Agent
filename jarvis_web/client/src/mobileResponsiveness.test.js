import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("./JarvisDashboard.jsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./App.css", import.meta.url), "utf8");

test("mobile app shell uses a drawer without replacing desktop navigation", () => {
  assert.match(app, /mobileMenuOpen/);
  assert.match(app, /className="mobile-app-header"/);
  assert.match(app, /className="mobile-sidebar-backdrop"/);
  assert.match(app, /className="mobile-sidebar-close"/);
  assert.match(app, /setMobileMenuOpen\(false\)/);
  assert.match(css, /@media \(max-width: 767px\)[\s\S]*\.mobile-app-header/);
  assert.match(css, /\.jarvis-app\.mobile-menu-open \.sidebar/);
  assert.match(css, /height: 100dvh/);
});

test("mobile dashboard opens Corex Conversation as an overlay", () => {
  assert.match(dashboard, /conversationOpen/);
  assert.match(dashboard, /mobile-conversation-fab/);
  assert.match(dashboard, /conversation-mobile-backdrop/);
  assert.match(dashboard, /conversation-close/);
  assert.match(css, /\.jarvis-control-center\.conversation-open \.jarvis-conversation/);
  assert.match(css, /\.mobile-conversation-fab/);
});

test("mobile responsive layer covers workflow, facebook, security, and touch targets", () => {
  for (const selector of [
    ".workflow-canvas",
    ".node-picker",
    ".node-editor-window",
    ".workflow-manager",
    ".facebook-performance-row.head",
    ".facebook-control-layout",
    ".security-row-head",
    ".security-row-actions",
  ]) assert.match(css, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(css, /\.facebook-performance-row \{[\s\S]*grid-template-columns: 1fr 1fr/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /@media \(max-width: 480px\)/);
  assert.match(css, /prefers-reduced-motion/);
});
