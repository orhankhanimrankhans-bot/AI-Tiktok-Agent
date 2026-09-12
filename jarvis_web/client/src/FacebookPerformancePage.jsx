import { useEffect, useMemo, useState } from "react";
import { facebookPerformanceScore, getFacebookPerformance, refreshFacebookPages } from "./facebookControlApi.js";

function formatCompact(value) {
  if (value === null || value === undefined || value === "") return "Metric unavailable";
  const number = Number(value);
  if (!Number.isFinite(number)) return "Metric unavailable";
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(number);
}
function formatTime(value) { return value ? new Date(value).toLocaleString() : "Waiting for sync"; }
function statusMessage(page) {
  if (page.metrics?.capturedAt) return page.syncMessage || "Synced";
  const status = page.syncStatus || page.dataConnectionStatus;
  return ({ connection_required: "Facebook connection required.", credential_not_found: "Facebook connection required.", token_expired: "Facebook token expired.", permission_required: "Page permission required.", page_access_required: "Page access required.", rate_limited: "Facebook API temporarily rate limited.", metric_unavailable: "Metric unavailable with current Facebook API permissions.", not_synced: "Waiting for first successful Facebook sync." })[status] || page.syncMessage || "Waiting for first successful Facebook sync.";
}
function metricStatus(page, key) { return page.metrics?.[key] === null || page.metrics?.[key] === undefined ? "0" : formatCompact(page.metrics[key]); }
export function teamPerformanceRows(pages = []) {
  const grouped = new Map();
  for (const page of pages) {
    if (!page.metrics?.capturedAt) continue;
    const name = page.teamMemberName || "Unassigned";
    const current = grouped.get(name) || { name, pages: 0, rawScore: 0, followers: 0, views: 0, posts: 0 };
    current.pages += 1;
    current.followers += Number(page.metrics.followers) || 0;
    current.views += Number(page.metrics.views) || 0;
    current.posts += Number(page.metrics.posts ?? page.metrics.reels) || 0;
    current.rawScore += page.performanceScore || facebookPerformanceScore(page.metrics);
    grouped.set(name, current);
  }
  const rows = [...grouped.values()]; const max = Math.max(1, ...rows.map((row) => row.rawScore));
  return rows.map((row) => ({ ...row, score: Math.round((row.rawScore / max) * 100) })).sort((a, b) => b.score - a.score);
}

export default function FacebookPerformancePage({ apiBaseUrl = "", onBack }) {
  const [state, setState] = useState({ pages: [], teams: [], sync: { refreshIntervalMinutes: 5, lastSyncAt: null } });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => { let active = true; setLoading(true); getFacebookPerformance(fetch, apiBaseUrl).then(async (data) => {
    if (!active) return;
    setState(data);
    const needsMetrics = data.pages?.some((page) => !page.metrics?.capturedAt);
    if (needsMetrics) {
      setRefreshing(true);
      try { const refreshed = await refreshFacebookPages(fetch, apiBaseUrl); if (active) setState({ teams: refreshed.teams, pages: refreshed.pages, sync: refreshed.sync }); }
      catch (error) { if (active) setNotice(error.message); }
      finally { if (active) setRefreshing(false); }
    }
  }).catch((error) => { if (active) setNotice(error.message); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [apiBaseUrl]);
  const refreshNow = async () => { setRefreshing(true); try { const data = await refreshFacebookPages(fetch, apiBaseUrl); setState({ teams: data.teams, pages: data.pages, sync: data.sync }); setNotice(data.message || "Facebook data refreshed."); } catch (error) { setNotice(error.message); } finally { setRefreshing(false); } };
  const rankedPages = useMemo(() => [...state.pages].map((page) => ({ ...page, performanceScore: page.performanceScore || facebookPerformanceScore(page.metrics) })).sort((a, b) => b.performanceScore - a.performanceScore), [state.pages]);
  const teamRows = useMemo(() => teamPerformanceRows(rankedPages), [rankedPages]);
  return <section className="facebook-performance-page" aria-label="Facebook Performance page">
    <header className="facebook-performance-hero"><div><span>FACEBOOK PERFORMANCE</span><h1>Page Performance</h1><p>Real stored Facebook Page records, server-side Meta sync, ranking, and team performance.</p></div><div><button type="button" onClick={refreshNow} disabled={refreshing}>{refreshing ? "Updating..." : "Update Metrics"}</button>{onBack && <button type="button" onClick={onBack}>Back</button>}</div></header>
    {notice && <div className="facebook-control-notice" role="status">{notice}</div>}
    <div className="facebook-performance-meta"><span>Last updated: {formatTime(state.sync?.lastSyncAt)}</span><span>{rankedPages.length} page{rankedPages.length === 1 ? "" : "s"}</span></div>
    <section className="facebook-performance-section"><header><h2>Page Performance / Ranking</h2><span>{loading ? "Loading..." : "Live records"}</span></header>{loading ? <p>Loading Facebook Pages...</p> : !rankedPages.length ? <div className="facebook-empty-state performance"><strong>No Facebook Pages added yet.</strong><span>Add pages in Facebook Control, then return here to refresh metrics.</span></div> : <div className="facebook-performance-table"><div className="facebook-performance-row head"><span>Rank</span><span>Page</span><span>Manager</span><span>Followers</span><span>Views</span><span>Posts</span><span>Score</span><span>Updated</span><span>Open Page</span></div>{rankedPages.map((page, index) => <div className="facebook-performance-row" key={page.id}><b>#{index + 1}</b><button type="button" className="facebook-page-name" onClick={() => window.open(page.pageUrl, "_blank", "noopener,noreferrer")}>{page.pagePictureUrl ? <img src={page.pagePictureUrl} alt="" /> : <i>{(page.pageName || "FB").slice(0, 2).toUpperCase()}</i>}<span>{page.pageName}<small>{page.pageId || "Page ID pending"}</small></span></button><span>{page.teamMemberName || "Unassigned"}</span><span title={statusMessage(page)}>{metricStatus(page, "followers")}</span><span title={statusMessage(page)}>{metricStatus(page, "views")}</span><span title={statusMessage(page)}>{metricStatus(page, "posts")}</span><strong>{page.metrics?.capturedAt ? `${page.performanceScore}%` : "0%"}</strong><span>{formatTime(page.metrics?.capturedAt || page.lastSyncAt)}</span><a href={page.pageUrl} target="_blank" rel="noreferrer">Open Page</a></div>)}</div>}</section>
    <section className="facebook-performance-section team-graph"><header><h2>Team Performance Graph</h2><span>0-100% normalized</span></header>{teamRows.length ? teamRows.map((team) => <div className="team-performance-row" key={team.name}><span>{team.name}<small>{team.pages} page{team.pages === 1 ? "" : "s"} · {formatCompact(team.followers)} followers</small></span><em><i style={{ width: `${Math.max(4, team.score)}%` }} /></em><strong>{team.score}%</strong></div>) : <p className="facebook-waiting-state">Waiting for first successful Facebook sync</p>}</section>
  </section>;
}
