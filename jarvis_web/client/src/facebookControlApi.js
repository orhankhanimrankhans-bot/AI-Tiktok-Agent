
export async function facebookJson(fetchImpl, apiBaseUrl, path, options = {}) {
  const response = await fetchImpl(`${apiBaseUrl}${path}`, { credentials: "include", headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || "Facebook Control request failed.");
  return body;
}
export function getFacebookControl(fetchImpl = fetch, apiBaseUrl = "") { return facebookJson(fetchImpl, apiBaseUrl, "/api/facebook/control"); }
export function getFacebookPerformance(fetchImpl = fetch, apiBaseUrl = "") { return facebookJson(fetchImpl, apiBaseUrl, "/api/facebook/performance"); }
export function createFacebookTeam(fetchImpl, apiBaseUrl, payload) { return facebookJson(fetchImpl, apiBaseUrl, "/api/facebook/team-members", { method: "POST", body: JSON.stringify(payload) }); }
export function updateFacebookTeam(fetchImpl, apiBaseUrl, teamId, payload) { return facebookJson(fetchImpl, apiBaseUrl, `/api/facebook/team-members/${encodeURIComponent(teamId)}`, { method: "PUT", body: JSON.stringify(payload) }); }
export function createFacebookPage(fetchImpl, apiBaseUrl, payload) { return facebookJson(fetchImpl, apiBaseUrl, "/api/facebook/pages", { method: "POST", body: JSON.stringify(payload) }); }
export function updateFacebookPage(fetchImpl, apiBaseUrl, pageId, payload) { return facebookJson(fetchImpl, apiBaseUrl, `/api/facebook/pages/${encodeURIComponent(pageId)}`, { method: "PUT", body: JSON.stringify(payload) }); }
export function deleteFacebookPage(fetchImpl, apiBaseUrl, pageId) { return facebookJson(fetchImpl, apiBaseUrl, `/api/facebook/pages/${encodeURIComponent(pageId)}`, { method: "DELETE" }); }
export function testFacebookPageConnection(fetchImpl, apiBaseUrl, pageId) { return facebookJson(fetchImpl, apiBaseUrl, `/api/facebook/pages/${encodeURIComponent(pageId)}/test-connection`, { method: "POST", body: JSON.stringify({}) }); }
export function updateFacebookSyncSettings(fetchImpl, apiBaseUrl, payload) { return facebookJson(fetchImpl, apiBaseUrl, "/api/facebook/sync-settings", { method: "PUT", body: JSON.stringify(payload) }); }
export function refreshFacebookPages(fetchImpl, apiBaseUrl) { return facebookJson(fetchImpl, apiBaseUrl, "/api/facebook/sync", { method: "POST", body: JSON.stringify({}) }); }
export function facebookPerformanceScore(metrics = {}) {
  const followers = Number(metrics.followers) || 0; const views = Number(metrics.views) || 0; const posts = Number(metrics.posts ?? metrics.reels) || 0; const growth = Number(metrics.followerGrowth) || 0; const engagement = Number(metrics.engagement) || 0;
  return Math.max(0, Math.min(100, Math.round((Math.log10(followers + 1) * 14) + (Math.log10(views + 1) * 18) + Math.min(posts, 250) * .09 + Math.max(0, growth) * 1.2 + Math.max(0, engagement) * 1.1)));
}
