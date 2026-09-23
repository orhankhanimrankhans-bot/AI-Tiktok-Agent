"use strict";
const fs = require("node:fs/promises"), path = require("node:path"), crypto = require("node:crypto");
const { TikTokError, MAX_VIDEO_BYTES, validateVideo } = require("./tiktokApi");
const { normalizeCredentialOwner } = require("./credentialOwnership");
const { hash } = require("./tiktokStore");
const ownerKey = owner => { const w = normalizeCredentialOwner(owner); return `${w.ownerType}:${w.ownerId}`; };
const fail = (code, message, status = 400) => { throw new TikTokError(`tiktok_${code}`, message, status); };

// Direct Post accepts ISO BMFF videos with a finite movie duration. Unknown or
// fragmented metadata is rejected instead of trusting duration supplied by a browser.
function movieDuration(bytes) {
  function boxes(start, end, movie = false) {
    for (let pos = start; pos + 8 <= end;) {
      let size = bytes.readUInt32BE(pos), header = 8;
      const type = bytes.toString("ascii", pos + 4, pos + 8);
      if (size === 1) { if (pos + 16 > end) break; size = Number(bytes.readBigUInt64BE(pos + 8)); header = 16; }
      if (size === 0) size = end - pos;
      if (!Number.isSafeInteger(size) || size < header || pos + size > end) break;
      const body = pos + header;
      if (type === "moov" && !movie) { const found = boxes(body, pos + size, true); if (found) return found; }
      if (movie && type === "mvhd" && body + 20 <= pos + size) {
        const version = bytes[body];
        if (version > 1 || (version === 1 && body + 32 > pos + size)) break;
        const scale = bytes.readUInt32BE(body + (version === 1 ? 20 : 12));
        const ticks = version === 1 ? Number(bytes.readBigUInt64BE(body + 24)) : bytes.readUInt32BE(body + 16);
        const seconds = ticks / scale;
        if (Number.isFinite(seconds) && seconds > 0 && seconds <= 28800) return seconds;
      }
      pos += size;
    }
    return 0;
  }
  const duration = boxes(0, bytes.length);
  if (!duration) fail("invalid_duration", "Direct Post needs an MP4 or MOV with readable duration metadata. Export the video again.");
  return duration;
}

function postInfo(input, creator, duration, publicEnabled) {
  if (!Array.isArray(creator.privacy_level_options) || !Number.isFinite(creator.max_video_post_duration_sec)) fail("creator_unavailable", "TikTok did not provide usable posting options.", 502);
  if (duration > creator.max_video_post_duration_sec) fail("video_too_long", "This video exceeds the connected creator's current duration limit.");
  if (!creator.privacy_level_options.includes(input.privacy_level)) fail("privacy_changed", "Select an available privacy setting. Refresh the review if account settings changed.");
  if (!publicEnabled && input.privacy_level !== "SELF_ONLY") fail("audit_required", "This server is in private Direct Post testing mode. Public posting requires TikTok audit approval.");
  if (typeof input.title !== "string" || input.title.length > 2200) fail("invalid_caption", "The caption must be at most 2200 characters.");
  if (input.discloseCommercial === true && input.brand_content_toggle !== true && input.brand_organic_toggle !== true) fail("disclosure_required", "Choose Your brand or Branded content.");
  if (input.brand_content_toggle === true && input.privacy_level === "SELF_ONLY") fail("commercial_privacy", "Branded content cannot use Only me visibility.");
  const result = { title: input.title, privacy_level: input.privacy_level,
    brand_content_toggle: input.discloseCommercial === true && input.brand_content_toggle === true,
    brand_organic_toggle: input.discloseCommercial === true && input.brand_organic_toggle === true,
    is_aigc: input.is_aigc === true };
  for (const field of ["comment", "duet", "stitch"]) {
    if (typeof creator[`${field}_disabled`] !== "boolean") fail("creator_unavailable", "Refresh TikTok posting options.", 502);
    if (input[`allow_${field}`] === true && creator[`${field}_disabled`]) fail("interaction_changed", "TikTok account interaction settings changed. Review this video again.");
    result[`disable_${field}`] = input[`allow_${field}`] !== true;
  }
  return result;
}

