"use strict";
const express = require("express"), crypto = require("node:crypto");
const { workflowWorkspace, sessionIdentity } = require("./accessControl");
const { authorizeInstagramOwner } = require("./instagramAccess");
const { InstagramApi, InstagramError } = require("./instagramApi");
const { accountRef, MAX_VIDEO_BYTES } = require("./instagramWorkflow");
function registerInstagramRoutes(app, { getStore, getAccessStore, getService, clientUrl, api = new InstagramApi() }) {
  const router = express.Router(), origin = new URL(clientUrl).origin, redirectUri = `${origin}/api/instagram/auth/callback`;
  router.get("/media/:token", async (req, res) => {
    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" });
    try { res.type("video/mp4").send(await getService().publicMedia(req.params.token)); } catch { res.sendStatus(404); }
  });
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    const access = getAccessStore();
    if (!access || !getStore() || !getService() || access.securityState() !== "enabled") return res.status(503).json({ error: "Instagram requires Corex secure access." });
    if (!sessionIdentity(req, Date.now(), access)) return res.status(401).json({ error: "Sign in to Corex first." });
    req.instagramOwner = workflowWorkspace(req, access);
    if (!req.instagramOwner) return res.status(401).json({ error: "An authenticated workspace is required." });
    authorizeInstagramOwner(access, req.instagramOwner);
    if (!["GET", "HEAD"].includes(req.method) && (req.get("Origin") !== origin || req.get("X-Corex-Instagram") !== "1")) return res.status(403).json({ error: "Open Instagram from Corex to continue." });
    next();
  });
  router.use(express.json({ limit: "16kb" }));
  router.get("/config", (req, res) => {
    const owner = req.instagramOwner, config = getStore().get(owner, "config"), account = getStore().get(owner, "account");
    const connected = !!(config && account && account.revision === config.revision && account.expiresAt > Date.now());
    res.json({ configured: !!config, appId: config?.appId || "", redirectUri, connected, accountName: connected ? account.name : "", accountRef: connected ? accountRef(owner, account) : "", maxVideoBytes: MAX_VIDEO_BYTES });
  });
  router.post("/config", async (req, res) => getService().exclusive(req.instagramOwner, async () => {
    const { appId, appSecret } = req.body || {}, previous = getStore().get(req.instagramOwner, "config");
    if (typeof appId !== "string" || !/^\d{5,30}$/.test(appId) || (appSecret && (typeof appSecret !== "string" || !/^[A-Za-z0-9_-]{16,256}$/.test(appSecret)))) throw new InstagramError("invalid_config", "Enter your Instagram App ID and app secret.");
    const secret = appSecret || (previous?.appId === appId ? previous.appSecret : "");
    if (!secret) throw new InstagramError("missing_secret", "An Instagram app secret is required.");
    if (previous?.appId !== appId || previous?.appSecret !== secret) {
      getStore().removeAccount(req.instagramOwner);
      getStore().save(req.instagramOwner, "config", { appId, appSecret: secret, revision: crypto.randomUUID() });
    }
    res.json({ configured: true });
  }));
  router.post("/auth/start", (req, res) => {
    const config = getStore().get(req.instagramOwner, "config");
    if (!config || new URL(redirectUri).protocol !== "https:") throw new InstagramError("not_configured", "Configure your Instagram app and HTTPS callback first.");
    const state = getStore().begin(req.instagramOwner, req.sessionID, config.revision);
    const url = new URL("https://www.instagram.com/oauth/authorize");
    url.search = new URLSearchParams({ client_id: config.appId, redirect_uri: redirectUri, response_type: "code", scope: "instagram_business_basic,instagram_business_content_publish", state, enable_fb_login: "0", force_authentication: "1" });
    res.json({ url: url.href });
  });
  router.get("/auth/callback", async (req, res) => {
    try {
      await getService().exclusive(req.instagramOwner, async guard => {
        const config = getStore().get(req.instagramOwner, "config");
        if (!config || !getStore().consume(req.query.state, req.instagramOwner, req.sessionID, config.revision) || req.query.error || typeof req.query.code !== "string" || req.query.code.length > 2048) throw new InstagramError("invalid_state", "Restart Instagram connection.");
        const account = await api.exchange(config, req.query.code, redirectUri);
        guard(); getStore().save(req.instagramOwner, "account", account);
      });
      res.redirect(`${origin}/?instagram=connected`);
    } catch { res.redirect(`${origin}/?instagram=failed`); }
  });
  router.post("/disconnect", async (req, res) => getService().exclusive(req.instagramOwner, async () => {
    getStore().removeAccount(req.instagramOwner);
    res.json({ disconnected: true, message: "Disconnected from Corex. You can also remove this app in Instagram's Apps and Websites settings." });
  }));
  router.post("/videos/publish", async (req, res) => res.json(await getService().publishReel(req.body, req.instagramOwner)));
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    res.status(error instanceof InstagramError ? error.statusCode : 500).json({ code: error instanceof InstagramError ? error.code : "instagram_error", error: error instanceof InstagramError ? error.message : "Instagram operation could not be completed. Check the existing submission before retrying." });
  });
  app.use("/api/instagram", router);
}
module.exports = { registerInstagramRoutes };
