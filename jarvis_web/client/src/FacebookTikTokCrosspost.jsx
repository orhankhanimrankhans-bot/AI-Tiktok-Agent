import { useEffect, useRef, useState } from "react";
import { useJarvisAuth } from "./JarvisAuth.jsx";
import "./FacebookTikTokCrosspost.css";

const base = "/api/crosspost/facebook-tiktok";
const privacy = { SELF_ONLY: "Only me", PUBLIC_TO_EVERYONE: "Everyone", MUTUAL_FOLLOW_FRIENDS: "Friends", FOLLOWER_OF_CREATOR: "Followers" };
const defaults = { title: "", privacy_level: "", allow_comment: false, allow_duet: false, allow_stitch: false, is_aigc: false, discloseCommercial: false, brand_content_toggle: false, brand_organic_toggle: false, consent: false, musicConsent: false };
async function api(url, body) {
  const response = await fetch(url, { credentials: "include", ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json", "X-Corex-Crosspost": "1" }, body: JSON.stringify(body) }) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "Crossposting request failed.");
  return value;
}
export default function FacebookTikTokCrosspost() {
  const { can } = useJarvisAuth();
  const allowed = ["view_facebook", "manage_workflow_credentials", "run_workflow"].every(can);
  const [data, setData] = useState({ routes: [], items: [] }), [accounts, setAccounts] = useState([]), [tiktok, setTikTok] = useState(null);
  const [source, setSource] = useState(""), [selectedRoute, setSelectedRoute] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [review, setReview] = useState(null), [form, setForm] = useState(defaults), [times, setTimes] = useState({});
  const reviewPanel = useRef(null);
  const refresh = async () => {
    const [queue, facebook, config] = await Promise.all([api(base), api("/api/facebook/credentials"), api("/api/tiktok/config")]);
    setData(queue); setAccounts(facebook.credentials.filter(c => c.connected && c.pageId)); setTikTok(config);
    setSelectedRoute(current => current || queue.routes[0]?.id || "");
  };
  useEffect(() => { if (allowed) { const start = setTimeout(() => refresh().catch(e => setError(e.message)), 0); return () => clearTimeout(start); } }, [allowed]);
  useEffect(() => { if (review) reviewPanel.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [review]);
  async function run(action) { setBusy(true); setError(""); try { await action(); await refresh(); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  const command = (item, name, body = {}) => api(`${base}/items/${item.id}/${name}`, body);
  const change = (name, value) => setForm(current => ({ ...current, [name]: value, consent: false, musicConsent: false }));
  const route = data.routes.find(r => r.id === selectedRoute);
  const valid = review && form.privacy_level && form.consent && form.musicConsent && (!form.discloseCommercial || form.brand_content_toggle || form.brand_organic_toggle) && !(form.brand_content_toggle && form.privacy_level === "SELF_ONLY");
  return <main className="fbtt-page">
    <header><a href="/tiktok">← TikTok</a><a href="/">Back to Corex</a></header>
    <h1>Facebook → TikTok</h1><p>Discover videos from your connected Facebook Page and publish reviewed videos to TikTok, now or on a schedule.</p>
    {!allowed ? <p role="alert">Your existing access does not allow this feature. Account permissions have not been changed.</p> : <>
      <aside>Each new video needs review before posting. Approved posts run automatically at their scheduled time while Corex is running. Existing workflows are separate.</aside>
      {tiktok && !tiktok.directPostPublicEnabled && <aside>Private testing only. Public TikTok posting requires approved app access and server configuration.</aside>}
      {!tiktok?.connected && <p>Connect your TikTok account through <a href="/tiktok">TikTok settings</a> first.</p>}
      {tiktok?.connected && !tiktok.directPostAuthorized && <p>Reconnect your TikTok credential with Direct Post permission in the existing TikTok node.</p>}
      {error && <p role="alert" className="fbtt-error">{error}</p>}
      <section><h2>Create a crossposting route</h2>
        <label>Facebook Page<select value={source} onChange={e => setSource(e.target.value)} disabled={busy}><option value="">Choose a connected Page</option>{accounts.map(c => <option key={c.id} value={c.id}>{c.pageName || c.name} · {c.pageId}</option>)}</select></label>
        <p>TikTok destination: <strong>{tiktok?.accountName || "Not connected"}</strong></p>
        <button disabled={busy || !source || !tiktok?.connected} onClick={() => run(async () => { const page = accounts.find(c => c.id === source); const r = await api(`${base}/routes`, { credential: page.id, page: page.pageId, account: tiktok.accountRef }); setSelectedRoute(r.id); })}>Create route</button>
      </section>
      {data.routes.length > 0 && <section><h2>Source and discovery</h2>
        <label>Route<select value={selectedRoute} disabled={busy} onChange={e => { setSelectedRoute(e.target.value); setReview(null); }}>{data.routes.map(r => <option key={r.id} value={r.id}>{accounts.find(c => c.id === r.credential)?.pageName || r.page} → {r.account === tiktok?.accountRef ? tiktok.accountName : "Previously connected TikTok account"}</option>)}</select></label>
        {route && <><label className="fbtt-check"><input type="checkbox" checked={!!route.enabled} disabled={busy} onChange={e => { const enabled = e.target.checked; run(() => api(`${base}/routes/${route.id}/toggle`, { enabled })); }} /> Check for new Facebook videos every five minutes</label>
          <p>New videos enter the review queue. Discovery does not authorize publication.</p>
          <button disabled={busy} onClick={() => run(() => api(`${base}/routes/${route.id}/scan`, {}))}>Check Facebook now</button>
          <p>{route.checked ? `Last checked: ${new Date(route.checked).toLocaleString()}` : "Not checked yet"} · {route.message}</p></>}
      </section>}
      <section><div className="fbtt-heading"><h2>Video queue</h2><button disabled={busy} onClick={() => run(refresh)}>Refresh status list</button></div>
        <p>MP4/MOV up to 32 MiB. Up to 10 downloaded videos per workspace. The most recent 500 queue entries are shown.</p>
        {!data.items.some(i => i.route === selectedRoute) && <p>No videos found yet. Select a route and check Facebook.</p>}
        {data.items.filter(i => i.route === selectedRoute).map(i => <article key={i.id}>
          <strong>{i.status.replaceAll("_", " ")}</strong><p>{i.caption || "No caption"}</p>
          <a href={`https://www.facebook.com/${i.video}`} target="_blank" rel="noreferrer">View Facebook video</a>
          {i.created > 0 && <small> · {new Date(i.created).toLocaleString()}</small>}
          {i.due && <p>Scheduled: {new Date(i.due).toLocaleString()}</p>}{i.message && <p role="status">{i.message}</p>}
          <div className="fbtt-actions">
            {["NEEDS_REVIEW", "READY", "REJECTED", "FAILED", "BLOCKED"].includes(i.status) && <button disabled={busy || !tiktok?.directPostAuthorized} onClick={() => run(async () => { setReview(null); const result = await command(i, "review"); setForm({ ...defaults, title: result.caption }); setReview({ ...result, item: i }); })}>Review video</button>}
            {i.status === "APPROVED" && <><button disabled={busy} onClick={() => run(() => command(i, "publish"))}>Publish approved video now</button>
              <label>Schedule in your local time<input type="datetime-local" value={times[i.id] || ""} disabled={busy} onChange={e => setTimes({ ...times, [i.id]: e.target.value })} /></label>
              <button disabled={busy || !times[i.id]} onClick={() => run(() => command(i, "schedule", { due: new Date(times[i.id]).getTime() }))}>Schedule within six days</button></>}
            {i.review && <button disabled={busy} onClick={() => run(() => command(i, "status"))}>Check TikTok status</button>}
            {["READY", "APPROVED", "SCHEDULED", "REJECTED", "FAILED", "BLOCKED"].includes(i.status) && <button disabled={busy} onClick={() => run(async () => { await command(i, "cancel"); setReview(null); })}>Cancel approval / schedule</button>}
            {["NEEDS_REVIEW", "READY", "APPROVED", "SCHEDULED", "REJECTED", "FAILED", "PUBLISHED", "BLOCKED"].includes(i.status) && <button disabled={busy} onClick={() => run(async () => { await command(i, "cancel", { discard: true }); setReview(null); })}>Remove local copy{ i.status !== "PUBLISHED" ? " and approval" : ""}</button>}
          </div>
        </article>)}
      </section>
      {review && <section className="fbtt-review" ref={reviewPanel}><h2>Review this video</h2><p>Posting as <strong>{review.creator.creator_nickname}</strong></p>
        <video controls src={review.previewUrl} preload="metadata" />
        <p>{review.duration.toFixed(1)} seconds · account limit {review.creator.max_video_post_duration_sec} seconds</p>
        <fieldset disabled={busy}>
          <label>Caption<textarea value={form.title} maxLength={2200} onChange={e => change("title", e.target.value)} /></label>
          <label>Who can view this video?<select value={form.privacy_level} onChange={e => change("privacy_level", e.target.value)}><option value="">Choose privacy</option>{review.creator.privacy_level_options.map(p => <option key={p} value={p} disabled={(!review.publicEnabled && p !== "SELF_ONLY") || (form.brand_content_toggle && p === "SELF_ONLY")}>{privacy[p] || p}</option>)}</select></label>
          {["comment", "duet", "stitch"].map(p => <label className="fbtt-check" key={p}><input type="checkbox" disabled={review.creator[`${p}_disabled`]} checked={form[`allow_${p}`]} onChange={e => change(`allow_${p}`, e.target.checked)} />Allow {p}{review.creator[`${p}_disabled`] ? " (unavailable for this account)" : ""}</label>)}
          <label className="fbtt-check"><input type="checkbox" checked={form.is_aigc} onChange={e => change("is_aigc", e.target.checked)} />Label as AI-generated content</label>
          <label className="fbtt-check"><input type="checkbox" checked={form.discloseCommercial} onChange={e => setForm({ ...form, discloseCommercial: e.target.checked, brand_content_toggle: false, brand_organic_toggle: false, consent: false, musicConsent: false })} />This video promotes a brand, product or service</label>
          {form.discloseCommercial && <><label className="fbtt-check"><input type="checkbox" checked={form.brand_organic_toggle} onChange={e => change("brand_organic_toggle", e.target.checked)} />Your brand</label>
            <label className="fbtt-check"><input type="checkbox" disabled={form.privacy_level === "SELF_ONLY"} checked={form.brand_content_toggle} onChange={e => change("brand_content_toggle", e.target.checked)} />Branded content (cannot be Only me)</label><p>{form.brand_content_toggle ? "TikTok will label this as Paid partnership." : form.brand_organic_toggle ? "TikTok will label this as Promotional content." : "Select a disclosure."}</p></>}
          <label className="fbtt-check"><input type="checkbox" checked={form.musicConsent} onChange={e => setForm({ ...form, musicConsent: e.target.checked })} /><span>By posting, I agree to TikTok’s <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noreferrer">Music Usage Confirmation</a>{form.brand_content_toggle && <> and <a href="https://www.tiktok.com/legal/page/global/bc-policy/en" target="_blank" rel="noreferrer">Branded Content Policy</a></>}.</span></label>
          <label className="fbtt-check"><input type="checkbox" checked={form.consent} onChange={e => setForm({ ...form, consent: e.target.checked })} />I reviewed this exact video, caption and settings, have permission to share it, and authorize one manual or scheduled TikTok post.</label>
          <button disabled={!valid} onClick={() => run(async () => { await command(review.item, "approve", form); setReview(null); })}>Approve this video</button><p>Approval does not post immediately. Choose Publish or Schedule in the queue afterwards.</p>
        </fieldset>
      </section>}
    </>}
  </main>;
}
