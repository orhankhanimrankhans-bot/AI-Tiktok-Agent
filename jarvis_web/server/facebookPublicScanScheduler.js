"use strict";
const { syncFacebookControl } = require("./facebookControlRoutes");

function createFacebookPublicScanScheduler({ store, publicMetricsService, owner = { ownerType: "admin", ownerId: "primary" }, intervalMs = 60_000, minRescanMs = 10 * 60 * 1000, logger = console } = {}) {
  if (!store) throw new Error("store is required");
  let timer = null;
  let running = false;
  async function tick() {
    if (running || !publicMetricsService?.scanPage) return { status: "idle" };
    running = true;
    try {
      const state = store.list(owner);
      const due = state.pages.some((page) => {
        const last = page.lastPublicScan || page.lastSyncAt;
        if (!last) return true;
        const age = Date.now() - new Date(last).getTime();
        return !Number.isFinite(age) || age >= Math.max(minRescanMs, Number(state.sync.refreshIntervalMinutes || 60) * 60_000);
      });
      if (!due) return { status: "waiting" };
      return await syncFacebookControl({ owner, store, publicMetricsService, logger, forcePublicScan: false });
    } catch (error) {
      logger?.warn?.("Facebook public scan scheduler tick failed safely.", { code: error?.code || "scan_scheduler_failed" });
      return { status: "error" };
    } finally { running = false; }
  }
  return Object.freeze({
    start() { if (!timer) timer = setInterval(() => { tick(); }, intervalMs); return this.status(); },
    stop() { if (timer) clearInterval(timer); timer = null; return this.status(); },
    tick,
    status() { return { running: Boolean(timer), intervalMs, minRescanMs }; },
  });
}

module.exports = { createFacebookPublicScanScheduler };
