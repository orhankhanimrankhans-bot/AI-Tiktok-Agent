import { useEffect, useMemo, useState } from "react";
import { facebookPerformanceScore, getFacebookPerformance, refreshFacebookPages } from "./facebookControlApi.js";

function formatCompact(value) {
  if (value === null || value === undefined || value === "") return "Not available";
  const number = Number(value);
  if (!Number.isFinite(number)) return "Not available";
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(number);
}
function formatTime(value) { return value ? new Date(value).toLocaleString() : "Never"; }
function statusMessage(page) {
  const status = page.syncStatus || page.dataConnectionStatus;
  return ({ synced: "Public metrics synced from the saved Facebook Page URL.", partial: "Some public metrics were collected; Facebook did not expose every requested metric.", temporarily_blocked: "Facebook temporarily blocked public scanning. Last good metrics are preserved.", scan_failed: "Public scan failed; Corex will retry later.", page_not_found: "Facebook Page not found.", invalid_url: "Invalid Facebook Page URL.", metric_unavailable: "Public metrics are not visible in the current Facebook response.", not_scanned: "Waiting for first public scan." })[status] || page.syncMessage || "Waiting for first public scan.";
}
function metricTitle(page, key) {
  const meta = page.metrics?.metricMeta?.[key];
  if (!meta) return statusMessage(page);
  if (key === "followers") return meta.quality === "unavailable" ? "Followers unavailable publicly." : `Followers from ${meta.source || "public page"}${meta.display ? ` (${meta.display})` : ""}.`;
  if (key === "views") return meta.quality === "unavailable" ? "No public video/reel views found." : `Combined public views from ${meta.quality}; ${meta.sampled || 0} video/reel counts sampled.`;
  if (key === "posts") return meta.quality === "unavailable" ? "No recent public posts detected." : `${meta.quality === "recent-public-sample" ? "Recent publicly detected posts" : meta.quality}${meta.window ? ` (${meta.window})` : ""}.`;
  return statusMessage(page);
}
function metricStatus(page, key) { return page.metrics?.[key] === null || page.metrics?.[key] === undefined ? "Not available" : formatCompact(page.metrics[key]); }
function scoreStatus(page) { return page.metrics?.capturedAt ? `${page.performanceScore}%` : "Not synced"; }
export function teamPerformanceRows(pages = []) {
  const totals = new Map();
  pages.forEach((page) => {
    const key = page.teamMemberName || "Unassigned";
    const current = totals.get(key) || { name: key, pages: 0, followers: 0, views: 0, posts: 0, rawScore: 0 };
    current.pages += 1;
    current.followers += Number(page.metrics?.followers) || 0;
    current.views += Number(page.metrics?.views) || 0;
    current.posts += Number(page.metrics?.posts) || 0;
    current.rawScore += page.performanceScore || facebookPerformanceScore(page.metrics);
    totals.set(key, current);
  });
  const max = Math.max(1, ...[...totals.values()].map((item) => item.rawScore));
  return [...totals.values()].map((item) => ({ ...item, score: Math.round((item.rawScore / max) * 100) })).sort((a, b) => b.score - a.score);
}

