"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { PrepareContentPolicy } = require("./prepareContentPolicy");
const a = { ownerType: "additional", ownerId: "a" }, b = { ownerType: "additional", ownerId: "b" };
function setup(t, env = {}, now = Date.now) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prepare-policy-"));
  const db = path.join(dir, "policy.sqlite3");
  const first = new PrepareContentPolicy(db, { env, now }), second = new PrepareContentPolicy(db, { env, now });
  first.register({ binary: { referenceId: "video-a" } }, a);
  first.register({ binary: { referenceId: "video-b" } }, b);
  t.after(() => { first.close(); second.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { first, second };
}
test("media ownership rejects foreign, missing and legacy unregistered references before provider work", async t => {
  const { first, second } = setup(t); let calls = 0;
  for (const [ref, owner, code] of [["video-a", b, "binary_not_found"], ["legacy", a, "binary_not_found"], ["video-a", null, "authentication_required"]]) {
    await assert.rejects(first.run(ref, owner, () => ++calls), { code });
  }
  assert.equal(calls, 0);
  assert.equal(await second.run("video-a", a, () => "owned"), "owned");
});
test("daily budget is persistent across connections, counts failed attempts, and resets at UTC midnight", async t => {
  let now = Date.UTC(2026, 8, 18, 23, 59);
  const { first, second } = setup(t, { PREPARE_CONTENT_DAILY_LIMIT: "2" }, () => now);
  await first.run("video-a", a, () => "ok");
  await assert.rejects(second.run("video-a", a, () => { throw new Error("provider"); }), /provider/);
  await assert.rejects(first.run("video-a", a, () => "no"), { code: "prepare_content_daily_limit" });
  assert.equal(await second.run("video-b", b, () => "other"), "other");
  now += 120000;
  assert.equal(await first.run("video-a", a, () => "new day"), "new day");
});
test("global and workspace concurrency apply across connections and release after completion", async t => {
  const { first, second } = setup(t, { PREPARE_CONTENT_GLOBAL_CONCURRENCY: "2", PREPARE_CONTENT_WORKSPACE_CONCURRENCY: "1" });
  let finishA, finishB;
  const runA = first.run("video-a", a, () => new Promise(r => finishA = r));
  await assert.rejects(second.run("video-a", a, () => "no"), { code: "prepare_content_busy" });
  const runB = second.run("video-b", b, () => new Promise(r => finishB = r));
  const c = { ownerType: "admin", ownerId: "primary" };
  first.register({ binary: { referenceId: "video-c" } }, c);
  await assert.rejects(first.run("video-c", c, () => "no"), { code: "prepare_content_busy" });
  finishA("a"); finishB("b"); await Promise.all([runA, runB]);
  assert.equal(await second.run("video-c", c, () => "ok"), "ok");
});
test("abandoned leases expire while usage remains charged", async t => {
  let now = 0;
  const { first } = setup(t, { PREPARE_CONTENT_GLOBAL_CONCURRENCY: "1" }, () => now);
  first.db.prepare("INSERT INTO prepare_leases VALUES ('abandoned','additional','b',0)").run();
  await assert.rejects(first.run("video-a", a, () => "no"), { code: "prepare_content_busy" });
  now = 120001;
  assert.equal(await first.run("video-a", a, () => "ok"), "ok");
});
