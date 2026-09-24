"use strict";
const express = require("express");
const { workflowWorkspace, sessionIdentity, hasPermission } = require("./accessControl");
const { CrosspostError } = require("./facebookTikTokSource");
function registerFacebookTikTokRoutes(app, { getService, getAccessStore, clientUrl }) {
  const router = express.Router(), origin = new URL(clientUrl).origin;
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    const security = getAccessStore();
    if (!security || security.securityState() !== "enabled" || !getService()) return res.status(503).json({ error: "Crossposting is unavailable until secure access is ready." });
    if (!sessionIdentity(req, Date.now(), security)) return res.status(401).json({ error: "Sign in to Corex." });
    if (!["view_facebook", "manage_workflow_credentials", "run_workflow"].every(p => hasPermission(req, p, security))) return res.status(403).json({ error: "Your existing access does not allow Facebook-to-TikTok crossposting." });
    if (req.method !== "GET" && req.method !== "HEAD" && (req.get("Origin") !== origin || req.get("X-Corex-Crosspost") !== "1")) return res.status(403).json({ error: "Open crossposting from Corex." });
    req.crosspostOwner = workflowWorkspace(req, security);
    if (!req.crosspostOwner) return res.status(401).json({ error: "An authenticated workspace is required." });
    next();
  });
  const handle = action => async (req, res) => { try { res.json(await action(getService(), req.crosspostOwner, req)); }
    catch (error) { const safe = error instanceof CrosspostError || String(error.code || "").startsWith("tiktok_");
      res.status(safe && Number.isInteger(error.statusCode) ? error.statusCode : 400).json({ error: safe ? error.message : "Crossposting could not complete. Check the connected accounts and try again." }); } };
  router.get("/", handle((s, o) => s.list(o)));
  router.post("/routes", handle((s, o, r) => s.create(o, r.body || {})));
  router.post("/routes/:id/scan", handle((s, o, r) => s.scan(o, r.params.id)));
  router.post("/routes/:id/toggle", handle((s, o, r) => s.toggle(o, r.params.id, r.body?.enabled)));
  router.post("/items/:id/review", handle((s, o, r) => s.review(o, r.params.id)));
  router.post("/items/:id/approve", handle((s, o, r) => s.approve(o, r.params.id, r.body || {})));
  router.post("/items/:id/schedule", handle((s, o, r) => s.schedule(o, r.params.id, r.body?.due)));
  router.post("/items/:id/publish", handle(async (s, o, r) => { await s.schedule(o, r.params.id, Date.now()); return s.publish(o, r.params.id); }));
  router.post("/items/:id/status", handle((s, o, r) => s.check(o, r.params.id)));
  router.post("/items/:id/cancel", handle((s, o, r) => s.cancel(o, r.params.id, r.body?.discard === true)));
  app.use("/api/crosspost/facebook-tiktok", router);
}
module.exports = { registerFacebookTikTokRoutes };
