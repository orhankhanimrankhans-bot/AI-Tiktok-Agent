import { useCallback, useEffect, useRef, useState } from "react";
import { isTikTokOAuthMessage } from "./tiktokOAuth.js";

export default function TikTokCredentialModal({ apiBaseUrl = "", icon, onClose, onSave, onRefreshCredentials }) {
  const [config, setConfig] = useState(null), [tab, setTab] = useState("Connection");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const popup = useRef(null), pending = useRef(false);
  const refreshParent = useRef(onRefreshCredentials);
  useEffect(() => { refreshParent.current = onRefreshCredentials; }, [onRefreshCredentials]);
  const request = useCallback(async (route, body) => {
    const response = await fetch(`${apiBaseUrl}/api/tiktok${route}`, { credentials: "include",
      ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json", "X-Corex-TikTok": "1" }, body: JSON.stringify(body) }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "TikTok connection could not be checked.");
    return data;
  }, [apiBaseUrl]);
  const refresh = useCallback(async () => {
    const value = await request("/config"); setConfig(value);
    await refreshParent.current(); return value;
  }, [request]);
  useEffect(() => {
    let active = true;
    request("/config").then(value => { if (active) setConfig(value); }).catch(error => { if (active) setMessage(error.message); });
    const finish = async (status) => {
      pending.current = false; popup.current = null; setBusy(false);
      try { const value = await refresh(); setMessage(status === "failed" ? "TikTok sign-in was not completed. Try again." : value.connected ? "Account connected. Save to select it for this node." : "No connected account was found. Try signing in again."); }
      catch (error) { setMessage(error.message); }
    };
    const receive = event => { if (isTikTokOAuthMessage(event, popup.current, window.location.origin)) finish(event.data.status); };
    const timer = window.setInterval(() => { if (popup.current?.closed) finish(); }, 1000);
    window.addEventListener("message", receive);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("message", receive); popup.current?.close(); popup.current = null; };
  }, [request, refresh]);
  useEffect(() => {
    const escape = event => { if (event.key === "Escape") { event.stopImmediatePropagation(); onClose(); } };
    document.addEventListener("keydown", escape, true);
    return () => document.removeEventListener("keydown", escape, true);
  }, [onClose]);
  const connect = async (directPost = false) => {
    if (pending.current) return;
    const opened = window.open("", "corex-tiktok-oauth", "popup,width=620,height=740");
    if (!opened) { setMessage("Allow popups for Corex, then sign in again."); return; }
    popup.current = opened; pending.current = true; setBusy(true); setMessage("Complete sign-in in the TikTok window.");
    try {
      const result = await request("/auth/start", { directPost: directPost === true });
      const url = new URL(result.url);
      if (url.origin !== "https://www.tiktok.com" || url.pathname !== "/v2/auth/authorize/") throw new Error("TikTok returned an invalid sign-in address.");
      if (popup.current === opened && !opened.closed) opened.location.assign(url.href);
    } catch (error) { opened.close(); popup.current = null; pending.current = false; setBusy(false); setMessage(error.message); }
  };
  const disconnect = async () => {
    setBusy(true); setMessage("");
    try { const result = await request("/disconnect", {}); await refresh(); setMessage(result.message); }
    catch (error) { setMessage(error.message); } finally { setBusy(false); }
  };
  return <div className="credential-modal-overlay"><div className="credential-modal" role="dialog" aria-modal="true" aria-labelledby="tiktok-credential-title">
    <header className="credential-modal-header"><div className="credential-modal-title">{icon}<div><strong id="tiktok-credential-title">{config?.connected ? config.accountName : "TikTok account"}</strong><div className="credential-subtitle">TikTok Content Posting API OAuth2</div></div></div>
      <div className="credential-modal-actions"><button type="button" disabled={busy || !config?.connected} onClick={() => onSave(config.accountRef)}>Save</button><button type="button" onClick={onClose} aria-label="Close credential modal">×</button></div></header>
    <div className="credential-modal-body"><aside className="credential-tabs">{["Connection", "Details"].map(value => <button type="button" key={value} className={tab === value ? "credential-tab-active" : ""} onClick={() => setTab(value)}>{value}</button>)}</aside>
      <section className="credential-content google-credential-content">{tab === "Connection" ? <>
        <div className="credential-content-top"><h3>Setup credential</h3><select aria-label="Authentication method" value="oauth2" disabled><option value="oauth2">Managed OAuth2</option></select></div>
        {config?.connected ? <div className="credential-connected"><span>✓</span><strong>Account connected · {config.accountName}</strong><div><button type="button" disabled={busy} onClick={() => connect(false)}>Reconnect</button><button type="button" className="disconnect-button" disabled={busy} onClick={disconnect}>Disconnect</button></div></div> : <div className="credential-warning"><span>!</span><span>{!config ? "Checking connection…" : config.configured ? "Connect your account to use this credential" : "TikTok app is not configured on this server."}</span><button type="button" disabled={busy || !config?.configured} onClick={() => connect(false)}>Sign in with TikTok</button></div>}
        <button type="button" disabled={busy} onClick={() => refresh().catch(error => setMessage(error.message))}>Refresh connection</button>
        <div className="credential-note">This connection is private to your Corex workspace. The node operation determines inbox upload or reviewed Direct Post.</div>{config?.directPostEnabled && <><p>{config.directPostAuthorized ? "Direct Post permission granted." : "Reconnect to grant video.publish for Direct Post testing."}</p><button type="button" disabled={busy} onClick={() => connect(true)}>Connect with Direct Post permission</button></>}
        <div className="credential-note">OAuth tokens are stored on the Corex backend, not in this browser.</div>
      </> : <div className="credential-metadata-panel"><h3>Credential details</h3><dl><div><dt>Provider</dt><dd>TikTok</dd></div><div><dt>Credential type</dt><dd>OAuth2</dd></div><div><dt>Status</dt><dd>{config?.connected ? "Connected" : "Not connected"}</dd></div><div><dt>Account</dt><dd>{config?.accountName || "Not connected"}</dd></div><div><dt>Operations</dt><dd>Inbox upload; Direct Post when enabled and authorized</dd></div><div><dt>Workspace</dt><dd>Private · one connected TikTok account</dd></div></dl></div>}
      {message && <div className="credential-backend-status" role="status">{message}</div>}</section>
    </div></div></div>;
}
