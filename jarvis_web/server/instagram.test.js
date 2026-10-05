const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs/promises"), os = require("node:os"), path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { InstagramStore, ownerKey } = require("./instagramStore");
const { createInstagramWorkflowService, accountRef } = require("./instagramWorkflow");
const { authorizeInstagramOwner } = require("./instagramAccess");
const { InstagramApi } = require("./instagramApi");
const owner = { ownerType: "additional", ownerId: "alice" }, other = { ownerType: "additional", ownerId: "bob" };
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "corex-instagram-")), store = new InstagramStore(new DatabaseSync(":memory:"), "test-secret");
  t.after(async () => { store.db.close(); await fs.rm(dir, { recursive: true }); });
  const account = { id: "12345", name: "creator", revision: "revision", accessToken: "private-token", expiresAt: Date.now() + 86400000 };
  store.save(owner, "config", { revision: "revision", appId: "98765", appSecret: "private-app-secret" }); store.save(owner, "account", account);
  const reference = "bin_abcdefghijklmnopqrstuv", bytes = Buffer.from("0000ftypisom0000"); await fs.writeFile(path.join(dir, reference), bytes);
  const request = { operation: "Publish Reel", credentialId: accountRef(owner, account), publishConsent: true, caption: "Caption", shareToFeed: true, binaryProperty: "data", binary: { property: "data", referenceId: reference }, sourceFileId: "drive-original" };
  const calls = []; let state = "FINISHED", revoked = false, mediaAllowed = true, capability;
  const api = { access: async a => a, graph: async (endpoint, token, form) => {
    calls.push(endpoint); assert.equal(token, "private-token");
    if (endpoint.endsWith("/media")) { capability = new URL(form.video_url).pathname.split("/").at(-1); return { id: "777" }; }
    if (endpoint.endsWith("/media_publish")) return { id: "888" };
    return { status_code: state };
  } };
  const service = createInstagramWorkflowService({ store, binaryDirectory: dir, clientUrl: "https://corex.test", api, sleep: async () => {}, authorizeOwner: o => { assert.deepEqual(o, owner); if (revoked) throw Error("revoked"); }, requireMedia: (ref, o) => { assert.deepEqual(o, owner); assert.equal(ref, reference); if (!mediaAllowed) throw Error("foreign media"); } });
  return { store, service, api, request, calls, bytes, account, setState: s => state = s, revoke: () => revoked = true, denyMedia: () => mediaAllowed = false, capability: () => capability };
}
test("confirmed publication preserves source and deduplicates repeat and concurrent runs", async t => {
  const f = await fixture(t), results = await Promise.allSettled([f.service.publishReel(f.request, owner), f.service.publishReel(f.request, owner)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  const result = results.find(r => r.status === "fulfilled").value;
  assert.equal(result.mediaId, "888"); assert.equal(result.sourceFileId, "drive-original"); assert.equal(result.reused, false);
  assert.equal((await f.service.publishReel(f.request, owner)).reused, true);
  assert.equal(f.calls.filter(x => x.endsWith("/media_publish")).length, 1);
  assert.doesNotMatch(JSON.stringify(result), /private-token|accessToken|appSecret/);
  await assert.rejects(f.service.publicMedia(f.capability()));
});
test("processing retry checks the existing container and capabilities expire or revoke", async t => {
  const f = await fixture(t); f.setState("IN_PROGRESS");
  await assert.rejects(f.service.publishReel(f.request, owner), e => e.code === "instagram_processing");
  assert.deepEqual(await f.service.publicMedia(f.capability()), f.bytes);
  await assert.rejects(f.service.publicMedia("invalid"));
  f.store.db.prepare("UPDATE instagram_media SET expires=0").run(); await assert.rejects(f.service.publicMedia(f.capability()));
  f.setState("FINISHED"); assert.equal((await f.service.publishReel(f.request, owner)).status, "published");
  assert.equal(f.calls.filter(x => x.endsWith("/media")).length, 1);
});
test("uncertain create or publish never resubmits after a retry", async t => {
  for (const failing of ["/media", "/media_publish"]) {
    const f = await fixture(t), original = f.api.graph; let count = 0;
    f.api.graph = async (...args) => { if (args[0].endsWith(failing)) { count++; throw Error("network timeout"); } return original(...args); };
    await assert.rejects(f.service.publishReel(f.request, owner));
    await assert.rejects(f.service.publishReel(f.request, owner), e => e.code === "instagram_outcome_uncertain"); assert.equal(count, 1);
  }
});
test("missing consent, wrong account, foreign media, changed settings and revoked access are blocked", async t => {
  const f = await fixture(t);
  await assert.rejects(f.service.publishReel({ ...f.request, publishConsent: false }, owner));
  await assert.rejects(f.service.publishReel({ ...f.request, credentialId: accountRef(other, f.account) }, owner));
  await assert.rejects(f.service.publishReel({ ...f.request, binary: { ...f.request.binary, referenceId: "../other" } }, owner));
  assert.equal(f.calls.length, 0);
  f.setState("IN_PROGRESS"); await assert.rejects(f.service.publishReel(f.request, owner));
  const count = f.calls.length; await assert.rejects(f.service.publishReel({ ...f.request, caption: "changed" }, owner), e => e.code === "instagram_settings_changed"); assert.equal(f.calls.length, count);
  f.denyMedia(); await assert.rejects(f.service.publishReel(f.request, owner), /foreign media/);
  f.revoke(); await assert.rejects(f.service.publicMedia(f.capability()), /revoked/);
});
test("provider errors, unknown state and missing post ID cannot report publication", async t => {
  for (const state of ["ERROR", "EXPIRED", "PUBLISHED", "UNKNOWN"]) {
    const f = await fixture(t); f.setState(state); await assert.rejects(f.service.publishReel(f.request, owner)); assert.ok(!f.calls.some(x => x.endsWith("/media_publish")));
  }
  const f = await fixture(t), original = f.api.graph;
  f.api.graph = async (...args) => args[0].endsWith("/media_publish") ? {} : original(...args);
  await assert.rejects(f.service.publishReel(f.request, owner)); await assert.rejects(f.service.publishReel(f.request, owner), e => e.code === "instagram_outcome_uncertain");
});
test("encrypted credentials and OAuth state are bound to workspace, session, revision and one use", async t => {
  const f = await fixture(t);
  assert.equal(f.store.get(other, "account"), null); assert.throws(() => ownerKey({}));
  assert.doesNotMatch(JSON.stringify(f.store.db.prepare("SELECT * FROM instagram_private").all()), /private-token|private-app-secret/);
  const state = f.store.begin(owner, "session", "revision");
  assert.equal(f.store.consume(state, other, "session", "revision"), false);
  assert.equal(f.store.consume(state, owner, "wrong", "revision"), false);
  assert.equal(f.store.consume(state, owner, "session", "wrong"), false);
  assert.equal(f.store.consume(state, owner, "session", "revision"), true);
  assert.equal(f.store.consume(state, owner, "session", "revision"), false);
  await f.service.publishReel(f.request, owner); f.store.removeAccount(owner);
  assert.equal(f.store.db.prepare("SELECT count(*) n FROM instagram_posts").get().n, 1);
});
test("all workspace roles use their existing permissions without granting access", () => {
  let enabled = true;
  const store = { securityState: () => "enabled", childAccount: () => ({ enabled, permissions: { manage_workflow_credentials: true, run_workflow: true } }), getChild: id => ({ enabled, permissions: { edit_workflow: id === "alice", run_workflow: true } }) };
  for (const workspace of [owner, { ownerType: "admin", ownerId: "primary" }, { ownerType: "child", ownerId: "primary" }]) assert.doesNotThrow(() => authorizeInstagramOwner(store, workspace));
  assert.throws(() => authorizeInstagramOwner(store, other)); assert.throws(() => authorizeInstagramOwner(store, { ownerType: "admin", ownerId: "foreign" }));
  enabled = false; assert.throws(() => authorizeInstagramOwner(store, owner));
});
test("provider errors never expose tokens or raw responses and token exchange stays on official endpoints", async () => {
  const api = new InstagramApi({ fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ error: { message: "private-token", code: 190 } }) }) });
  await assert.rejects(api.graph("123/media", "secret"), e => e.code === "instagram_reconnect" && !/private-token|secret/.test(e.message));
  const urls = [], responses = [{ access_token: "short" }, { access_token: "long", expires_in: 5000000 }, { user_id: "123", username: "creator" }];
  const success = new InstagramApi({ fetchImpl: async (url, options) => { urls.push([String(url), options]); return { ok: true, json: async () => responses.shift() }; } });
  const account = await success.exchange({ appId: "123", appSecret: "secret", revision: "r" }, "code", "https://corex.test/api/instagram/auth/callback");
  assert.equal(account.id, "123"); assert.equal(urls[0][0], "https://api.instagram.com/oauth/access_token"); assert.equal(urls[2][1].headers.Authorization, "Bearer long"); assert.equal(urls[0][1].redirect, "error");
});
