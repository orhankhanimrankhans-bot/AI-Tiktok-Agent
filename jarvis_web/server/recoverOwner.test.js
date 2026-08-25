"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { AccessControlStore } = require("./accessControl");
const { recoverOwner } = require("./recoverOwner");

function makeStore(t) { const file = path.join(os.tmpdir(), `jarvis-owner-recovery-${crypto.randomUUID()}.sqlite`); const db = new DatabaseSync(file); const store = new AccessControlStore({ db }); store.open(); t.after(() => { db.close(); fs.rmSync(file, { force: true }); }); return store; }

test("owner recovery refuses production before changing data", async (t) => { const store = makeStore(t); await store.setup("original password", 0, "old@example.test"); await assert.rejects(() => recoverOwner({ store, email: "new@example.test", password: "replacement password", confirmPassword: "replacement password", env: { NODE_ENV: "production" } }), /disabled in production/); assert.equal(store.ownerAccount().email, "old@example.test"); assert.equal(await store.verifyAdmin("original password"), true); });
test("owner recovery validates email and password confirmation", async (t) => { const store = makeStore(t); await store.setup("original password", 0, "old@example.test"); await assert.rejects(() => recoverOwner({ store, email: "invalid", password: "replacement password", confirmPassword: "replacement password", env: {} }), /valid email/); await assert.rejects(() => recoverOwner({ store, email: "new@example.test", password: "replacement password", confirmPassword: "different password", env: {} }), /do not match/); });
test("owner recovery hashes password, increments auth version, and revokes only Admin sessions", async (t) => { const store = makeStore(t); await store.setup("original password", 0, "old@example.test"); const before = store.settings(); const adminSession = store.createSession("admin", { authVersion: before.auth_version }); const childSession = store.createSession("child", { authVersion: 1 }); const additionalSession = store.createSession("additional", { profileId: "profile_1", authVersion: 1 }); await recoverOwner({ store, email: " New@Example.test ", password: "replacement password", confirmPassword: "replacement password", env: { NODE_ENV: "development" } }); const after = store.settings(); assert.equal(after.owner_email, "new@example.test"); assert.equal(after.auth_version, before.auth_version + 1); assert.match(after.admin_password_hash, /^scrypt\$16384\$8\$1\$/); assert.notEqual(after.admin_password_hash, "replacement password"); assert.equal(await store.verifyAdmin("replacement password"), true); assert.ok(store.sessionRecord(adminSession).revoked_at); assert.equal(store.sessionRecord(childSession).revoked_at, null); assert.equal(store.sessionRecord(additionalSession).revoked_at, null); });
