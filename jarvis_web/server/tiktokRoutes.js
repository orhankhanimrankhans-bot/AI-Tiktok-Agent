"use strict";
const express = require("express");
const { TikTokApi, TikTokError, MAX_VIDEO_BYTES, configFromEnv, validateVideo } = require("./tiktokApi");
const { hash } = require("./tiktokStore");
const { workflowWorkspace, sessionIdentity, hasPermission } = require("./accessControl");

function registerTikTokRoutes(app, { getStore, getAccessStore, getWorkflowService, clientUrl, config = configFromEnv(), api = new TikTokApi(config) }) {
  const router = express.Router(), origin = new URL(clientUrl).origin;
  const configHash = hash(JSON.stringify([config.clientKey, config.clientSecret, config.redirectUri]));
  // A narrowly scoped, expiring video capability is the only unauthenticated route.
  // It is issued only after explicit approval and is never a directory/file lookup.
  router.get("/media/:token", async (req, res) => {
    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" });
    try {
      const service = getWorkflowService?.()?.direct;
      if (!service) return res.sendStatus(404);
      const value = await service.publicMedia(req.params.token);
      res.type(value.mime).send(value.bytes);
    } catch { res.sendStatus(404); }
  });
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    const security = getAccessStore();
    if (!security || !getStore()) return res.status(503).json({ error: "TikTok service is starting." });
    if (security.securityState && security.securityState() !== "enabled") return res.status(503).json({ error: "Configure Corex secure access before connecting TikTok." });
    if (!sessionIdentity(req, Date.now(), security)) return res.status(401).json({ error: "Sign in to Corex first." });
    if (!hasPermission(req, "manage_workflow_credentials", security) || !hasPermission(req, "run_workflow", security)) return res.status(403).json({ error: "Account connection and workflow execution permissions are required." });
    req.tiktokOwner = workflowWorkspace(req, security);
    if (!req.tiktokOwner) return res.status(401).json({ error: "An authenticated workspace is required." });
    if (!["GET", "HEAD"].includes(req.method) && (req.get("Origin") !== origin || req.get("X-Corex-TikTok") !== "1")) return res.status(403).json({ error: "Open TikTok uploads from Corex to continue." });
    next();
  });
  const ready = () => { if (!config.configured) throw new TikTokError("TIKTOK_NOT_CONFIGURED", "TikTok app credentials and HTTPS callback must be configured on the server.", 503); };
  const account = owner => {
    const value = getStore().account(owner);
    if (!value || value.configHash !== configHash) throw new TikTokError("not_connected", "Connect your TikTok account first.", 409);
    return value;
  };
  const access = async owner => { const value = await api.access(account(owner)); getStore().save(owner, value); return value; };
  const locked = (req, res, next) => {
    if (!getStore().lock(req.tiktokOwner)) return res.status(409).json({ error: "Another TikTok operation is in progress. Wait before retrying." });
    // Release after the response, including body-parser and provider failures.
    res.once("finish", () => getStore().unlock(req.tiktokOwner));
    next();
  };
  router.get("/config", (req, res) => {
    const value = getStore().account(req.tiktokOwner);
    res.json({ configured: config.configured, redirectUri: config.redirectUri, maxVideoBytes: MAX_VIDEO_BYTES,
      directPostEnabled: config.directPostEnabled === true, directPostPublicEnabled: config.directPostPublicEnabled === true,
      directPostAuthorized: value?.configHash === configHash && String(value.scopes || "").split(",").includes("video.publish"),
      connected: Boolean(value && value.configHash === configHash), accountName: value?.configHash === configHash ? value.displayName : "",
      accountRef: value?.configHash === configHash ? hash(value.openId + configHash) : "",
      uploads: getStore().recent(req.tiktokOwner) });
  });
  router.post("/auth/start", (req, res) => {
    ready();
    const state = getStore().begin(req.tiktokOwner, req.sessionID, configHash);
    const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
    const direct = req.body?.directPost === true;
    if (direct && !config.directPostEnabled) throw new TikTokError("direct_disabled", "Enable Direct Post testing on the server first.");
    url.search = new URLSearchParams({ client_key: config.clientKey, response_type: "code", scope: direct ? "user.info.basic,video.upload,video.publish" : "user.info.basic,video.upload", redirect_uri: config.redirectUri, state, disable_auto_auth: "1" }).toString();
    res.json({ url: url.href });
  });
  router.get("/auth/callback", locked, async (req, res) => {
    try {
      ready();
      if (!getStore().consume(req.query.state, req.tiktokOwner, req.sessionID, configHash)) throw new TikTokError("invalid_state", "Restart TikTok account connection.");
      if (req.query.error || typeof req.query.code !== "string" || req.query.code.length > 2048) throw new TikTokError("authorization_denied", "TikTok authorization was not completed.");
      const tokens = await api.tokens({ code: req.query.code, grant_type: "authorization_code", redirect_uri: config.redirectUri });
      const profile = await api.profile(tokens.accessToken);
      if (profile.open_id !== tokens.openId) throw new TikTokError("account_mismatch", "TikTok account identity did not match.");
      getStore().save(req.tiktokOwner, { ...tokens, displayName: String(profile.display_name || "TikTok account").slice(0, 200), configHash });
      res.redirect(`${origin}/tiktok?connection=connected`);
    } catch { res.redirect(`${origin}/tiktok?connection=failed`); }
  });
  router.post("/disconnect", locked, async (req, res) => {
    const value = getStore().account(req.tiktokOwner);
    let revoked = !value;
    if (value && config.configured && value.configHash === configHash) {
      try { await api.request("oauth/revoke/", { form: { client_key: config.clientKey, client_secret: config.clientSecret, token: value.accessToken } }); revoked = true; } catch { /* local removal still works */ }
    }
    getWorkflowService?.()?.direct?.remove(req.tiktokOwner);
    getStore().remove(req.tiktokOwner);
    res.json({ disconnected: true, revoked, message: revoked ? "Disconnected." : "Removed from Corex. Also revoke Corex access in TikTok account settings; remote revocation could not be confirmed." });
  });
  router.post("/videos/upload", async (req, res) => {
    if (!getWorkflowService?.()) throw new TikTokError("tiktok_not_ready", "TikTok workflow service is unavailable.", 503);
    res.json(await getWorkflowService().uploadVideo(req.body, req.tiktokOwner));
  });
  const direct = () => {
    const service = getWorkflowService?.()?.direct;
    if (!service) throw new TikTokError("tiktok_not_ready", "Direct Post service is unavailable.", 503);
    return service;
  };
  router.post("/direct/review", locked, async (req, res) => res.json(await direct().review(req.body, req.tiktokOwner)));
  router.get("/direct/reviews/:id/preview", async (req, res) => {
    const value = await direct().preview(req.tiktokOwner, req.params.id);
    res.set("X-Content-Type-Options", "nosniff").type(value.mime).send(value.bytes);
  });
  router.post("/direct/approve", locked, async (req, res) => res.json(await direct().approve(req.body, req.tiktokOwner)));
  router.get("/direct/posts", (req, res) => res.json({ posts: direct().recent(req.tiktokOwner) }));
  router.post("/direct/posts/:id/cancel", locked, (req, res) => res.json(direct().cancel(req.tiktokOwner, req.params.id)));
  router.post("/direct/posts/:id/status", locked, async (req, res) => res.json(await direct().status(req.tiktokOwner, req.params.id)));
  router.post("/uploads", locked, (req, res, next) => {
    ready(); const selectedAccount = account(req.tiktokOwner);
    if (req.get("X-TikTok-Account") !== hash(selectedAccount.openId + configHash)) throw new TikTokError("account_changed", "The connected account changed. Reload, review the account, and consent again.", 409);
    if (req.get("X-TikTok-Consent") !== "upload-to-inbox") throw new TikTokError("consent_required", "Confirm sending this video to your TikTok inbox.");
    if (!/^[a-f0-9-]{36}$/.test(req.get("Idempotency-Key") || "")) throw new TikTokError("invalid_request", "A valid upload request ID is required.");
    next();
  }, express.raw({ type: ["video/mp4", "video/quicktime", "video/webm"], limit: MAX_VIDEO_BYTES }), async (req, res) => {
    const owner = req.tiktokOwner, id = req.get("Idempotency-Key");
    const existing = getStore().job(owner, id);
    if (existing) return res.json({ id, status: existing.status });
    const type = req.get("Content-Type")?.split(";")[0]; validateVideo(req.body, type);
    const value = await access(owner), digest = hash(req.body);
    if (getStore().duplicate(owner, value.openId, digest)) throw new TikTokError("duplicate_upload", "This video was already submitted in the past 24 hours. Check its status and your TikTok inbox.", 409);
    getStore().createJob(owner, value.openId, digest, id);
    try {
      const result = await api.request("post/publish/inbox/video/init/", { token: value.accessToken, body: { source_info: {
        source: "FILE_UPLOAD", video_size: req.body.length, chunk_size: req.body.length, total_chunk_count: 1,
      } } });
      if (!result.data?.publish_id || !result.data?.upload_url) throw new TikTokError("invalid_upload_response", "TikTok did not return upload details.", 502);
      getStore().updateJob(owner, id, "TRANSFERRING", result.data.publish_id);
      await api.transfer(result.data.upload_url, req.body, type);
      getStore().updateJob(owner, id, "PROCESSING_UPLOAD");
      res.json({ id, status: "PROCESSING_UPLOAD", message: "Video transferred. Check status, then open TikTok inbox to finish editing and posting." });
    } catch (error) {
      getStore().updateJob(owner, id, "OUTCOME_UNCERTAIN");
      // A provider timeout is not permission to initialize a second upload.
      res.status(502).json({ id, status: "OUTCOME_UNCERTAIN", error: error instanceof TikTokError ? error.message : "Upload outcome is uncertain. Check status and your TikTok inbox." });
    }
  });
  router.post("/uploads/:id/status", locked, async (req, res) => {
    ready();
    const row = getStore().job(req.tiktokOwner, req.params.id);
    if (!row) throw new TikTokError("not_found", "Upload not found.", 404);
    const value = await access(req.tiktokOwner);
    if (row.account_id !== value.openId) throw new TikTokError("account_mismatch", "Reconnect the TikTok account used for this upload.", 409);
    if (!row.publish_id) return res.json({ id: row.id, status: row.status, message: "No TikTok tracking ID was received. Check your inbox before another upload." });
    const result = await api.request("post/publish/status/fetch/", { token: value.accessToken, body: { publish_id: row.publish_id } });
    const allowed = ["PROCESSING_UPLOAD", "PROCESSING_DOWNLOAD", "SEND_TO_USER_INBOX", "PUBLISH_COMPLETE", "FAILED"];
    const status = allowed.includes(result.data?.status) ? result.data.status : "STATUS_UNKNOWN";
    getStore().updateJob(req.tiktokOwner, row.id, status);
    res.json({ id: row.id, status });
  });
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.type === "entity.too.large") return res.status(413).json({ error: "Choose a video up to 32 MiB." });
    res.status(error instanceof TikTokError ? error.status : 500).json({ code: error instanceof TikTokError ? error.code : "tiktok_error", error: error instanceof TikTokError ? error.message : "TikTok operation could not be completed." });
  });
  app.use("/api/tiktok", router);
}
module.exports = { registerTikTokRoutes };
