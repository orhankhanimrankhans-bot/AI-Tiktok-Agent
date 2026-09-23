const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const express = require("express");
const { TikTokStore } = require("./tiktokStore");
const { TikTokApi, configFromEnv, validateVideo } = require("./tiktokApi");
const { registerTikTokRoutes } = require("./tiktokRoutes");
const admin = { ownerType: "admin", ownerId: "primary" }, other = { ownerType: "additional", ownerId: "other" };
const config = { configured: true, clientKey: "test-key", clientSecret: "test-secret", redirectUri: "https://corex.test/api/tiktok/auth/callback" };
function store() { return new TikTokStore(new DatabaseSync(":memory:"), "test-encryption-secret"); }
test("credentials are encrypted, workspace-bound, and removed with upload records", () => {
  const s = store(); s.save(admin, { accessToken: "secret-token" });
  assert.equal(s.account(other), null); assert.equal(s.account(admin).accessToken, "secret-token");
  const raw = s.db.prepare("SELECT payload FROM tiktok_accounts").get().payload;
  assert.ok(!raw.includes("secret-token"));
  s.db.prepare("UPDATE tiktok_accounts SET owner=?").run("additional:other");
  assert.throws(() => s.account(other));
  s.remove(other); assert.equal(s.account(other), null); s.db.close();
});
test("OAuth states expire and bind owner, session, configuration, and one-time use", () => {
  const s = store(), state = s.begin(admin, "session", "config");
  assert.equal(s.consume(state, other, "session", "config"), false);
  assert.equal(s.consume(state, admin, "wrong", "config"), false);
  assert.equal(s.consume(state, admin, "session", "wrong"), false);
  assert.equal(s.consume(state, admin, "session", "config"), true);
  assert.equal(s.consume(state, admin, "session", "config"), false);
  const expired = s.begin(admin, "session", "config"); s.db.exec("UPDATE tiktok_oauth SET expires_at=0");
  assert.equal(s.consume(expired, admin, "session", "config"), false); s.db.close();
});
test("persistent locks and duplicate lookup isolate workspaces", () => {
  const s = store(); assert.equal(s.lock(admin), true); assert.equal(s.lock(admin), false); assert.equal(s.lock(other), true);
  s.unlock(admin); assert.equal(s.lock(admin), true);
  s.createJob(admin, "account", "digest", "job"); assert.ok(s.duplicate(admin, "account", "digest"));
  assert.equal(s.duplicate(other, "account", "digest"), undefined); assert.equal(s.job(other, "job"), undefined); s.db.close();
});
test("configuration requires HTTPS and exact callback; file validation rejects disguised input", () => {
  assert.equal(configFromEnv({ TIKTOK_CLIENT_KEY: "x", TIKTOK_CLIENT_SECRET: "y", TIKTOK_REDIRECT_URI: config.redirectUri }).configured, true);
  for (const redirect of ["http://corex.test/api/tiktok/auth/callback", "https://corex.test/", config.redirectUri + "?x=1"]) assert.equal(configFromEnv({ TIKTOK_CLIENT_KEY: "x", TIKTOK_CLIENT_SECRET: "y", TIKTOK_REDIRECT_URI: redirect }).configured, false);
  assert.throws(() => validateVideo(Buffer.from("not-a-video-file"), "video/mp4"));
  assert.doesNotThrow(() => validateVideo(Buffer.from("0000ftypisom0000"), "video/mp4"));
});
test("provider failures redact secrets and unsafe upload destinations never receive bytes", async () => {
  let calls = 0;
  const api = new TikTokApi(config, async () => { calls++; return { ok: false, json: async () => ({ error: { code: "bad", message: "secret-token" } }) }; });
  await assert.rejects(api.request("test/"), error => !error.message.includes("secret-token"));
  for (const url of ["http://open-upload.tiktokapis.com/video", "https://localhost/video", "https://tiktokapis.com.evil.test/video", "https://x:y@open-upload.tiktokapis.com/video"]) await assert.rejects(api.transfer(url, Buffer.from("test"), "video/mp4"));
  assert.equal(calls, 1);
});
test("token refresh preserves account and rotates refresh token", async () => {
  const api = new TikTokApi(config, async () => ({ ok: true, json: async () => ({ access_token: "new", refresh_token: "rotated", open_id: "a", scope: "video.upload", expires_in: 86400, refresh_expires_in: 86400 }) }));
  const updated = await api.access({ openId: "a", accessToken: "old", refreshToken: "old-refresh", expiresAt: 0, refreshExpiresAt: Date.now() + 100000 });
  assert.equal(updated.refreshToken, "rotated");
  await assert.rejects(api.access({ ...updated, openId: "other", expiresAt: 0 }));
});