export default function FacebookPerformancePage({ apiBaseUrl = "", onBack }) {
  const [state, setState] = useState({ pages: [], teams: [], sync: { refreshIntervalMinutes: 60, lastSyncAt: null } });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => { let active = true; setLoading(true); getFacebookPerformance(fetch, apiBaseUrl).then(async (data) => {
    if (!active) return; setState(data); if (data.pages?.length && data.pages.every((page) => !page.metrics?.capturedAt && page.syncStatus === "not_scanned")) { setRefreshing(true); const refreshed = await refreshFacebookPages(fetch, apiBaseUrl); if (active) setState({ pages: refreshed.pages, teams: refreshed.teams, sync: refreshed.sync }); }
  }).catch((error) => { if (active) setNotice(error.message); }).finally(() => { if (active) { setLoading(false); setRefreshing(false); } }); return () => { active = false; }; }, [apiBaseUrl]);
  const refreshNow = async () => { setRefreshing(true); setNotice(""); try { const data = await refreshFacebookPages(fetch, apiBaseUrl); setState({ pages: data.pages, teams: data.teams, sync: data.sync }); setNotice(data.message || "Public scan completed."); } catch (error) { setNotice(error.message); } finally { setRefreshing(false); } };
  const rankedPages = useMemo(() => [...state.pages].map((page) => ({ ...page, performanceScore: page.performanceScore || facebookPerformanceScore(page.metrics) })).sort((a, b) => b.performanceScore - a.performanceScore), [state.pages]);
  const teamRows = useMemo(() => teamPerformanceRows(rankedPages), [rankedPages]);
  return <section className="facebook-performance-page" aria-label="Facebook Performance page">
    <header className="facebook-performance-hero"><div><span>FACEBOOK PERFORMANCE</span><h1>Page Performance</h1><p>Public Facebook Page URL scans for followers, latest visible video/reel views, recent public posts, ranking, and team performance.</p></div><div><button type="button" onClick={refreshNow} disabled={refreshing}>{refreshing ? "Scanning..." : "Scan Now"}</button>{onBack && <button type="button" onClick={onBack}>Back</button>}</div></header>
    {notice && <div className="facebook-control-notice" role="status">{notice}</div>}
    <div className="facebook-performance-summary"><span>Last updated: {formatTime(state.sync.lastSyncAt)}</span><span>{state.pages.length} page{state.pages.length === 1 ? "" : "s"}</span></div>
    <section className="facebook-performance-section"><header><h2>Page Performance / Ranking</h2><span>{loading ? "Loading..." : "Live records"}</span></header>{loading ? <p>Loading Facebook Pages...</p> : !rankedPages.length ? <div className="facebook-empty-state performance"><strong>No Facebook Pages added yet.</strong><span>Add pages in Facebook Control, then return here to scan public metrics.</span></div> : <div className="facebook-performance-table"><div className="facebook-performance-row head"><span>Rank</span><span>Page</span><span>Manager</span><span>Followers</span><span>Views</span><span>Posts</span><span>Score</span><span>Updated</span><span>Open Page</span></div>{rankedPages.map((page, index) => <div className="facebook-performance-row" key={page.id}><b>#{index + 1}</b><button type="button" className="facebook-page-name" onClick={() => window.open(page.pageUrl, "_blank", "noopener,noreferrer")}>{page.pagePictureUrl ? <img src={page.pagePictureUrl} alt="" /> : <i>{(page.pageName || "FB").slice(0, 2).toUpperCase()}</i>}<span>{page.pageName}<small>{page.pageId || page.lastScanStatus || "Public URL"}</small></span></button><span>{page.teamMemberName || "Unassigned"}</span><span title={metricTitle(page, "followers")}>{metricStatus(page, "followers")}</span><span title={metricTitle(page, "views")}>{metricStatus(page, "views")}</span><span title={metricTitle(page, "posts")}>{metricStatus(page, "posts")}</span><strong title={statusMessage(page)}>{scoreStatus(page)}</strong><span title={page.lastScanError || statusMessage(page)}>{formatTime(page.metrics?.capturedAt || page.lastPublicScan || page.lastSyncAt)}</span><a href={page.pageUrl} target="_blank" rel="noreferrer">Open Page</a></div>)}</div>}</section>
    <section className="facebook-performance-section team-graph"><header><h2>Team Performance Graph</h2><span>0-100% normalized</span></header>{teamRows.length ? teamRows.map((team) => <div className="team-performance-row" key={team.name}><span>{team.name}<small>{team.pages} page{team.pages === 1 ? "" : "s"} · {formatCompact(team.followers)} followers · {formatCompact(team.views)} public views</small></span><em><i style={{ width: `${Math.max(4, team.score)}%` }} /></em><strong>{team.score}%</strong></div>) : <p className="facebook-waiting-state">Waiting for first successful Facebook scan</p>}</section>
  </section>;
}
