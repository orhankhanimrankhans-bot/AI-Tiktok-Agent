export const FACEBOOK_CONNECTION_STATES = {
  not_tested: "Not tested",
  testing: "Testing...",
  success: "Connection tested successfully",
  failed: "Connection failed",
};

export function facebookConnectionStatus(state, errorMessage = "") {
  const label = FACEBOOK_CONNECTION_STATES[state] || FACEBOOK_CONNECTION_STATES.not_tested;
  if (state !== "failed") return label;
  return errorMessage ? `${label}: ${errorMessage}` : label;
}

export function safeFacebookCredentialError(error) {
  const status = Number(error?.status);
  if (error?.code === "missing_page_permissions") return `Required Facebook Page permission is missing${error.permission ? `: ${error.permission}` : ""}.`;
  if (status === 429) return "Meta is rate limiting connection tests. Wait a moment and try again.";
  if (status === 401 || status === 403) return "The token was rejected. Check its permissions and try again.";
  if (status === 400) return "The token or credential details are invalid. Check them and try again.";
  if (status >= 500) return "Jarvis could not reach Meta. Try again later.";
  return "The connection could not be tested. Try again.";
}

async function manualCredentialRequest(fetchImpl, url, options) {
  const response = await fetchImpl(url, options);
  let data = {}; try { data = await response.json(); } catch { /* use safe fallback */ }
  if (!response.ok) {
    const error = new Error(data?.error || "Facebook credential request failed.");
    error.status = response.status;
    error.code = data?.code;
    error.permission = data?.permission;
    throw error;
  }
  return data;
}

export function testManualFacebookCredential(fetchImpl, apiBaseUrl, accessToken) {
  return manualCredentialRequest(fetchImpl, `${apiBaseUrl}/api/facebook/credentials/manual/test`, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken }),
  });
}

export function saveManualFacebookCredential(fetchImpl, apiBaseUrl, { credentialId, name, accessToken }) {
  const existing = Boolean(credentialId);
  const body = { name }; if (accessToken) body.accessToken = accessToken;
  return manualCredentialRequest(fetchImpl, existing ? `${apiBaseUrl}/api/facebook/credentials/${encodeURIComponent(credentialId)}/manual` : `${apiBaseUrl}/api/facebook/credentials/manual`, {
    method: existing ? "PATCH" : "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

export function deleteManualFacebookCredential(fetchImpl, apiBaseUrl, credentialId) {
  return manualCredentialRequest(fetchImpl, `${apiBaseUrl}/api/facebook/credentials/${encodeURIComponent(credentialId)}/manual`, { method: "DELETE", credentials: "include" });
}