test("HTTP flow enforces login, permissions, CSRF, replay prevention, consent and upload isolation", async t => {
  const s = store(), app = express(); let initCalls = 0, transfers = 0;
  app.use(express.json());
  app.use((req, res, next) => {
    req.sessionID = req.get("X-Test-Session") || "session";
    const role = req.get("X-Test-Role");
    req.session = role ? { jarvisAuth: role === "admin" ? { role, authVersion: 1 } : { role: "additional", profileId: "other" } } : {};
    next();
  });
  const security = { settings: () => ({ auth_version: 1 }), getChild: () => ({ enabled: true, permissions: { manage_workflow_credentials: true, run_workflow: true } }) };
  const api = {
    tokens: async () => ({ accessToken: "private-token", refreshToken: "private-refresh", openId: "account", expiresAt: Date.now() + 86400000, refreshExpiresAt: Date.now() + 86400000 }),
    profile: async () => ({ open_id: "account", display_name: "Test Creator" }), access: async value => value,
    request: async path => { if (path.includes("init")) { initCalls++; return { data: { publish_id: "provider-id", upload_url: "https://open-upload.tiktokapis.com/video/" } }; } return { data: { status: "SEND_TO_USER_INBOX" } }; },
    transfer: async () => { transfers++; },
  };
  const workflowCalls = [];
  registerTikTokRoutes(app, { getStore: () => s, getAccessStore: () => security, clientUrl: "https://corex.test", config, api,
    getWorkflowService: () => ({ uploadVideo: async (request, owner) => { workflowCalls.push({ request, owner }); return { success: true }; } }) });
  const server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  t.after(() => { server.close(); s.db.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api/tiktok`;
  const headers = { "X-Test-Role": "admin", Origin: "https://corex.test", "X-Corex-TikTok": "1", "Content-Type": "application/json" };
  const call = (path, options = {}) => fetch(base + path, { redirect: "manual", ...options });
  assert.equal((await call("/videos/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 401);
  assert.equal((await call("/videos/upload", { method: "POST", headers: { ...headers, Origin: "https://foreign.test" }, body: "{}" })).status, 403);
  assert.deepEqual(workflowCalls, []);
  assert.equal((await call("/videos/upload", { method: "POST", headers, body: JSON.stringify({ operation: "Upload to Inbox" }) })).status, 200);
  assert.deepEqual(workflowCalls, [{ request: { operation: "Upload to Inbox" }, owner: admin }]);
  assert.equal((await call("/config")).status, 401);
  assert.equal((await call("/auth/start", { method: "POST", headers: { "X-Test-Role": "admin" } })).status, 403);
  const start = await (await call("/auth/start", { method: "POST", headers, body: "{}" })).json();
  const state = new URL(start.url).searchParams.get("state");
  const callback = `/auth/callback?code=test&state=${state}`;
  const wrong = await call(callback, { headers: { ...headers, "X-Test-Session": "wrong" } }); assert.ok(wrong.headers.get("location").endsWith("failed"));
  const connected = await call(callback, { headers }); assert.ok(connected.headers.get("location").endsWith("connected"));
  assert.ok((await call(callback, { headers })).headers.get("location").endsWith("failed"));
  const info = await (await call("/config", { headers })).json(); assert.equal(info.connected, true); assert.ok(!JSON.stringify(info).includes("private-token"));
  const id = "11111111-1111-4111-8111-111111111111";
  const uploadHeaders = { ...headers, "Content-Type": "video/mp4", "Idempotency-Key": id, "X-TikTok-Account": info.accountRef };
  const body = Buffer.from("0000ftypisom0000");
  assert.equal((await call("/uploads", { method: "POST", headers: uploadHeaders, body })).status, 400);
  uploadHeaders["X-TikTok-Consent"] = "upload-to-inbox";
  assert.equal((await call("/uploads", { method: "POST", headers: { ...uploadHeaders, "X-TikTok-Account": "stale-account" }, body })).status, 409);
  assert.equal((await call("/uploads", { method: "POST", headers: uploadHeaders, body })).status, 200);
  assert.equal((await call("/uploads", { method: "POST", headers: uploadHeaders, body })).status, 200);
  assert.equal(initCalls, 1); assert.equal(transfers, 1);
  const status = await (await call(`/uploads/${id}/status`, { method: "POST", headers, body: "{}" })).json(); assert.equal(status.status, "SEND_TO_USER_INBOX");
  assert.equal((await call(`/uploads/${id}/status`, { method: "POST", headers: { ...headers, "X-Test-Role": "additional" }, body: "{}" })).status, 404);
  assert.equal((await call("/uploads", { method: "POST", headers: { ...uploadHeaders, "Idempotency-Key": "22222222-2222-4222-8222-222222222222" }, body })).status, 409);
});
