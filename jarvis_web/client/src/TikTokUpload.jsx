import { useEffect, useState } from "react";
import { returnTikTokPopup } from "./tiktokOAuth.js";
import { useJarvisAuth } from "./JarvisAuth.jsx";
import "./TikTokUpload.css";

async function request(path, body, extra = {}) {
  const response = await fetch(`/api/tiktok${path}`, { credentials: "include", ...extra,
    headers: { "Content-Type": "application/json", "X-Corex-TikTok": "1", ...extra.headers },
    ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "TikTok request failed.");
  return data;
}
const statusText = {
  INITIALIZING: "Upload requested — check status before retrying",
  TRANSFERRING: "Video transfer in progress",
  PROCESSING_UPLOAD: "TikTok is processing the upload",
  PROCESSING_DOWNLOAD: "TikTok is processing the video",
  SEND_TO_USER_INBOX: "Sent to TikTok inbox — open TikTok to edit and post",
  PUBLISH_COMPLETE: "TikTok reports publication complete",
  FAILED: "TikTok could not process this upload",
  OUTCOME_UNCERTAIN: "Outcome uncertain — check status and TikTok inbox",
  STATUS_UNKNOWN: "Status unavailable",
};
export default function TikTokUpload() {
  const { session, can } = useJarvisAuth();
  const [config, setConfig] = useState(null), [file, setFile] = useState(null), [preview, setPreview] = useState("");
  const [consent, setConsent] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [message, setMessage] = useState(""), [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const allowed = can("manage_workflow_credentials") && can("run_workflow");
  const refresh = async () => setConfig(await request("/config"));
  useEffect(() => { if (allowed) refresh().catch(e => setError(e.message)); }, [allowed, session.workspaceId]);
  useEffect(() => {
    if (!file) { setPreview(""); return; }
    const url = URL.createObjectURL(file); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("connection");
    if (returnTikTokPopup(window, result)) return;
    if (result === "connected") setMessage("TikTok account connected.");
    if (result === "failed") setError("TikTok connection was not completed. Check your app configuration and try connecting again.");
    if (result) window.history.replaceState({}, "", "/tiktok");
  }, []);
  async function run(action) { setBusy(true); setError(""); setMessage(""); try { await action(); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  const upload = () => run(async () => {
    const type = file.type || (/\.mov$/i.test(file.name) ? "video/quicktime" : /\.webm$/i.test(file.name) ? "video/webm" : "video/mp4");
    const response = await fetch("/api/tiktok/uploads", { method: "POST", credentials: "include", headers: {
      "Content-Type": type, "X-Corex-TikTok": "1", "X-TikTok-Consent": "upload-to-inbox", "Idempotency-Key": requestId,
      "X-TikTok-Account": config.accountRef,
    }, body: file });
    const result = await response.json();
    await refresh();
    setConsent(false);
    if (!response.ok) throw new Error(result.error || "Upload failed. Check status before retrying.");
    setMessage(result.message || statusText[result.status] || "Check upload status.");
  });
  return <main className="tiktok-page">
    <header><a href="/">← Back to Corex</a><span>COREX / TIKTOK</span></header>
    <section className="tiktok-card"><p className="tiktok-eyebrow">SHARE YOUR VIDEO</p><h1>Upload to TikTok</h1>
      <p>Preview your video and send it to your connected TikTok account. Open the inbox notification in TikTok to edit the caption, choose post settings, and publish.</p>
      {!allowed ? <p role="alert">Your Corex session needs account connection and workflow execution permissions.</p> : <>
        <div className="tiktok-account"><strong>{config?.connected ? config.accountName : "Not connected"}</strong>
          <span>{config && !config.configured ? "TikTok app is not configured on this server." : "One TikTok account per Corex workspace."}</span>
          <button disabled={busy || !config?.configured} onClick={() => run(async () => { const value = await request("/auth/start", {}); window.location.assign(value.url); })}>{config?.connected ? "Connect a different account" : "Connect TikTok"}</button>
          {config?.connected && <button className="tiktok-secondary" disabled={busy} onClick={() => run(async () => { const result = await request("/disconnect", {}); setMessage(result.message); setFile(null); setConsent(false); await refresh(); })}>Disconnect TikTok</button>}
        </div>
        <label className="tiktok-file">Choose video <small>MP4, MOV, or WebM · up to 32 MiB</small><input type="file" accept="video/mp4,video/quicktime,video/webm,.mov" disabled={busy || !config?.connected} onChange={event => {
          const selected = event.target.files?.[0]; setConsent(false); setRequestId(crypto.randomUUID()); setError(""); setMessage("");
          if (selected && selected.size > (config?.maxVideoBytes || 33554432)) { setError("Choose a video up to 32 MiB."); setFile(null); return; }
          setFile(selected || null);
        }} /></label>
        {preview && <video src={preview} controls preload="metadata" aria-label="Selected video preview" />}
        <label className="tiktok-consent"><input type="checkbox" checked={consent} disabled={busy || !file || !config?.connected} onChange={e => setConsent(e.target.checked)} />I reviewed this video and authorize sending it to {config?.accountName || "my TikTok account"}. I have permission to share this content.</label>
        <button disabled={busy || !file || !consent || !config?.connected || !config?.configured} onClick={upload}>{busy ? "Please wait…" : "Send to TikTok inbox"}</button>
        <p className="tiktok-note">This does not publish automatically. Finish editing and posting in TikTok.</p>
        {!!config?.uploads?.length && <section><h2>Recent uploads</h2><ul className="tiktok-jobs">{config.uploads.map(job => <li key={job.id}><span>{statusText[job.status] || "Check upload status"}<small>{new Date(job.created_at).toLocaleString()}</small></span><button className="tiktok-secondary" disabled={busy} onClick={() => run(async () => { const result = await request(`/uploads/${job.id}/status`, {}); setMessage(result.message || statusText[result.status]); await refresh(); })}>Check status</button></li>)}</ul></section>}
      </>}
      {error && <p className="tiktok-error" role="alert">{error}</p>}{message && <p className="tiktok-message" role="status">{message}</p>}
      <footer><a href="/privacy-policy">Privacy Policy</a><a href="/terms">Terms of Service</a></footer>
    </section>
  </main>;
}
