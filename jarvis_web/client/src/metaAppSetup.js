export function metaSetupView(config, { loading = false, editing = false } = {}) {
  if (loading) return { state: "loading", showForm: false, showConnect: false };
  if (!config || typeof config.configured !== "boolean") return { state: "unavailable", showForm: false, showConnect: false };
  if (config.configured === false) return { state: "required", showForm: true, showConnect: false };
  if (!/^\d{3,30}$/.test(String(config.appId || ""))) return { state: "unavailable", showForm: false, showConnect: false };
  return { state: "ready", showForm: editing, showConnect: !editing };
}

export function validateMetaAppSetup(form, secret) {
  const appId = String(form.appId || "").trim();
  if (!appId) throw new Error("Meta App ID is missing.");
  if (!/^\d{3,30}$/.test(appId)) throw new Error("Meta App ID must contain 3 to 30 digits.");
  const appSecret = String(secret || "").trim();
  if (!appSecret) throw new Error("Meta App Secret is missing. Enter a new secret to save these settings.");
  if (appSecret.length < 16 || appSecret.length > 512 || /\s/.test(appSecret)) throw new Error("Meta App Secret is invalid.");
  return { appId, appSecret, graphVersion: form.graphVersion.trim(), redirectUri: form.redirectUri.trim() };
}

export async function saveMetaAppSetup(fetchImpl, apiBaseUrl, payload, signal) {
  if (typeof window !== "undefined") {
    const url = new URL(apiBaseUrl || window.location.origin, window.location.origin);
    if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Meta App setup requires HTTPS.");
  }
  const response = await fetchImpl(`${apiBaseUrl}/api/facebook/meta-config`, { method: "PUT", credentials: "include", signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json();
  if (!response.ok) throw new Error(response.status === 403 ? "You do not have permission to manage Facebook credentials."
    : response.status === 401 ? "Sign in again to configure your Meta App." : "Meta OAuth configuration is invalid. Check the App ID, secret and callback URL.");
  if (data.configured !== true || data.appId !== payload.appId) throw new Error("Meta App configuration was not confirmed. Try again.");
  return { configured: data.configured === true, appId: data.appId, graphVersion: data.graphVersion, redirectUri: data.redirectUri };
}
