import { useCallback, useEffect, useRef, useState } from "react";
import "./Instagram.css";

export default function InstagramCredentialModal({ apiBaseUrl = "", onClose, onSave, onRefreshCredentials }) {
  const [config, setConfig] = useState(null), [appId, setAppId] = useState(""), [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const popup = useRef(null), refreshParent = useRef(onRefreshCredentials);
  useEffect(() => { refreshParent.current = onRefreshCredentials; }, [onRefreshCredentials]);
  const request = useCallback(async (route, body) => {
    const response = await fetch(`${apiBaseUrl}/api/instagram${route}`, { credentials: "include", ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json", "X-Corex-Instagram": "1" }, body: JSON.stringify(body) }) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || "Instagram connection failed."); return data;
  }, [apiBaseUrl]);
  const refresh = useCallback(async () => { const data = await request("/config"); setConfig(data); setAppId(data.appId); await refreshParent.current?.(); return data; }, [request]);
  useEffect(() => {
    Promise.resolve().then(refresh).catch(error => setMessage(error.message));
    const timer = window.setInterval(() => {
      if (!popup.current) return;
      let finished = popup.current.closed, failed = false;
      try { const location = new URL(popup.current.location.href); if (location.origin === window.location.origin && location.searchParams.has("instagram")) { finished = true; failed = location.searchParams.get("instagram") !== "connected"; popup.current.close(); } } catch { /* Instagram sign-in is cross-origin. */ }
      if (finished) { popup.current = null; setBusy(false); refresh().then(data => setMessage(failed ? "Instagram sign-in failed. Check your app settings and try again." : data.connected ? "Account connected. Select Use this account." : "Sign-in was not completed.")).catch(error => setMessage(error.message)); }
    }, 1000);
    return () => { window.clearInterval(timer); popup.current?.close(); };
  }, [refresh]);
  const action = async operation => { setBusy(true); setMessage(""); try { await operation(); } catch (error) { setMessage(error.message); } finally { setBusy(false); } };
  const connect = async () => {
    const opened = window.open("", "corex-instagram-oauth", "popup,width=620,height=740");
    if (!opened) { setMessage("Allow popups for Corex, then connect again."); return; }
    popup.current = opened; setBusy(true); setMessage("Complete Instagram sign-in in the opened window.");
    try { const result = await request("/auth/start", {}), url = new URL(result.url); if (url.origin !== "https://www.instagram.com" || url.pathname !== "/oauth/authorize") throw new Error("Invalid sign-in address."); opened.location.assign(url.href); }
    catch (error) { opened.close(); popup.current = null; setBusy(false); setMessage(error.message); }
  };
  return <div className="credential-modal-overlay"><div className="credential-modal instagram-credential-modal" role="dialog" aria-modal="true" aria-labelledby="instagram-credential-title">
    <header className="credential-modal-header"><div className="credential-modal-title"><strong id="instagram-credential-title">Instagram account</strong></div><div className="credential-modal-actions"><button type="button" disabled={busy || !config?.connected} onClick={() => onSave(config.accountRef)}>Use this account</button><button type="button" aria-label="Close Instagram connection" onClick={onClose}>×</button></div></header>
    <div className="credential-modal-body"><section className="credential-content google-credential-content">
      <h3>{config?.connected ? `Connected · @${config.accountName}` : "Connect a Creator or Business account"}</h3>
      <p>This connection belongs to your Corex workspace. Use your Instagram App ID and secret from Meta’s Instagram API setup with Instagram Login.</p>
      <label htmlFor="instagram-app-id">Instagram App ID</label><input id="instagram-app-id" autoComplete="off" value={appId} onChange={event => setAppId(event.target.value.trim())} disabled={busy} />
      <label htmlFor="instagram-app-secret">Instagram App Secret</label><input id="instagram-app-secret" type="password" autoComplete="new-password" value={secret} onChange={event => setSecret(event.target.value.trim())} placeholder={config?.configured ? "Saved securely; leave blank to keep" : "Enter app secret"} disabled={busy} />
      <p>Redirect URI: <code style={{ overflowWrap: "anywhere" }}>{config?.redirectUri || "Loading…"}</code></p>
      <button type="button" disabled={busy || !appId} onClick={() => action(async () => { await request("/config", { appId, appSecret: secret }); setSecret(""); await refresh(); setMessage("App settings saved. Connect Instagram next."); })}>Save app settings</button>
      <p>App testers can connect while the Meta app is in development. Connecting other accounts requires the appropriate Meta review and access. Creating a Creator account alone does not grant API publishing access.</p>
      <div className="credential-modal-actions"><button type="button" disabled={busy || !config?.configured} onClick={connect}>{config?.connected ? "Reconnect Instagram" : "Connect Instagram"}</button><button type="button" disabled={busy} onClick={() => action(refresh)}>Refresh</button>{config?.connected && <button type="button" disabled={busy} onClick={() => action(async () => { const data = await request("/disconnect", {}); await refresh(); setMessage(data.message); })}>Disconnect</button>}</div>
      {message && <p role="status">{message}</p>}
    </section></div>
  </div></div>;
}
