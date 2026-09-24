"use strict";
const crypto = require("node:crypto"), fs = require("node:fs/promises"), path = require("node:path");
const { CrosspostError } = require("./facebookTikTokSource");
const { movieDuration } = require("./tiktokDirect");
const key = owner => {
  if (!owner || !["admin", "child", "additional"].includes(owner.ownerType) || !owner.ownerId) throw new CrosspostError("Sign in to Corex.", 401);
  return `${owner.ownerType}:${owner.ownerId}`;
};
const decodeOwner = value => ({ ownerType: value.slice(0, value.indexOf(":")), ownerId: value.slice(value.indexOf(":") + 1) });

function createFacebookTikTokCrosspost({ db, source, tiktok, authorize, registerMedia, binaryDirectory, now = Date.now }) {
  db.exec(`CREATE TABLE IF NOT EXISTS fb_tiktok_routes (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL, credential TEXT NOT NULL, page TEXT NOT NULL, account TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0, checked INTEGER NOT NULL DEFAULT 0, message TEXT NOT NULL DEFAULT '',
    UNIQUE(owner,page,account));
    CREATE TABLE IF NOT EXISTS fb_tiktok_items (
    id TEXT PRIMARY KEY, route TEXT NOT NULL, owner TEXT NOT NULL, video TEXT NOT NULL, caption TEXT NOT NULL,
    created INTEGER NOT NULL, reference TEXT, review TEXT, status TEXT NOT NULL DEFAULT 'NEEDS_REVIEW',
    due INTEGER, downloaded INTEGER, message TEXT NOT NULL DEFAULT '', UNIQUE(route,video));
    CREATE TABLE IF NOT EXISTS fb_tiktok_locks (owner TEXT PRIMARY KEY, token TEXT NOT NULL, expires INTEGER NOT NULL);`);
  let timer, ticking = false;
  function route(owner, id, validate = true) {
    authorize(owner);
    const value = db.prepare("SELECT * FROM fb_tiktok_routes WHERE owner=? AND id=?").get(key(owner), id);
    if (!value) throw new CrosspostError("Crossposting route not found.", 404);
    if (validate) { source.validate(owner, value.credential, value.page); tiktok.connected(owner, value.account); }
    return value;
  }
  function item(owner, id) {
    authorize(owner);
    const value = db.prepare("SELECT * FROM fb_tiktok_items WHERE owner=? AND id=?").get(key(owner), id);
    if (!value) throw new CrosspostError("Crossposting video not found.", 404);
    return { value, config: route(owner, value.route) };
  }
  async function locked(owner, action) {
    authorize(owner); const token = crypto.randomUUID(), identity = key(owner);
    const result = db.prepare("INSERT INTO fb_tiktok_locks VALUES (?,?,?) ON CONFLICT(owner) DO UPDATE SET token=excluded.token,expires=excluded.expires WHERE expires<?").run(identity, token, now() + 600000, now());
    if (!result.changes) throw new CrosspostError("Another crossposting operation is running. Please wait.", 409);
    const heartbeat = setInterval(() => db.prepare("UPDATE fb_tiktok_locks SET expires=? WHERE owner=? AND token=?").run(now() + 600000, identity, token), 30000); heartbeat.unref?.();
    try { return await action(); } finally { clearInterval(heartbeat); db.prepare("DELETE FROM fb_tiktok_locks WHERE owner=? AND token=?").run(identity, token); }
  }
  const update = (owner, id, status, message = "") => db.prepare("UPDATE fb_tiktok_items SET status=?,message=? WHERE owner=? AND id=?").run(status, message, key(owner), id);
  function request(value, config) { return { operation: "Direct Post", credentialId: config.account, binaryProperty: "data", binary: { property: "data", referenceId: value.reference }, mimeType: "video/mp4", fileName: `facebook-${value.video}.mp4` }; }
  function list(owner) {
    authorize(owner);
    return { routes: db.prepare("SELECT * FROM fb_tiktok_routes WHERE owner=? ORDER BY rowid DESC").all(key(owner)).map(({ owner: unused, ...r }) => r),
      items: db.prepare("SELECT * FROM fb_tiktok_items WHERE owner=? ORDER BY created DESC LIMIT 500").all(key(owner)).map(({ owner: unused, reference, ...i }) => i) };
  }
  async function create(owner, input) {
    return locked(owner, async () => {
      if (typeof input.credential !== "string" || typeof input.page !== "string" || typeof input.account !== "string") throw new CrosspostError("Select a source Page and TikTok account.");
      source.validate(owner, input.credential, input.page); tiktok.connected(owner, input.account);
      const existing = db.prepare("SELECT id FROM fb_tiktok_routes WHERE owner=? AND page=? AND account=?").get(key(owner), input.page, input.account);
      if (existing) return { id: existing.id };
      if (db.prepare("SELECT COUNT(*) n FROM fb_tiktok_routes WHERE owner=?").get(key(owner)).n >= 5) throw new CrosspostError("Up to five crossposting routes are supported per workspace.");
      const id = crypto.randomUUID();
      db.prepare("INSERT INTO fb_tiktok_routes(id,owner,credential,page,account) VALUES (?,?,?,?,?)").run(id, key(owner), input.credential, input.page, input.account);
      return { id };
    });
  }
  async function scan(owner, id) {
    return locked(owner, async () => {
      const config = route(owner, id), result = await source.list(owner, config.credential, config.page);
      route(owner, id); // authorization may have changed during the request
      const insert = db.prepare("INSERT OR IGNORE INTO fb_tiktok_items(id,route,owner,video,caption,created) VALUES (?,?,?,?,?,?)");
      let added = 0;
      for (const video of result.videos) added += insert.run(crypto.randomUUID(), id, key(owner), video.id, video.caption, video.createdAt).changes;
      db.prepare("UPDATE fb_tiktok_routes SET checked=?,message=? WHERE owner=? AND id=?").run(now(), result.limited ? "Only the most recent 500 videos were checked. Older videos are not included." : `${added} new videos found.`, key(owner), id);
      return { added };
    });
  }
  async function review(owner, id) {
    return locked(owner, async () => {
      let { value, config } = item(owner, id);
      if (!["NEEDS_REVIEW", "READY", "REJECTED", "FAILED", "BLOCKED"].includes(value.status)) throw new CrosspostError("Cancel the schedule or resolve the existing post before reviewing again.", 409);
      if (value.review) {
        let status;
        try { status = await tiktok.direct.status(owner, value.review); }
        catch (error) { if (error.code === "tiktok_not_found" && value.status === "READY") status = { status: "REVIEW" }; else throw error; }
        if (["APPROVED", "REJECTED", "FAILED"].includes(status.status)) await tiktok.direct.cancel(owner, value.review);
        else if (status.status !== "REVIEW" && status.status !== "CANCELLED") throw new CrosspostError("This video already has an active or completed TikTok submission.", 409);
      }
      if (!value.reference) {
        if (db.prepare("SELECT COUNT(*) n FROM fb_tiktok_items WHERE owner=? AND reference IS NOT NULL").get(key(owner)).n >= 10) throw new CrosspostError("Ten videos are already downloaded. Remove a completed or unused video before downloading another.");
        const bytes = await source.download(owner, config.credential, config.page, value.video); movieDuration(bytes);
        item(owner, id);
        const reference = `bin_${crypto.randomBytes(16).toString("base64url")}`;
        await fs.mkdir(binaryDirectory, { recursive: true });
        await fs.writeFile(path.join(binaryDirectory, reference), bytes, { flag: "wx", mode: 0o600 });
        try { registerMedia({ binary: { referenceId: reference } }, owner); }
        catch (error) { await fs.unlink(path.join(binaryDirectory, reference)); throw error; }
        db.prepare("UPDATE fb_tiktok_items SET reference=?,downloaded=? WHERE owner=? AND id=?").run(reference, now(), key(owner), id);
        value = { ...value, reference };
      }
      const result = await tiktok.direct.review(request(value, config), owner);
      db.prepare("UPDATE fb_tiktok_items SET review=?,status='READY',message='',due=NULL WHERE owner=? AND id=?").run(result.id, key(owner), id);
      return { ...result, caption: value.caption };
    });
  }
  async function approve(owner, id, input) {
    return locked(owner, async () => {
      const { value } = item(owner, id);
      if (value.status !== "READY" || !value.review) throw new CrosspostError("Load this video's review first.");
      const result = await tiktok.direct.approve({ ...input, reviewId: value.review }, owner);
      update(owner, id, "APPROVED"); return result;
    });
  }
  async function schedule(owner, id, due) {
    return locked(owner, async () => {
      const { value } = item(owner, id);
      if (value.status !== "APPROVED" || !value.review) throw new CrosspostError("Review and approve this exact video before scheduling.");
      if (!Number.isSafeInteger(due) || due < now() - 60000 || due > now() + 6 * 86400000) throw new CrosspostError("Choose a time within the next six days.");
      if ((await tiktok.direct.status(owner, value.review)).status !== "APPROVED") throw new CrosspostError("The TikTok approval changed. Refresh and review again.");
      db.prepare("UPDATE fb_tiktok_items SET due=?,status='SCHEDULED',message='' WHERE owner=? AND id=?").run(due, key(owner), id);
      return { status: "SCHEDULED" };
    });
  }
  async function publish(owner, id) {
    return locked(owner, async () => {
      const { value, config } = item(owner, id);
      if (value.status !== "SCHEDULED" || value.due > now()) throw new CrosspostError("This post is not due.", 409);
      update(owner, id, "SUBMITTING");
      try {
        const result = await tiktok.direct.publish(request(value, config), owner);
        if (!result?.published || result.postStatus !== "PUBLISH_COMPLETE") throw new CrosspostError("TikTok has not confirmed publication.", 409);
        update(owner, id, "PUBLISHED"); return result;
      } catch (error) {
        let status = "OUTCOME_UNCERTAIN";
        try { status = (await tiktok.direct.status(owner, value.review)).status; } catch { /* do not resend */ }
        update(owner, id, status === "PUBLISH_COMPLETE" ? "PUBLISHED" : status === "APPROVED" ? "APPROVED" : status,
          error.code?.startsWith("tiktok_") ? error.message : "Posting did not complete. Check the connection and post status before retrying.");
        throw new CrosspostError("Posting did not complete. Refresh the queue for its status.", 409);
      }
    });
  }
  async function check(owner, id) {
    return locked(owner, async () => {
      const { value } = item(owner, id);
      if (!value.review) return { status: value.status };
      const result = await tiktok.direct.status(owner, value.review);
      if (value.status !== "SCHEDULED" || result.status !== "APPROVED") update(owner, id, result.status === "PUBLISH_COMPLETE" ? "PUBLISHED" : result.status === "REVIEW" ? "READY" : result.status === "CANCELLED" ? "NEEDS_REVIEW" : result.status);
      return result;
    });
  }
  async function cancel(owner, id, discard = false) {
    return locked(owner, async () => {
      const { value } = item(owner, id);
      if (!["NEEDS_REVIEW", "READY", "APPROVED", "SCHEDULED", "REJECTED", "FAILED", "PUBLISHED", "BLOCKED"].includes(value.status)) throw new CrosspostError("Check this submission's outcome before making changes.", 409);
      if (value.review && value.status !== "PUBLISHED") {
        let current;
        try { current = await tiktok.direct.status(owner, value.review); }
        catch (error) { if (error.code === "tiktok_not_found" && value.status === "READY") current = { status: "REVIEW" }; else throw error; }
        if (["APPROVED", "FAILED", "REJECTED"].includes(current.status)) await tiktok.direct.cancel(owner, value.review);
        else if (!["REVIEW", "CANCELLED"].includes(current.status)) throw new CrosspostError("An active submission cannot be cancelled.", 409);
      }
      if (discard && value.reference) { await fs.unlink(path.join(binaryDirectory, value.reference)).catch(error => { if (error.code !== "ENOENT") throw error; }); }
      db.prepare("UPDATE fb_tiktok_items SET status=?,due=NULL,review=?,reference=?,message='' WHERE owner=? AND id=?")
        .run(value.status === "PUBLISHED" ? "PUBLISHED" : "NEEDS_REVIEW", value.status === "PUBLISHED" ? value.review : null, discard ? null : value.reference, key(owner), id);
      return { ok: true };
    });
  }
  async function toggle(owner, id, enabled) {
    return locked(owner, async () => { route(owner, id, enabled === true); if (typeof enabled !== "boolean") throw new CrosspostError("Choose on or off.");
      db.prepare("UPDATE fb_tiktok_routes SET enabled=? WHERE owner=? AND id=?").run(enabled ? 1 : 0, key(owner), id); return { enabled }; });
  }
  async function tick() {
    if (ticking) return; ticking = true;
    try {
      for (const value of db.prepare("SELECT * FROM fb_tiktok_items WHERE status='SCHEDULED' AND due<=? ORDER BY due LIMIT 10").all(now())) {
        try { await publish(decodeOwner(value.owner), value.id); }
        catch (error) { if (error.message === "Another crossposting operation is running. Please wait.") continue;
          db.prepare("UPDATE fb_tiktok_items SET status='BLOCKED',message=? WHERE id=? AND status='SCHEDULED'").run("Scheduled post paused. Check workspace access and account connections, then review or check status before rescheduling.", value.id); }
      }
      for (const r of db.prepare("SELECT * FROM fb_tiktok_routes WHERE enabled=1 AND checked<? LIMIT 10").all(now() - 300000)) {
        try { await scan(decodeOwner(r.owner), r.id); }
        catch { db.prepare("UPDATE fb_tiktok_routes SET checked=?,message=? WHERE id=?").run(now(), "Scan unavailable. Check Page/TikTok connections and workspace access.", r.id); }
      }
      for (const value of db.prepare("SELECT * FROM fb_tiktok_items WHERE status IN ('SUBMITTING','PROCESSING_DOWNLOAD','PROCESSING_UPLOAD','INITIALIZING','OUTCOME_UNCERTAIN') LIMIT 10").all()) {
        try { await check(decodeOwner(value.owner), value.id); } catch { /* uncertain stays uncertain */ }
      }
    } finally { ticking = false; }
  }
  return { list, create, scan, review, approve, schedule, publish, check, cancel, toggle, tick,
    start() { if (!timer) { timer = setInterval(() => tick().catch(() => {}), 30000); timer.unref?.(); } },
    stop() { clearInterval(timer); timer = null; } };
}
module.exports = { createFacebookTikTokCrosspost };
