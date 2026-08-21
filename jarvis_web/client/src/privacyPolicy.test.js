import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./PrivacyPolicy.jsx", import.meta.url), "utf8");

test("privacy policy covers the connected services and required privacy topics", () => {
  for (const heading of [
    "Information collected",
    "Google OAuth and Google Drive data",
    "Meta/Facebook OAuth and Page data",
    "How data is used",
    "Credential and token security",
    "Data storage and retention",
    "Sharing of data",
    "User choices and account disconnection",
    "Data deletion requests",
    "Contact information",
  ]) {
    assert.match(source, new RegExp(heading.replace("/", "\\/")));
  }
});

test("privacy policy does not contain secret values or claim Facebook publishing", () => {
  assert.doesNotMatch(source, /process\.env|CLIENT_SECRET|JARVIS_DB_PATH|access_token\s*[:=]/i);
  assert.match(source, /does not sell or rent user\s+data/i);
  assert.match(source, /does not currently\s+publish, modify, or delete Facebook content/i);
});
