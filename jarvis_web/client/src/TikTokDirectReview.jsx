import { useState } from "react";
import { buildTikTokUploadRequest } from "./tiktokConfig.js";

const privacyLabels = { PUBLIC_TO_EVERYONE: "Everyone", MUTUAL_FOLLOW_FRIENDS: "Friends", FOLLOWER_OF_CREATOR: "Followers", SELF_ONLY: "Only me" };
const defaults = { title: "", privacy_level: "", allow_comment: false, allow_duet: false, allow_stitch: false, discloseCommercial: false, brand_content_toggle: false, brand_organic_toggle: false, is_aigc: false, consent: false, musicConsent: false };

export default function TikTokDirectReview({ config, input, apiBaseUrl = "" }) {
  const items = Array.isArray(input) ? input : input ? [input] : [];
  const [selected, setSelected] = useState(0), [review, setReview] = useState(null), [form, setForm] = useState(defaults);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [posts, setPosts] = useState([]);
  const request = async (route, body) => {
    const response = await fetch(`${apiBaseUrl}/api/tiktok${route}`, { credentials: "include", ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json", "X-Corex-TikTok": "1" }, body: JSON.stringify(body) }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Direct Post request failed.");
    return data;
  };
  const run = async action => { setBusy(true); setMessage(""); try { await action(); } catch (error) { setMessage(error.message); } finally { setBusy(false); } };
  const refresh = async () => setPosts((await request("/direct/posts")).posts);
  const load = () => run(async () => {
    setReview(null);
    const item = items[selected];
    const value = await request("/direct/review", buildTikTokUploadRequest({ ...config, operation: "Direct Post" }, item));
    setForm({ ...defaults, title: String(item?.socialCaptionWithHashtags || item?.caption || item?.title || "").slice(0, 2200) });
    setReview(value); await refresh();
  });
  const update = (field, value) => setForm(current => ({ ...current, [field]: value, consent: false, musicConsent: false }));
  const valid = review && form.privacy_level && form.consent && form.musicConsent && (!form.discloseCommercial || form.brand_content_toggle || form.brand_organic_toggle) && !(form.brand_content_toggle && form.privacy_level === "SELF_ONLY");
  return <section aria-label="Review TikTok Direct Post">
    <p>Review each video before publishing. An approval covers the exact video, caption, and settings for one manual or scheduled post within 7 days. New videos require their own review.</p>
    <label>Input video</label><select disabled={busy} value={selected} onChange={event => { setSelected(Number(event.target.value)); setReview(null); }}>{items.length ? items.map((item, index) => <option key={index} value={index}>{item?.fileName || `Video ${index + 1}`}</option>) : <option value={0}>Execute previous nodes first</option>}</select>
    <button type="button" disabled={busy || !items.length || !config.credentialId} onClick={load}>Load video and TikTok posting options</button>
    {review && <fieldset disabled={busy} style={{ border: 0, padding: 0 }}>
      <p>Posting as <strong>{review.creator.creator_nickname}</strong></p>
      {!review.publicEnabled && <p>Private testing only. Public posting is unavailable until TikTok approves the app and the server is configured for it.</p>}
      <video controls preload="metadata" src={`${apiBaseUrl}${review.previewUrl}`} style={{ width: "100%", maxHeight: 280 }} aria-label="Video to post to TikTok" />
      <p>{review.duration.toFixed(1)} seconds / {review.creator.max_video_post_duration_sec} seconds maximum</p>
      <label>Caption</label><textarea value={form.title} maxLength={2200} onChange={event => update("title", event.target.value)} />
      <label>Who can view this video?</label><select value={form.privacy_level} onChange={event => update("privacy_level", event.target.value)}><option value="">Choose privacy</option>{review.creator.privacy_level_options.map(value => <option key={value} value={value} disabled={(!review.publicEnabled && value !== "SELF_ONLY") || (form.brand_content_toggle && value === "SELF_ONLY")}>{privacyLabels[value] || value}{!review.publicEnabled && value !== "SELF_ONLY" ? " (requires audit)" : ""}</option>)}</select>
      {review.creator.privacy_level_options.length === 0 && <p>TikTok currently provides no posting options. Try again later.</p>}
      {["comment", "duet", "stitch"].map(field => <label key={field} style={{ display: "block" }}><input type="checkbox" checked={form[`allow_${field}`]} disabled={review.creator[`${field}_disabled`]} onChange={event => update(`allow_${field}`, event.target.checked)} /> Allow {field}{review.creator[`${field}_disabled`] ? " (disabled in TikTok)" : ""}</label>)}
      <label style={{ display: "block" }}><input type="checkbox" checked={form.is_aigc} onChange={event => update("is_aigc", event.target.checked)} /> Label as AI-generated content</label>
      <label style={{ display: "block" }}><input type="checkbox" checked={form.discloseCommercial} onChange={event => setForm({ ...form, discloseCommercial: event.target.checked, brand_content_toggle: false, brand_organic_toggle: false, consent: false, musicConsent: false })} /> This video promotes a brand, product, or service</label>
      {form.discloseCommercial && <>
        <label style={{ display: "block" }}><input type="checkbox" checked={form.brand_organic_toggle} onChange={event => update("brand_organic_toggle", event.target.checked)} /> Your brand</label>
        <label style={{ display: "block" }}><input type="checkbox" checked={form.brand_content_toggle} disabled={form.privacy_level === "SELF_ONLY"} onChange={event => update("brand_content_toggle", event.target.checked)} /> Branded content {form.privacy_level === "SELF_ONLY" && "(cannot be private)"}</label>
        <p>{form.brand_content_toggle ? "Your video will be labeled as Paid partnership." : form.brand_organic_toggle ? "Your video will be labeled as Promotional content." : "Choose at least one disclosure before approving."}</p>
      </>}
      <label style={{ display: "block" }}><input type="checkbox" checked={form.musicConsent} onChange={event => setForm({ ...form, musicConsent: event.target.checked })} /> By posting, you agree to TikTok's {form.brand_content_toggle && <><a href="https://www.tiktok.com/legal/page/global/bc-policy/en" target="_blank" rel="noreferrer">Branded Content Policy</a> and </>}<a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noreferrer">Music Usage Confirmation</a>.</label>
      <label style={{ display: "block" }}><input type="checkbox" checked={form.consent} onChange={event => setForm({ ...form, consent: event.target.checked })} /> I reviewed this video and authorize one post to {review.creator.creator_nickname} with these settings on a manual or scheduled Corex workflow run. I have permission to share it.</label>
      <button type="button" disabled={busy || !valid} onClick={() => run(async () => { const result = await request("/direct/approve", { ...form, reviewId: review.id }); setMessage(result.message); setReview(null); await refresh(); })}>Approve this video for Direct Post</button>
      <p>Approval does not post immediately. Use Execute step or your saved workflow schedule. Published videos may take a few minutes to appear on TikTok.</p>
    </fieldset>}
    <button type="button" disabled={busy} onClick={() => run(refresh)}>Refresh approvals and posts</button>
    {posts.map(post => <div key={post.id} style={{ borderTop: "1px solid #555", padding: "12px 0" }}><strong>{post.status}</strong><p>{post.post.title || "No caption"} &middot; {privacyLabels[post.post.privacy_level] || post.post.privacy_level}</p>
      {["APPROVED", "REJECTED", "FAILED"].includes(post.status) ? <><small>Expires {new Date(post.expires_at).toLocaleString()}</small><button type="button" disabled={busy} onClick={() => run(async () => { await request(`/direct/posts/${post.id}/cancel`, {}); await refresh(); })}>Cancel approval</button></> : <button type="button" disabled={busy} onClick={() => run(async () => { const value = await request(`/direct/posts/${post.id}/status`, {}); setMessage(value.status); await refresh(); })}>Check post status</button>}
    </div>)}
    {message && <p role="status">{message}</p>}
  </section>;
}
