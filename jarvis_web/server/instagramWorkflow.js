"use strict";
const fs = require("node:fs/promises"), path = require("node:path"), crypto = require("node:crypto");
const { InstagramApi, InstagramError } = require("./instagramApi");
const { digest, ownerKey } = require("./instagramStore");
const MAX_VIDEO_BYTES = 128 * 1024 * 1024;
const fail = (code, message, status = 400) => { throw new InstagramError(code, message, status); };
const accountRef = (owner, account) => digest(JSON.stringify([ownerKey(owner), account.id, account.revision]));

function createInstagramWorkflowService({ store, binaryDirectory, requireMedia, authorizeOwner, clientUrl, api = new InstagramApi(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const origin = new URL(clientUrl).origin;
  const row = (owner, id) => store.db.prepare("SELECT * FROM instagram_posts WHERE owner=? AND id=?").get(ownerKey(owner), id);
  function connected(owner, reference) {
    authorizeOwner(owner);
    const config = store.get(owner, "config"), account = store.get(owner, "account");
    if (!config) fail("not_configured", "Set up an Instagram app in this workspace first.", 409);
    if (!account || config.revision !== account.revision || accountRef(owner, account) !== reference) fail("not_connected", "Connect and select your Instagram account again.", 409);
    return account;
  }
  async function exclusive(owner, operation) {
    authorizeOwner(owner);
    const token = store.lock(owner);
    if (!token) fail("busy", "Another Instagram operation is running. Wait before retrying.", 409);
    let valid = true;
    const timer = setInterval(() => { try { valid = store.renew(owner, token); } catch { valid = false; } }, 20000);
    timer.unref?.();
    const guard = () => { authorizeOwner(owner); if (!valid || !store.renew(owner, token)) fail("lock_lost", "Instagram operation stopped safely. Check the existing submission.", 409); };
    try { return await operation(guard); } finally { clearInterval(timer); store.unlock(owner, token); }
  }
  async function media(reference, owner) {
    if (!/^bin_[A-Za-z0-9_-]{22}$/.test(reference)) fail("missing_binary", "Connect Download File or Prepare Content to supply a video.");
    await requireMedia(reference, owner);
    const target = path.join(binaryDirectory, reference), stat = await fs.lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 12 || stat.size > MAX_VIDEO_BYTES) fail("invalid_video", "Choose an MP4 or MOV video up to 128 MiB.");
    const bytes = await fs.readFile(target);
    if (bytes.subarray(4, 8).toString() !== "ftyp") fail("invalid_video", "Instagram requires an MP4 or MOV video.");
    return bytes;
  }
  async function publicMedia(token) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) fail("not_found", "Not found.", 404);
    const job = store.db.prepare("SELECT p.* FROM instagram_media m JOIN instagram_posts p ON p.id=m.job WHERE m.token=? AND m.expires>? AND p.status IN ('CREATING','PROCESSING','PUBLISHING')").get(digest(token), Date.now());
    if (!job) fail("not_found", "Not found.", 404);
    const split = job.owner.indexOf(":"), owner = { ownerType: job.owner.slice(0, split), ownerId: job.owner.slice(split + 1) };
    authorizeOwner(owner);
    const account = store.get(owner, "account");
    if (!account || account.id !== job.account) fail("not_found", "Not found.", 404);
    const bytes = await media(job.reference, owner);
    if (digest(bytes) !== job.digest) fail("not_found", "Not found.", 404);
    return bytes;
  }
  async function publishReel(request, owner) {
    return exclusive(owner, async guard => {
      let account = connected(owner, request?.credentialId);
      if (request?.operation !== "Publish Reel" || request.publishConsent !== true) fail("consent_required", "Open the Instagram node and authorize publishing to the selected account.");
      const reference = String(request.binary?.referenceId || ""), property = String(request.binaryProperty || "data");
      if (!/^[A-Za-z_$][\w$]{0,63}$/.test(property) || request.binary?.property !== property) fail("missing_binary", "Select the downloaded video's binary property.");
      const caption = String(request.caption || "");
      if (Array.from(caption).length > 2200) fail("caption_length", "Instagram captions must be no more than 2,200 characters.");
      const bytes = await media(reference, owner), fingerprint = digest(bytes), key = ownerKey(owner);
      let job = store.db.prepare("SELECT * FROM instagram_posts WHERE owner=? AND account=? AND digest=?").get(key, account.id, fingerprint);
      const result = () => ({ success: true, provider: "instagram", status: "published", mediaId: job.media_id, accountName: account.name,
        sourceFileId: request.sourceFileId || "", sourceFileName: request.sourceFileName || request.fileName || "", reused: true });
      if (job?.status === "PUBLISHED" && job.media_id) return result();
      if (job && ["CREATING", "PUBLISHING", "UNCERTAIN", "FAILED"].includes(job.status)) fail("outcome_uncertain", "An earlier Instagram submission needs review. Check Instagram before any new upload; no duplicate was sent.", 409);
      if (job && (job.caption !== caption || job.share_feed !== Number(request.shareToFeed !== false))) fail("settings_changed", "This video already has a pending submission with different settings. Restore its original caption and feed setting to check it.", 409);
      account = await api.access(account); guard(); store.save(owner, "account", account);
      if (!job) {
        if (new URL(origin).protocol !== "https:") fail("https_required", "Instagram publishing requires the deployed HTTPS Corex address.");
        const id = crypto.randomUUID(), capability = crypto.randomBytes(32).toString("base64url");
        store.db.prepare("DELETE FROM instagram_media WHERE expires<?").run(Date.now());
        store.db.prepare("INSERT INTO instagram_posts VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(key, account.id, fingerprint, id, reference, caption, Number(request.shareToFeed !== false), "CREATING", null, null, Date.now());
        // Capability is random, short-lived, bound to this exact content, and stored hashed.
        store.db.prepare("INSERT INTO instagram_media VALUES(?,?,?)").run(digest(capability), id, Date.now() + 3600000);
        job = row(owner, id);
        try {
          guard();
          const created = await api.graph(`${account.id}/media`, account.accessToken, { media_type: "REELS", video_url: `${origin}/api/instagram/media/${capability}`, caption, share_to_feed: String(request.shareToFeed !== false) });
          if (!/^\d+$/.test(String(created.id || ""))) fail("missing_container", "Instagram did not return a tracking ID. Check your account before retrying.", 502);
          store.db.prepare("UPDATE instagram_posts SET status='PROCESSING',container=? WHERE owner=? AND id=?").run(String(created.id), key, id);
          job = row(owner, id);
        } catch (error) { store.db.prepare("UPDATE instagram_posts SET status='UNCERTAIN' WHERE owner=? AND id=?").run(key, id); throw error; }
      }
      for (let attempt = 0; attempt < 6; attempt++) {
        guard();
        const state = await api.graph(`${job.container}?fields=status_code`, account.accessToken);
        if (state.status_code === "FINISHED") {
          guard();
          store.db.prepare("UPDATE instagram_posts SET status='PUBLISHING' WHERE owner=? AND id=?").run(key, job.id);
          // Never repeat media_publish after an uncertain response, even after restart.
          try {
            const published = await api.graph(`${account.id}/media_publish`, account.accessToken, { creation_id: job.container });
            if (!/^\d+$/.test(String(published.id || ""))) fail("missing_result", "Instagram did not confirm a post ID. Check your account; the source file is retained.", 502);
            store.db.prepare("UPDATE instagram_posts SET status='PUBLISHED',media_id=? WHERE owner=? AND id=?").run(String(published.id), key, job.id);
            store.db.prepare("DELETE FROM instagram_media WHERE job=?").run(job.id);
            job = row(owner, job.id); return { ...result(), reused: false };
          } catch (error) { store.db.prepare("UPDATE instagram_posts SET status='UNCERTAIN' WHERE owner=? AND id=?").run(key, job.id); throw error; }
        }
        if (["ERROR", "EXPIRED", "PUBLISHED"].includes(state.status_code)) {
          store.db.prepare("UPDATE instagram_posts SET status=? WHERE owner=? AND id=?").run(state.status_code === "PUBLISHED" ? "UNCERTAIN" : "FAILED", key, job.id);
          fail("processing_failed", "Instagram could not confirm this Reel's publication. Check Instagram; the source file is retained.", 409);
        }
        if (state.status_code !== "IN_PROGRESS") fail("unknown_status", "Instagram returned an unknown processing status. The source file is retained.", 502);
        if (attempt < 5) await sleep(3000);
      }
      fail("processing", "Instagram is still processing this video. Execute this node again to check the same submission; the source file is retained.", 409);
    });
  }
  return { publishReel, publicMedia, exclusive, connected };
}
module.exports = { createInstagramWorkflowService, accountRef, MAX_VIDEO_BYTES };