function createTikTokDirectService({ store, api, config, binaryDirectory, requireMedia, connected, sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
  const db = store.db;
  db.exec(`CREATE TABLE IF NOT EXISTS tiktok_direct_reviews (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL, account_ref TEXT NOT NULL, file_hash TEXT NOT NULL,
    reference TEXT NOT NULL, mime TEXT NOT NULL, duration REAL NOT NULL, post_json TEXT,
    expires_at INTEGER NOT NULL, publish_id TEXT, status TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS tiktok_direct_match ON tiktok_direct_reviews(owner,account_ref,file_hash);
    CREATE TABLE IF NOT EXISTS tiktok_direct_media (token_hash TEXT PRIMARY KEY, review_id TEXT NOT NULL, expires_at INTEGER NOT NULL);`);
  const row = (owner, id) => db.prepare("SELECT * FROM tiktok_direct_reviews WHERE owner=? AND id=?").get(ownerKey(owner), id);
  async function media(reference, owner, expected) {
    if (!/^bin_[A-Za-z0-9_-]{22}$/.test(reference || "")) fail("missing_binary", "Execute Download File or Prepare Content first.");
    await requireMedia(reference, owner);
    const target = path.join(binaryDirectory, reference), stat = await fs.lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_VIDEO_BYTES) fail("invalid_video", "Choose a downloaded video up to 32 MiB.");
    const bytes = await fs.readFile(target), digest = hash(bytes);
    if (expected && expected !== digest) fail("video_changed", "The video changed. Review and authorize it again.", 409);
    return { bytes, digest };
  }
  async function creator(owner, credentialId) {
    if (!config.directPostEnabled) fail("direct_disabled", "Direct Post testing is not enabled on this server.", 503);
    let account = connected(owner, credentialId);
    account = await api.access(account); store.save(owner, account);
    if (!String(account.scopes || "").split(",").includes("video.publish")) fail("publish_scope_required", "Enable Direct Post in your TikTok app, then reconnect with Direct Post permission.", 409);
    const result = await api.request("post/publish/creator_info/query/", { token: account.accessToken });
    const info = result.data;
    if (!info?.creator_nickname || !Array.isArray(info.privacy_level_options) || !Number.isFinite(info.max_video_post_duration_sec)) fail("creator_unavailable", "TikTok did not return current creator information.", 502);
    return { account, info };
  }
  async function review(request, owner) {
    db.prepare("DELETE FROM tiktok_direct_reviews WHERE status='REVIEW' AND expires_at<?").run(Date.now());
    const { info } = await creator(owner, request.credentialId);
    const { bytes, digest } = await media(request.binary?.referenceId, owner);
    const mime = request.mimeType || "video/mp4";
    if (!["video/mp4", "video/quicktime"].includes(mime)) fail("invalid_video", "Direct Post currently supports MP4 and MOV videos.");
    validateVideo(bytes, mime); const duration = movieDuration(bytes);
    if (duration > info.max_video_post_duration_sec) fail("video_too_long", "Video exceeds TikTok's current duration limit.");
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO tiktok_direct_reviews VALUES (?,?,?,?,?,?,?,NULL,?,NULL,'REVIEW',?)")
      .run(id, ownerKey(owner), request.credentialId, digest, request.binary.referenceId, mime, duration, Date.now() + 900000, Date.now());
    return { id, creator: info, duration, publicEnabled: config.directPostPublicEnabled === true, previewUrl: `/api/tiktok/direct/reviews/${id}/preview` };
  }
  async function preview(owner, id) {
    const value = row(owner, id);
    if (!value || value.expires_at <= Date.now()) fail("review_expired", "Review expired. Load the video again.", 404);
    connected(owner, value.account_ref);
    return { ...(await media(value.reference, owner, value.file_hash)), mime: value.mime };
  }
  async function approve(request, owner) {
    const value = row(owner, request.reviewId);
    if (!value || value.status !== "REVIEW" || value.expires_at <= Date.now()) fail("review_expired", "Load a fresh review before approving this video.", 409);
    if (request.consent !== true || request.musicConsent !== true) fail("consent_required", "Review this video and accept the music usage confirmation before authorizing it.");
    const { info } = await creator(owner, value.account_ref);
    await media(value.reference, owner, value.file_hash);
    const details = postInfo(request, info, value.duration, config.directPostPublicEnabled);
    const existing = db.prepare("SELECT id FROM tiktok_direct_reviews WHERE owner=? AND account_ref=? AND file_hash=? AND status NOT IN ('REVIEW','CANCELLED')").get(ownerKey(owner), value.account_ref, value.file_hash);
    if (existing) fail("already_reviewed", "This video already has a Direct Post approval or submission. Check its status before submitting again.", 409);
    db.prepare("UPDATE tiktok_direct_reviews SET post_json=?,status='APPROVED',expires_at=? WHERE id=? AND owner=? AND status='REVIEW'")
      .run(JSON.stringify(details), Date.now() + 7 * 86400000, value.id, ownerKey(owner));
    return { id: value.id, status: "APPROVED", message: "This exact video and caption are approved for one Direct Post on a manual or scheduled workflow run within 7 days." };
  }
  function recent(owner) { return db.prepare("SELECT id,status,created_at,expires_at,post_json FROM tiktok_direct_reviews WHERE owner=? AND status<>'REVIEW' ORDER BY created_at DESC LIMIT 20").all(ownerKey(owner)).map(({ post_json, ...value }) => ({ ...value, post: JSON.parse(post_json || "{}") })); }
  function cancel(owner, id) {
    const changed = db.prepare("UPDATE tiktok_direct_reviews SET status='CANCELLED' WHERE owner=? AND id=? AND status IN ('APPROVED','REJECTED','FAILED')").run(ownerKey(owner), id);
    if (!changed.changes) fail("cannot_cancel", "Only approvals that have not been submitted can be cancelled.", 409);
    return { status: "CANCELLED" };
  }
  async function status(owner, id) {
    let value = row(owner, id);
    if (!value) fail("not_found", "Direct Post not found.", 404);
    let account = connected(owner, value.account_ref);
    if (!value.publish_id || ["PUBLISH_COMPLETE", "FAILED"].includes(value.status)) return { id, status: value.status };
    account = await api.access(account); store.save(owner, account);
    const result = await api.request("post/publish/status/fetch/", { token: account.accessToken, body: { publish_id: value.publish_id } });
    const current = result.data?.status;
    if (!["PROCESSING_UPLOAD", "PROCESSING_DOWNLOAD", "PUBLISH_COMPLETE", "FAILED"].includes(current)) fail("unknown_status", "TikTok has not confirmed Direct Post publication. Source retained.", 502);
    db.prepare("UPDATE tiktok_direct_reviews SET status=? WHERE owner=? AND id=?").run(current, ownerKey(owner), id);
    return { id, status: current };
  }
  async function publish(request, owner) {
    connected(owner, request.credentialId);
    if (!config.directPostEnabled) fail("direct_disabled", "Direct Post is not enabled.", 503);
    if (!/^[A-Za-z_$][\w$]{0,63}$/.test(request.binaryProperty || "data") || request.binary?.property !== (request.binaryProperty || "data")) fail("missing_binary", "Select the input video's binary property.");
    if (!store.lock(owner)) fail("busy", "Another TikTok operation is in progress.", 409);
    const deadline = Date.now() + 240000;
    try {
      const { digest } = await media(request.binary?.referenceId, owner);
      let value = db.prepare("SELECT * FROM tiktok_direct_reviews WHERE owner=? AND account_ref=? AND file_hash=? AND status NOT IN ('REVIEW','CANCELLED') ORDER BY created_at DESC LIMIT 1").get(ownerKey(owner), request.credentialId, digest);
      if (!value) fail("review_required", "Open the TikTok node and review this exact video for Direct Post. No video was sent.", 409);
      if (value.status === "APPROVED") {
        if (value.expires_at <= Date.now()) fail("approval_expired", "Cancel the expired approval and review the video again.", 409);
        const { account, info } = await creator(owner, request.credentialId);
        const approved = JSON.parse(value.post_json);
        // Revalidate current creator limits without silently changing approved settings.
        postInfo({ ...approved, discloseCommercial: approved.brand_content_toggle || approved.brand_organic_toggle,
          allow_comment: !approved.disable_comment, allow_duet: !approved.disable_duet, allow_stitch: !approved.disable_stitch }, info, value.duration, config.directPostPublicEnabled);
        const token = crypto.randomBytes(32).toString("base64url");
        db.prepare("DELETE FROM tiktok_direct_media WHERE expires_at<?").run(Date.now());
        db.prepare("INSERT INTO tiktok_direct_media VALUES (?,?,?)").run(hash(token), value.id, Date.now() + 3600000);
        // Durable transition BEFORE a consequential provider request. Lost responses
        // remain uncertain, and neither another execution nor restart can repost.
        const claimed = db.prepare("UPDATE tiktok_direct_reviews SET status='INITIALIZING',reference=? WHERE id=? AND owner=? AND status='APPROVED'").run(request.binary.referenceId, value.id, ownerKey(owner));
        if (!claimed.changes) fail("approval_changed", "Approval changed. Refresh its status.", 409);
        try {
          const videoUrl = new URL(`/api/tiktok/media/${token}`, config.redirectUri).href;
          const result = await api.request("post/publish/video/init/", { token: account.accessToken, body: { post_info: approved, source_info: { source: "PULL_FROM_URL", video_url: videoUrl } } });
          if (!result.data?.publish_id) fail("invalid_response", "TikTok did not return a post tracking ID.", 502);
          db.prepare("UPDATE tiktok_direct_reviews SET publish_id=?,status='PROCESSING_DOWNLOAD' WHERE id=?").run(result.data.publish_id, value.id);
        } catch (error) {
          const rejected = ["tiktok_unaudited_client_can_only_post_to_private_accounts", "tiktok_url_ownership_unverified", "tiktok_privacy_level_option_mismatch", "tiktok_reached_active_user_cap", "tiktok_spam_risk_too_many_posts", "scope_not_authorized", "access_token_invalid"].includes(error.code);
          db.prepare("UPDATE tiktok_direct_reviews SET status=? WHERE id=?").run(rejected ? "REJECTED" : "OUTCOME_UNCERTAIN", value.id);
          throw error;
        }
      }
      let result;
      for (let attempt = 0; attempt < 8; attempt++) {
        result = await status(owner, value.id);
        if (["PUBLISH_COMPLETE", "FAILED", "REJECTED", "OUTCOME_UNCERTAIN", "INITIALIZING"].includes(result.status) || Date.now() + 32000 >= deadline) break;
        if (attempt < 7) await sleep(2000);
      }
      if (result.status !== "PUBLISH_COMPLETE") fail("post_pending", `Direct Post status: ${result.status}. Check status before retrying. Source video retained.`, 409);
      return { success: true, provider: "tiktok", status: "direct_published", published: true, postStatus: "PUBLISH_COMPLETE", uploadId: value.id,
        sourceFileId: request.sourceFileId || "", sourceFileName: request.sourceFileName || request.fileName || "", message: "TikTok reports publication complete. It may take a few minutes to appear on the profile." };
    } finally { store.unlock(owner); }
  }
  async function publicMedia(token) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token || "")) fail("not_found", "Not found.", 404);
    const value = db.prepare("SELECT r.* FROM tiktok_direct_media m JOIN tiktok_direct_reviews r ON r.id=m.review_id WHERE m.token_hash=? AND m.expires_at>?").get(hash(token), Date.now());
    if (!value || !["INITIALIZING", "PROCESSING_DOWNLOAD", "PROCESSING_UPLOAD", "OUTCOME_UNCERTAIN"].includes(value.status)) fail("not_found", "Not found.", 404);
    const separator = value.owner.indexOf(":"), owner = { ownerType: value.owner.slice(0, separator), ownerId: value.owner.slice(separator + 1) };
    connected(owner, value.account_ref);
    return { ...(await media(value.reference, owner, value.file_hash)), mime: value.mime };
  }
  function remove(owner) {
    db.prepare("DELETE FROM tiktok_direct_media WHERE review_id IN (SELECT id FROM tiktok_direct_reviews WHERE owner=?)").run(ownerKey(owner));
    db.prepare("DELETE FROM tiktok_direct_reviews WHERE owner=?").run(ownerKey(owner));
  }
  return { review, preview, approve, recent, cancel, status, publish, publicMedia, remove };
}
module.exports = { createTikTokDirectService, movieDuration, postInfo };
