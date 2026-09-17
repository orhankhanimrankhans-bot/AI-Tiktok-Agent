const messages = {
  facebook_reconnect_required: "Reconnect Facebook to renew access to your Pages.",
  facebook_page_unavailable: "This Page is not authorized. Refresh Pages or reconnect Facebook.",
  facebook_authorization_changed: "Facebook authorization changed. Refresh Pages and try again.",
  META_APP_NOT_CONFIGURED: "Configure your workspace Meta App before adding Pages.",
  META_APP_CREDENTIAL_MISMATCH: "Reconnect Facebook using this workspace’s Meta App.",
};
async function request(fetchImpl, apiBaseUrl, credentialId, { pageId, signal } = {}) {
  const response = await fetchImpl(`${apiBaseUrl}/api/facebook/credentials/${encodeURIComponent(credentialId)}/pages`, {
    credentials: "include", signal, method: pageId === undefined ? "GET" : "POST",
    ...(pageId === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pageId }) }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(messages[data.code] || (response.status === 401 ? "Sign in again to manage your Pages."
      : response.status === 403 ? "Permission to manage Facebook credentials is required." : "Could not update your Facebook Pages. Try again."));
    error.reconnect = ["facebook_reconnect_required", "facebook_page_unavailable", "META_APP_CREDENTIAL_MISMATCH"].includes(data.code);
    throw error;
  }
  return data;
}
export async function loadFacebookPages(fetchImpl, apiBaseUrl, credentialId, signal) {
  const data = await request(fetchImpl, apiBaseUrl, credentialId, { signal });
  if (!Array.isArray(data.pages)) throw new Error("Could not load your Facebook Pages. Try Refresh Pages again.");
  return data.pages.map(page => ({ id: String(page.id), name: String(page.name), connected: page.connected === true,
    canAdd: page.canAdd === true, credentialId: page.credentialId || null }));
}
export function addFacebookPage(fetchImpl, apiBaseUrl, credentialId, pageId, signal) {
  return request(fetchImpl, apiBaseUrl, credentialId, { pageId, signal });
}
