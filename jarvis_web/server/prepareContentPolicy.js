"use strict";
const { DatabaseSync } = require("node:sqlite");
const { randomUUID } = require("node:crypto");
const { PrepareContentError } = require("./openaiPrepareContent");

function workspace(owner) {
  if (!owner || !["admin", "child", "additional"].includes(owner.ownerType) || !String(owner.ownerId || "").trim()) {
    throw new PrepareContentError(401, "authentication_required", "Sign in to use Prepare Content.");
  }
  return [owner.ownerType, String(owner.ownerId)];
}
function limit(value, fallback) {
  if (value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error("Prepare Content limits must be positive integers.");
  return number;
}
class PrepareContentPolicy {
  constructor(dbPath, { env = process.env, now = Date.now } = {}) {
    this.now = now;
    this.daily = limit(env.PREPARE_CONTENT_DAILY_LIMIT, 50);
    this.perOwner = limit(env.PREPARE_CONTENT_WORKSPACE_CONCURRENCY, 2);
    this.global = limit(env.PREPARE_CONTENT_GLOBAL_CONCURRENCY, 4);
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS prepare_media_owners (reference TEXT PRIMARY KEY, owner_type TEXT NOT NULL, owner_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS prepare_usage (owner_type TEXT NOT NULL, owner_id TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(owner_type,owner_id,day));
      CREATE TABLE IF NOT EXISTS prepare_leases (id TEXT PRIMARY KEY, owner_type TEXT NOT NULL, owner_id TEXT NOT NULL, heartbeat INTEGER NOT NULL);`);
  }
  register(result, owner) {
    const identity = workspace(owner);
    this.db.prepare("INSERT INTO prepare_media_owners VALUES (?,?,?)").run(result.binary.referenceId, ...identity);
    return result;
  }
  requireMedia(reference, owner) {
    const identity = workspace(owner);
    if (!this.db.prepare("SELECT 1 FROM prepare_media_owners WHERE reference=? AND owner_type=? AND owner_id=?").get(reference || "", ...identity)) {
      throw new PrepareContentError(404, "binary_not_found", "Video unavailable in this workspace. Download it again.");
    }
    return identity;
  }
  async run(reference, owner, action) {
    const identity = this.requireMedia(reference, owner), id = randomUUID(), now = this.now();
    const day = new Date(now).toISOString().slice(0, 10);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM prepare_leases WHERE heartbeat < ?").run(now - 120000);
      this.db.prepare("DELETE FROM prepare_usage WHERE day < ?").run(new Date(now - 7 * 86400000).toISOString().slice(0, 10));
      const total = this.db.prepare("SELECT count(*) AS n FROM prepare_leases").get().n;
      const active = this.db.prepare("SELECT count(*) AS n FROM prepare_leases WHERE owner_type=? AND owner_id=?").get(...identity).n;
      if (total >= this.global || active >= this.perOwner) throw new PrepareContentError(429, "prepare_content_busy", "Prepare Content is busy. Try again after an active request finishes.");
      const used = this.db.prepare("SELECT count FROM prepare_usage WHERE owner_type=? AND owner_id=? AND day=?").get(...identity, day)?.count || 0;
      if (used >= this.daily) throw new PrepareContentError(429, "prepare_content_daily_limit", "This workspace reached its daily Prepare Content limit. Try again after midnight UTC.");
      this.db.prepare("INSERT INTO prepare_usage VALUES (?,?,?,1) ON CONFLICT(owner_type,owner_id,day) DO UPDATE SET count=count+1").run(...identity, day);
      this.db.prepare("INSERT INTO prepare_leases VALUES (?,?,?,?)").run(id, ...identity, now);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    const heartbeat = setInterval(() => {
      try { this.db.prepare("UPDATE prepare_leases SET heartbeat=? WHERE id=?").run(this.now(), id); } catch { /* Lease expires after worker loss. */ }
    }, 15000);
    heartbeat.unref();
    try { return await action(); }
    finally { clearInterval(heartbeat); this.db.prepare("DELETE FROM prepare_leases WHERE id=?").run(id); }
  }
  close() { this.db.close(); }
}
module.exports = { PrepareContentPolicy };
