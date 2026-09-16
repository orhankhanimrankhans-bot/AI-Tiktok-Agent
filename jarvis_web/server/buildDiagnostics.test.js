"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { createBuildDiagnostics, metaConfigDiagnostics } = require("./buildDiagnostics");
const build = require("../shared/buildVersion.json");

test("build diagnostics distinguish missing, stale and matching frontend artifacts", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "corex-build-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const read = createBuildDiagnostics(dir, "production");
  assert.equal(read().clientBuild, "unavailable");
  fs.writeFileSync(path.join(dir, "index.html"), '<meta name="corex-build" content="OLD-BUILD">');
  fs.writeFileSync(path.join(dir, "build.json"), JSON.stringify({ version: "OLD-BUILD" }));
  assert.equal(read().clientBuild, "OLD-BUILD");
  assert.equal(read().version, build.version);
  fs.writeFileSync(path.join(dir, "build.json"), JSON.stringify(build));
  assert.equal(read().clientBuild, "unavailable");
  fs.writeFileSync(path.join(dir, "index.html"), `<meta name="corex-build" content="${build.version}">`);
  const result = read();
  assert.equal(result.clientBuild, result.version);
  assert.equal(result.environment, "production");
  assert.equal(result.serverStartedAt, read().serverStartedAt);
  assert.deepEqual(Object.keys(result).sort(), ["clientBuild", "environment", "metaSetupVersion", "serverStartedAt", "version"]);
  assert.doesNotMatch(JSON.stringify(result), /corex-build-test/);
});

test("workspace diagnostics expose booleans and stored connection state only", () => {
  const configured = { configured: true, appId: "123456", secretConfigured: true, appSecret: "never-return", revision: "private-revision" };
  const credential = { appId: "123456", connectionStatus: "connected", pageId: "private-page", accessToken: "never-return" };
  assert.deepEqual(metaConfigDiagnostics(configured, [credential]), { configured: true, connectionStatus: "connected", mode: "user_managed", hasAppId: true, hasAppSecret: true });
  assert.deepEqual(metaConfigDiagnostics({ configured: false }, []), { configured: false, connectionStatus: "not_connected", mode: "user_managed", hasAppId: false, hasAppSecret: false });
  assert.equal(metaConfigDiagnostics(configured, [{ ...credential, appId: "654321" }]).connectionStatus, "connected");
  assert.equal(metaConfigDiagnostics({ configured: false }, [credential]).connectionStatus, "connected");
});
