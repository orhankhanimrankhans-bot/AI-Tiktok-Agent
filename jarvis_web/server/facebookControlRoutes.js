"use strict";
const { FacebookControlError } = require("./facebookControlStore");
const { credentialPageToken, FacebookGraphError } = require("./facebookGraph");
const MIN_PUBLIC_RESCAN_MS = 10 * 60 * 1000;
function safe(res, error, logger) { if (error instanceof FacebookControlError) return res.status(400).json({ error: error.message, code: error.code }); logger?.error?.("Facebook Control operation failed safely."); return res.status(500).json({ error: "Facebook Control operation could not be completed." }); }
function publicSyncError(error) {
  if (error instanceof FacebookGraphError) {
    if (error.statusCode === 401 || error.code === "meta_190") return { status: "token_expired", message: "Facebook token expired." };
    if (error.statusCode === 429) return { status: "rate_limited", message: "Facebook API temporarily rate limited." };
    if (error.statusCode === 403) return { status: "permission_required", message: error.permission ? `Page permission required: ${error.permission}.` : "Page permission required." };
    if (error.statusCode === 400 || error.code === "meta_100") return { status: "metric_unavailable", message: "Metric unavailable with current Facebook API permissions." };
  }
  return { status: "sync_failed", message: "Facebook metrics could not be synced." };
}
function latestInsightValue(data, metricName) {
  const metric = Array.isArray(data?.data) ? data.data.find((item) => item?.name === metricName) : null;
  const values = Array.isArray(metric?.values) ? metric.values : [];
  for (const item of [...values].reverse()) { const number = Number(item?.value); if (Number.isFinite(number)) return number; }
  return null;
}
function normalizedName(value) { return String(value || "").trim().toLowerCase().replace(/\s+/g, " "); }
function findMatchingCredential(page, facebookCredentialStore, owner) {
  if (!facebookCredentialStore?.list) return null;
  const credentials = facebookCredentialStore.list(owner).filter((credential) => credential.connected !== false && credential.pageId);
  const pageId = String(page.pageId || "").trim();
  if (pageId) { const exact = credentials.find((credential) => String(credential.pageId) === pageId); if (exact) return exact; }
  const pageName = normalizedName(page.pageName);
  if (pageName) { const matches = credentials.filter((credential) => normalizedName(credential.pageName || credential.name) === pageName); if (matches.length === 1) return matches[0]; }
  return null;
}
async function syncGraphPage({ page, owner, store, facebookCredentialStore, graphServiceFactory, logger }) {
  if (!facebookCredentialStore) return store.markPageSyncIssue(page.id, "connection_required", "Facebook connection required.", owner);
  let workingPage = page; let credentialId = page.credentialId;
  if (!credentialId) { const matched = findMatchingCredential(page, facebookCredentialStore, owner); if (matched?.id) { workingPage = store.updatePage(page.id, { ...page, credentialId: matched.id, pageId: page.pageId || matched.pageId, pageName: page.pageName || matched.pageName }, owner) || page; credentialId = matched.id; } }
  if (!credentialId) return store.markPageSyncIssue(page.id, "connection_required", "Facebook connection required. Connect this Page in Facebook Control.", owner);
  let credential = facebookCredentialStore.get(credentialId, { includeTokens: true, owner });
  if (!credential) { const matched = findMatchingCredential(page, facebookCredentialStore, owner); if (matched?.id) { workingPage = store.updatePage(page.id, { ...page, credentialId: matched.id, pageId: page.pageId || matched.pageId, pageName: page.pageName || matched.pageName }, owner) || page; credential = facebookCredentialStore.get(matched.id, { includeTokens: true, owner }); } }
  if (!credential) return store.markPageSyncIssue(page.id, "credential_not_found", "Selected Facebook credential was not found.", owner);
  const pageId = workingPage.pageId || credential.pageId;
  if (!pageId) return store.markPageSyncIssue(page.id, "page_access_required", "Page access required.", owner);
  const service = graphServiceFactory(); const token = credentialPageToken(credential, pageId);
  if (!token) return store.markPageSyncIssue(page.id, "page_access_required", "Page access required.", owner);
  try {
    const metadata = await service.pageMetadata(pageId, token);
    let posts = null; let insights = null; const warnings = [];
    try { posts = service.pagePosts ? await service.pagePosts(pageId, token) : await service.pageVideos(pageId, token); } catch (error) { warnings.push(publicSyncError(error).message); }
    try { insights = await service.pageInsights(pageId, token); } catch (error) { warnings.push(publicSyncError(error).message); }
    const followers = Number(metadata.followers_count ?? metadata.fan_count);
    const views = latestInsightValue(insights, "page_impressions_unique") ?? latestInsightValue(insights, "page_video_views");
    const postsCount = Number(posts?.summary?.total_count);
    const metrics = { followers: Number.isFinite(followers) ? followers : null, views, posts: Number.isFinite(postsCount) ? postsCount : null };
    if (metrics.followers === null && metrics.views === null && metrics.posts === null) {
      const message = warnings.length ? `Meta did not return numeric metrics: ${[...new Set(warnings)].join(" ")}` : "Meta did not return numeric followers, views, or posts for this Page.";
      return store.markPageSyncIssue(page.id, "metric_unavailable", message, owner);
    }
    return store.recordPageMetrics(page.id, { pageId: String(metadata.id || pageId), pageName: metadata.name || credential.pageName || workingPage.pageName, pageUrl: metadata.link || workingPage.pageUrl, pagePictureUrl: metadata.picture?.data?.url || workingPage.pagePictureUrl, ...metrics, engagement: null, followerGrowth: null, message: warnings.length ? `Synced with warnings: ${[...new Set(warnings)].join(" ")}` : "Facebook metrics synced." }, owner);
  } catch (error) { const issue = publicSyncError(error); logger?.warn?.("Facebook Control sync page failed safely.", { status: issue.status, pageRecordId: page.id }); return store.markPageSyncIssue(page.id, issue.status, issue.message, owner); }
}
function shouldSkipPublicScan(page, { force = false, nowMs = Date.now(), minRescanMs = MIN_PUBLIC_RESCAN_MS } = {}) {
  if (force) return false;
  const last = page.lastPublicScan || page.lastSyncAt;
  if (!last) return false;
  const age = nowMs - new Date(last).getTime();
  return Number.isFinite(age) && age >= 0 && age < minRescanMs;
}
async function syncPublicPage({ page, owner, store, publicMetricsService, logger, force = true }) {
  if (!publicMetricsService?.scanPage) return null;
  if (shouldSkipPublicScan(page, { force })) return page;
  try { return store.recordPublicMetrics(page.id, await publicMetricsService.scanPage(page), owner); }
  catch (error) { logger?.warn?.("Facebook public scan page failed safely.", { status: error?.code || "scan_failed", pageRecordId: page.id }); return store.markPageSyncIssue(page.id, error?.code || "scan_failed", error?.message || "Facebook public scan failed; retrying later.", owner); }
}
async function syncFacebookControl({ owner, store, facebookCredentialStore, graphServiceFactory = null, publicMetricsService = null, logger = console, forcePublicScan = true } = {}) {
  const before = store.list(owner);
  const results = [];
  if (publicMetricsService?.scanPage) {
    for (const page of before.pages) results.push(await syncPublicPage({ page, owner, store, publicMetricsService, logger, force: forcePublicScan }));
  } else if (graphServiceFactory) {
    for (const page of before.pages) results.push(await syncGraphPage({ page, owner, store, facebookCredentialStore, graphServiceFactory, logger }));
  } else return { ...before, status: "unavailable", message: "Facebook public scanner is not available." };
  const sync = store.markSync(owner); const after = store.list(owner);
  const synced = after.pages.filter((page) => page.syncStatus === "synced" || page.syncStatus === "partial").length; const failed = after.pages.length - synced;
  return { ...after, sync, status: failed ? "partial" : "synced", message: after.pages.length ? `${synced} page${synced === 1 ? "" : "s"} scanned${failed ? `, ${failed} need attention` : ""}.` : "No Facebook Pages added yet.", results };
}
function registerFacebookControlRoutes(app, { store, workspaceForRequest = () => ({ ownerType: "admin", ownerId: "primary" }), facebookCredentialStore = null, graphServiceFactory = null, publicMetricsService = null, logger = console } = {}) {
  if (!store) throw new Error("store is required");
  const workspace = (req, res) => { const owner = workspaceForRequest(req); if (!owner) { res.status(401).json({ error: "Authentication is required." }); return null; } return owner; };
  app.get("/api/facebook/control", (req, res) => { const owner = workspace(req, res); if (!owner) return; try { return res.json(store.list(owner)); } catch (error) { return safe(res, error, logger); } });
  app.get("/api/facebook/performance", (req, res) => { const owner = workspace(req, res); if (!owner) return; try { return res.json(store.list(owner)); } catch (error) { return safe(res, error, logger); } });
  app.post("/api/facebook/team-members", (req, res) => { const owner = workspace(req, res); if (!owner) return; try { return res.status(201).json(store.createTeam(req.body, owner)); } catch (error) { return safe(res, error, logger); } });
  app.put("/api/facebook/team-members/:teamId", (req, res) => { const owner = workspace(req, res); if (!owner) return; try { const team = store.updateTeam(req.params.teamId, req.body, owner); return team ? res.json(team) : res.status(404).json({ error: "Team member not found." }); } catch (error) { return safe(res, error, logger); } });
  app.post("/api/facebook/pages", (req, res) => { const owner = workspace(req, res); if (!owner) return; try { return res.status(201).json(store.createPage(req.body, owner)); } catch (error) { return safe(res, error, logger); } });
  app.put("/api/facebook/pages/:pageId", (req, res) => { const owner = workspace(req, res); if (!owner) return; try { const page = store.updatePage(req.params.pageId, req.body, owner); return page ? res.json(page) : res.status(404).json({ error: "Facebook Page record not found." }); } catch (error) { return safe(res, error, logger); } });
  app.delete("/api/facebook/pages/:pageId", (req, res) => { const owner = workspace(req, res); if (!owner) return; try { return store.deletePage(req.params.pageId, owner) ? res.json({ ok: true, id: req.params.pageId }) : res.status(404).json({ error: "Facebook Page record not found." }); } catch (error) { return safe(res, error, logger); } });
  app.post("/api/facebook/pages/:pageId/test-connection", async (req, res) => { const owner = workspace(req, res); if (!owner) return; try { const data = store.list(owner); const page = data.pages.find((item) => item.id === req.params.pageId); if (!page) return res.status(404).json({ error: "Facebook Page record not found." }); if (publicMetricsService?.scanPage) return res.json(store.recordPublicMetrics(page.id, await publicMetricsService.scanPage(page), owner)); if (!page.credentialId) return res.json({ ok: false, status: "connection_required", message: "Data connection required. Select an existing Facebook credential before live metrics can sync." }); if (facebookCredentialStore && !facebookCredentialStore.get(page.credentialId, { owner })) return res.status(404).json({ ok: false, status: "credential_not_found", message: "Selected Facebook credential was not found." }); return res.json({ ok: true, status: "connected", message: "Credential record is available. Live metric sync can use the server-side Meta integration." }); } catch (error) { return safe(res, error, logger); } });
  app.put("/api/facebook/sync-settings", (req, res) => { const owner = workspace(req, res); if (!owner) return; try { return res.json(store.updateSync(req.body, owner)); } catch (error) { return safe(res, error, logger); } });
  app.post("/api/facebook/sync", async (req, res) => { const owner = workspace(req, res); if (!owner) return; try { return res.json(await syncFacebookControl({ owner, store, facebookCredentialStore, graphServiceFactory, publicMetricsService, logger, forcePublicScan: true })); } catch (error) { return safe(res, error, logger); } });
}
module.exports = { MIN_PUBLIC_RESCAN_MS, registerFacebookControlRoutes, shouldSkipPublicScan, syncFacebookControl, publicSyncError };
