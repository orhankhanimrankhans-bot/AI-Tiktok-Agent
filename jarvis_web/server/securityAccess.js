"use strict";

const { OWNER_PERMISSIONS, hasPermission, publicSession, sessionIdentity } = require("./accessControl");

function denied(res, status, error) { return res.status(status).json({ status: status === 401 ? "locked" : "forbidden", error }); }
function requiredPermission(req) {
  if (req.path === "/api/workflow-executions/run") return "run_workflow";
  if (req.path.startsWith("/api/workflows")) return req.method === "GET" ? "view_workflow" : "edit_workflow";
  if (req.path.startsWith("/api/executions")) return "view_workflow";
  if (req.path.startsWith("/api/facebook/reels/publish")) return "publish_facebook";
  if (req.path.startsWith("/api/facebook/graph/")) return "view_facebook";
  if (req.path.startsWith("/api/facebook/auth/start")) return "publish_facebook";
  if (req.path.startsWith("/api/facebook/credentials")) return req.method === "GET" ? "view_facebook" : "publish_facebook";
  if (req.path.startsWith("/api/google/auth/start")) return "storage_modify";
  if (req.path.startsWith("/api/google/credentials")) return req.method === "GET" ? "storage" : "storage_modify";
  if (req.path.startsWith("/api/google/drive/")) return ["move", "delete"].some((part) => req.path.endsWith(`/${part}`)) ? "storage_modify" : "storage";
  if (req.path === "/api/ai/prepare-content") return "run_workflow";
  return null;
}
function enforceSecurity(getStore) {
  return (req, res, next) => {
    const store = getStore();
    if (!store || req.path.startsWith("/api/security") || req.path === "/api/health" || store.securityState() === "disabled") return next();
    if (store.securityState() === "recovery_required") return denied(res, 503, "Security recovery is required.");
    const permission = requiredPermission(req); if (!permission) return next();
    if (!sessionIdentity(req, Date.now(), store)) return denied(res, 401, "Jarvis is locked. Authenticate to continue.");
    return hasPermission(req, permission, store) ? next() : denied(res, 403, "This profile does not have permission for that action.");
  };
}
function registerSecurityRoutes(app, getStore) {
  const owner = (req, res) => { const store = getStore(); return sessionIdentity(req, Date.now(), store)?.role === "owner" || (denied(res, 403, "Owner access is required."), false); };
  app.get("/api/security/status", (req, res) => { const store = getStore(); const security = store?.publicSettings() || { enabled: false, recoveryRequired: false, autoLockMinutes: 0 }; return res.json({ security, session: security.enabled ? publicSession(req, store) : security.recoveryRequired ? null : { role: "owner", displayName: "Owner", permissions: OWNER_PERMISSIONS, expiresAt: null } }); });
  app.get("/api/security/public-profiles", (req, res) => { const store = getStore(); const now = Date.now(); return res.json({ profiles: store?.listChildren().filter((profile) => profile.enabled && (!profile.accessExpiresAt || now < profile.accessExpiresAt)).map(({ id, displayName }) => ({ id, displayName })) || [] }); });
  app.post("/api/security/setup", async (req, res) => { const store = getStore(); if (!store) return denied(res, 503, "Security is not ready."); if (req.body?.password !== req.body?.confirmPassword) return res.status(400).json({ error: "Passwords do not match." }); try { await store.setup(req.body?.password, req.body?.autoLockMinutes); req.session.regenerate((error) => { if (error) return denied(res, 500, "Could not start a secure session."); req.session.jarvisAuth = { role: "owner", displayName: "Owner", permissions: OWNER_PERMISSIONS }; return req.session.save(() => res.status(201).json({ security: store.publicSettings(), session: publicSession(req) })); }); } catch (error) { return res.status(400).json({ error: error.message || "Security setup could not be completed." }); } });
  app.post("/api/security/recover", async (req, res) => { const store = getStore(); const secret = process.env.JARVIS_SECURITY_RECOVERY_SECRET; if (!store || !secret || req.get("x-jarvis-recovery-secret") !== secret) return denied(res, 403, "Owner recovery authorization is required."); if (req.body?.password !== req.body?.confirmPassword) return res.status(400).json({ error: "Passwords do not match." }); try { await store.recover(req.body?.password, req.body?.autoLockMinutes); return res.json({ security: store.publicSettings() }); } catch (error) { return res.status(400).json({ error: error.message || "Security recovery could not be completed." }); } });
  app.post("/api/security/login", async (req, res) => { const store = getStore(); if (!store?.publicSettings().enabled) return res.status(409).json({ error: "Security is not configured." }); const child = req.body?.profileId ? await store.verifyChild(req.body.profileId, req.body?.password) : null; const ownerLogin = !req.body?.profileId && await store.verifyAdmin(req.body?.password); if (!child && !ownerLogin) return denied(res, 401, "Authentication failed."); const now = Date.now(); const identity = ownerLogin ? { role: "owner", displayName: "Owner", permissions: OWNER_PERMISSIONS } : { role: "child", profileId: child.id, displayName: child.displayName, permissions: child.permissions, expiresAt: child.accessExpiresAt || (child.sessionLimitMinutes ? now + child.sessionLimitMinutes * 60_000 : null) }; req.session.regenerate((error) => { if (error) return denied(res, 500, "Could not start a secure session."); req.session.jarvisAuth = identity; return req.session.save(() => res.json({ session: publicSession(req, store) })); }); });
  app.post("/api/security/lock", (req, res) => req.session.destroy(() => res.json({ ok: true })));
  app.get("/api/security/children", (req, res) => owner(req, res) && res.json({ profiles: getStore().listChildren() }));
  app.post("/api/security/children", async (req, res) => { if (!owner(req, res)) return; try { return res.status(201).json(await getStore().createChild(req.body || {})); } catch (error) { return res.status(400).json({ error: error.message }); } });
  app.patch("/api/security/children/:id", (req, res) => { if (!owner(req, res)) return; const profile = getStore().updateChild(req.params.id, req.body || {}); return profile ? res.json(profile) : res.status(404).json({ error: "Profile not found." }); });
  app.delete("/api/security/children/:id", (req, res) => owner(req, res) && res.json({ ok: getStore().deleteChild(req.params.id) }));
}
module.exports = { enforceSecurity, registerSecurityRoutes, requiredPermission };
