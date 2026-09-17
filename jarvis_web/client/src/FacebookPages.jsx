import { useEffect, useRef, useState } from "react";
import { addFacebookPage, loadFacebookPages } from "./facebookPagesApi.js";

export default function FacebookPages({ apiBaseUrl, credential, onCredentialsChanged, onStartOAuth }) {
  const [pages, setPages] = useState([]);
  const [busy, setBusy] = useState("loading");
  const [message, setMessage] = useState("");
  const [reconnect, setReconnect] = useState(false);
  const request = useRef(null);

  const refresh = async () => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setBusy("loading"); setMessage(""); setReconnect(false);
    try {
      const result = await loadFacebookPages(fetch, apiBaseUrl, credential.id, controller.signal);
      if (!controller.signal.aborted) setPages(result);
    } catch (error) {
      if (!controller.signal.aborted) { setMessage(error.message); setReconnect(Boolean(error.reconnect)); }
    } finally { if (!controller.signal.aborted) setBusy(""); }
  };
  useEffect(() => {
    refresh();
    return () => request.current?.abort();
    // Parent keys this component by credential identity and authorization revision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const add = async page => {
    const controller = new AbortController(); request.current = controller;
    setBusy(page.id); setMessage(""); setReconnect(false);
    try {
      const { credential: saved } = await addFacebookPage(fetch, apiBaseUrl, credential.id, page.id, controller.signal);
      if (controller.signal.aborted) return;
      setPages(items => items.map(item => item.id === page.id ? { ...item, connected: true, canAdd: false, credentialId: saved.id } : item));
      setMessage(`${page.name} is connected. Select its credential in your workflow.`);
      try { await onCredentialsChanged(); }
      catch { if (!controller.signal.aborted) setMessage("Page credential saved. Reopen the credential dropdown to refresh the list."); }
    } catch (error) {
      if (!controller.signal.aborted) { setMessage(error.message); setReconnect(Boolean(error.reconnect)); }
    } finally { if (!controller.signal.aborted) setBusy(""); }
  };

  return <section className="facebook-pages" aria-label="Your Facebook Pages" aria-busy={Boolean(busy)}>
    <div className="facebook-pages-heading"><div><span className="connection-eyebrow">03 / FACEBOOK PAGES</span><h3>Your Facebook Pages</h3></div>
      <button type="button" onClick={refresh} disabled={Boolean(busy)}>Refresh Pages</button></div>
    <p>Create a separate credential for each Page you want to use in a workflow.</p>
    {busy === "loading" && <p role="status">Loading authorized Pages…</p>}
    <ul>{pages.map(page => <li key={page.id}><div><strong>{page.name}</strong><small>Page ID: {page.id}</small></div>
      {page.connected ? <span className="facebook-page-connected">Connected</span>
        : <><span className="facebook-page-unavailable">Not Added</span>{page.canAdd ? <button type="button" disabled={Boolean(busy)} onClick={() => add(page)} aria-label={`Add Page Credential for ${page.name}`}>{busy === page.id ? "Adding…" : "Add Page"}</button>
          : <span className="facebook-page-unavailable">Authorization required</span>}</>}</li>)}</ul>
    {!busy && !pages.length && !message && <p>No Pages are available with the current authorization.</p>}
    {message && <p role="status">{message}</p>}
    <div className="facebook-pages-reconnect"><p>{reconnect ? "Renew authorization, then refresh the Page list." : "Missing a Page? Refresh first. If it is still missing, reconnect and grant access to that Page."}</p>
      <button type="button" disabled={Boolean(busy)} onClick={() => onStartOAuth(credential.id)}>Reconnect Facebook</button></div>
  </section>;
}
