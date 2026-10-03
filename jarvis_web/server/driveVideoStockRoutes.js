"use strict";
function registerDriveVideoStockRoutes(app, { service, workspaceForRequest, logger = console }) {
  app.get("/api/drive/video-stock", (req, res) => {
    const owner = workspaceForRequest(req);
    if (!owner) return res.status(401).json({ error: "Authentication required." });
    try { return res.set("Cache-Control", "no-store").json(service.snapshot(owner)); }
    catch { return res.status(403).json({ error: "Drive monitoring access denied." }); }
  });
  app.post("/api/drive/video-stock/refresh", (req, res) => {
    const owner = workspaceForRequest(req);
    if (!owner) return res.status(401).json({ error: "Authentication required." });
    try {
      const state = service.snapshot(owner);
      if (state.scanning) return res.status(202).json(state);
      service.scan(owner, true).catch(() => logger.error("Drive stock refresh unavailable."));
      return res.status(202).json(service.snapshot(owner));
    } catch { return res.status(403).json({ error: "Drive monitoring access denied." }); }
  });
}
module.exports = { registerDriveVideoStockRoutes };
