import { useEffect, useRef, useState } from "react";
import { validateMetaAppSetup, saveMetaAppSetup, metaSetupView } from "./metaAppSetup.js";

export default function MetaAppSettings({ apiBaseUrl = "", credential, onStartOAuth, canManage = false, showConnect = true }) {
  const [form, setForm] = useState({ appId: "", graphVersion: "v26.0", redirectUri: `${apiBaseUrl || window.location.origin}/api/facebook/auth/callback` });
  const [config, setConfig] = useState(null);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const secretInput = useRef(null), lifecycle = useRef(null), pendingPopup = useRef(null);
  useEffect(() => {
    const controller = new AbortController(); lifecycle.current = controller;
    setLoading(true); setConfig(null);
    if (!canManage) { setLoading(false); return () => controller.abort(); }
    fetch(`${apiBaseUrl}/api/facebook/meta-config`, { credentials: "include", cache: "no-store", signal: controller.signal })
      .then(async response => { if (response.status === 404) throw new Error("The backend does not support Meta App setup. Deploy matching frontend and backend versions."); if (!response.ok) throw new Error("Could not load Meta App configuration. Reopen this panel to retry."); const data = await response.json(); if (metaSetupView(data).state === "unavailable") throw new Error("The backend returned an unsupported Meta configuration response. Check the deployed backend version."); return data; })
      .then(data => { if (controller.signal.aborted) return; setConfig(data); if (data.configured) setForm({ appId: data.appId, graphVersion: data.graphVersion, redirectUri: data.redirectUri }); })
      .catch(error => { if (!controller.signal.aborted) setMessage(error.message.startsWith("The backend") ? error.message : "Could not load Meta App configuration. Reopen this panel to retry."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); pendingPopup.current?.close(); };
  }, [apiBaseUrl, canManage]);
  const save = async (connect) => {
    if (saving || !config) return;
    let payload;
    try { payload = validateMetaAppSetup(form, secretInput.current?.value); }
    catch (error) { setMessage(error.message); return; }
    // Keep the secret out of React state and clear the input before the request.
    secretInput.current.value = "";
    const popup = connect ? window.open("about:blank", "jarvis_facebook_oauth", "popup=yes,width=600,height=760,resizable=yes,scrollbars=yes") : null;
    pendingPopup.current = popup;
    setSaving(true); setMessage("");
    try {
      const saved = await saveMetaAppSetup(fetch, apiBaseUrl, payload, lifecycle.current.signal);
      payload = null;
      if (lifecycle.current.signal.aborted) return;
      setConfig(saved); setForm({ appId: saved.appId, graphVersion: saved.graphVersion, redirectUri: saved.redirectUri }); setEditing(false);
      setMessage(connect && !popup ? "Meta App saved. Allow popups, then click Connect Meta Account." : "Meta App saved for this workspace.");
      pendingPopup.current = null;
      if (connect && popup) onStartOAuth?.(credential?.id || null, popup);
    } catch (error) {
      popup?.close(); pendingPopup.current = null;
      if (!lifecycle.current.signal.aborted) setMessage(error.message.startsWith("Meta ") || error.message.startsWith("Sign in") || error.message.startsWith("You do not") ? error.message : "Could not save Meta App configuration. Try again.");
    } finally { payload = null; if (!lifecycle.current.signal.aborted) setSaving(false); }
  };
  if (!canManage) return <p className="meta-app-permission" role="status">Permission to manage Facebook credentials is required.</p>;
  const view = metaSetupView(config, { loading, editing });
  const configured = view.state === "ready";
  const differentApp = configured && credential && credential.appId !== config.appId;
  const showForm = view.showForm;
  return <section className={`meta-app-setup ${loading ? "is-pending" : configured ? "is-connected" : "is-disconnected"}`} aria-label="Meta App connection">
    <div className="meta-app-heading"><div><span className="connection-eyebrow">01 / APP CONFIGURATION</span><h3>Meta App connection</h3></div><span role="status" className={`connection-badge ${loading ? "is-pending" : configured ? "is-connected" : "is-disconnected"}`}><span className="connection-status-dot" aria-hidden="true" />{loading ? "Loading..." : configured ? "Meta App Connected" : view.state === "required" ? "Meta App Not Configured" : "Configuration unavailable"}</span></div>
    {!loading && config && !configured && <p role="status">Meta App configuration required. Configure your Meta App before connecting Facebook.</p>}
    {view.showConnect && <><dl className="meta-app-details"><div><dt>App ID / Client ID</dt><dd>{config.appId}</dd></div><div><dt>App Secret</dt><dd aria-label="App Secret configured"><span className="meta-secret-configured">Configured</span><small>Stored securely on the server</small></dd></div></dl>
      <div className="meta-app-actions"><button type="button" onClick={() => { setEditing(true); setMessage(""); }}>Edit Meta App</button>
        {showConnect && <button type="button" onClick={() => onStartOAuth?.(credential?.id || null)}>{credential ? "Reconnect Meta Account" : "Connect Meta Account"}</button>}</div></>}
    {differentApp && <p role="status">Existing authorization is retained. Reconnecting will use this Meta App.</p>}
    {showForm && <form onSubmit={event => { event.preventDefault(); save(!configured && showConnect); }}>
      {editing && <p>These settings apply to new connections and reconnects. Existing credentials remain unchanged. Enter a new secret to save changes.</p>}
      <label>Meta App ID / Client ID<input required inputMode="numeric" autoComplete="off" value={form.appId} onChange={event => setForm(value => ({ ...value, appId: event.target.value }))} /></label>
      <label>Meta App Secret<input ref={secretInput} required type="password" autoComplete="new-password" placeholder="Enter your Meta App Secret" /></label>
      <details><summary>Callback and API settings</summary>
        <label>OAuth callback URL<input required type="url" value={form.redirectUri} onChange={event => setForm(value => ({ ...value, redirectUri: event.target.value }))} /></label>
        <p>Register this exact callback URL in your Meta Developer App.</p>
        <label>Graph API version<input required value={form.graphVersion} onChange={event => setForm(value => ({ ...value, graphVersion: event.target.value }))} /></label>
      </details>
      <div className="meta-app-actions"><button type="submit" disabled={saving}>{saving ? "Saving..." : configured ? "Save changes" : showConnect ? "Save & Connect Meta Account" : "Save Meta App"}</button>
        {editing && <button type="button" disabled={saving} onClick={() => { if (secretInput.current) secretInput.current.value = ""; setForm({ appId: config.appId, graphVersion: config.graphVersion, redirectUri: config.redirectUri }); setEditing(false); setMessage(""); }}>Cancel</button>}</div>
    </form>}
    {message && <p role="status">{message}</p>}
  </section>;
}
