import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
const source = fs.readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

test("workflow Drive search and file actions retain authenticated session cookies for Additional Access", () => {
  assert.match(source, /\/api\/google\/drive\/search[\s\S]{0,260}credentials: "include"/);
  assert.match(source, /\/api\/google\/drive\/\$\{action\}[\s\S]{0,180}credentials: "include"/);
  assert.doesNotMatch(source.slice(source.indexOf("const executeNodeOperation"), source.indexOf('if (node.name === "Prepare Content")')), /session\.role\s*===\s*["']admin["']/);
});

test("authorized non-Admin sessions load safe Google credential metadata for workflow pickers", () => {
  const sync = source.slice(source.indexOf("const syncGoogleCredential"), source.indexOf("const syncFacebookCredentials"));
  assert.match(sync, /\/api\/google\/credentials/);
  assert.match(sync, /credentials: "include"/);
  assert.doesNotMatch(sync, /session\.role|accessToken|refreshToken/);
});
