class FacebookGraphError extends Error {
  constructor(statusCode, code, message, permission = "", diagnostic = null) {
    super(message); this.statusCode = statusCode; this.code = code; this.permission = permission; this.diagnostic = diagnostic;
  }
}
const PERMISSIONS = { pages: "pages_show_list", page_metadata: "pages_read_engagement" };
const FORBIDDEN_SECRET_KEY = /^(authorization|access[_-]?token|page[_-]?access[_-]?token|client[_-]?secret|app[_-]?secret|appsecret_proof|token)$/i;
function containsForbiddenSecretFields(value) {
  if (Array.isArray(value)) return value.some(containsForbiddenSecretFields);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => FORBIDDEN_SECRET_KEY.test(key) || containsForbiddenSecretFields(child));
}
function sanitizeMetaMessage(message, secrets = []) {
  let value = String(message || "Meta Graph API request failed.");
  for (const secret of secrets) if (secret) value = value.split(secret).join("[REDACTED]");
  return value.replace(/access_token=[^&\s]+/gi, "access_token=[REDACTED]")
    .replace(/(?:Bearer|OAuth)\s+[^\s]+/gi, "Authorization [REDACTED]").slice(0, 600);
}
function validateGraphVersion(version) { if (!/^v\d{1,2}\.\d{1,2}$/.test(version)) throw new FacebookGraphError(500, "invalid_graph_version", "Meta Graph API version is not configured safely."); return version; }
function validatePageId(pageId) { const value = String(pageId || "").trim(); if (!/^\d{3,30}$/.test(value)) throw new FacebookGraphError(400, "invalid_page_id", "Enter a valid numeric Facebook Page ID."); return value; }
function metaErrorStatus(responseStatus, code) {
  if (responseStatus === 401 || code === "190") return 401;
  if (responseStatus === 403) return 403;
  if (responseStatus === 429) return 429;
  if (responseStatus === 400 || code === "100") return 400;
  return 502;
}

class FacebookGraphService {
  constructor({ version, fetchImpl = fetch }) { this.version = validateGraphVersion(version); this.fetch = fetchImpl; this.baseUrl = `https://graph.facebook.com/${version}`; }
  async request(path, token, params = {}, permission = "") {
    if (!/^(me|me\/accounts|\d{3,30})$/.test(path)) throw new FacebookGraphError(400, "invalid_graph_path", "Unsupported Facebook Graph path.");
    const url = new URL(`${this.baseUrl}/${path}`); for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    let response; try { response = await this.fetch(url, { redirect: "error", headers: { Authorization: `Bearer ${token}` } }); }
    catch { throw new FacebookGraphError(502, "meta_network_error", "Could not reach Meta Graph API."); }
    let data = {}; try { data = await response.json(); } catch { /* safe generic error below */ }
    if (!response.ok || data.error) {
      const meta = data.error || {}; const code = String(meta.code || response.status || "unknown");
      const required = ["10", "200", "299"].includes(code) ? permission : "";
      const prefix = required ? `Permission required: ${required}. ` : "";
      throw new FacebookGraphError(metaErrorStatus(response.status, code),
        `meta_${code}`, `${prefix}${sanitizeMetaMessage(meta.message, [token])}`, required);
    }
    return data;
  }
  me(token) { return this.request("me", token, { fields: "id,name,email" }); }
  pageIdentity(token) { return this.request("me", token, { fields: "id,name" }); }
  async inspectPageToken(token) {
    const page = await this.pageIdentity(token);
    if (!/^\d{3,30}$/.test(String(page.id || "")) || !String(page.name || "").trim()) {
      throw new FacebookGraphError(400, "wrong_token_type", "The access token did not identify a Facebook Page.");
    }
    return { ok: true, pageId: String(page.id), pageName: String(page.name), status: "connected", permissionsVerified: false };
  }
  async pages(token) {
    const data = await this.request("me/accounts", token, { fields: "id,name,category,tasks,access_token", limit: "100" }, PERMISSIONS.pages);
    const pageTokens = {}; const pages = (data.data || []).map((page) => { if (page.id && page.access_token) pageTokens[page.id] = page.access_token; const { access_token, ...safe } = page; return safe; });
    return { pages, pageTokens };
  }
  pageMetadata(pageId, token) { return this.request(validatePageId(pageId), token, { fields: "id,name,category,fan_count,followers_count,link,picture" }, PERMISSIONS.page_metadata); }
  async postReelForm(token, params) {
    const url = new URL(`${this.baseUrl}/me/video_reels`);
    let response; try { response = await this.fetch(url, { method: "POST", redirect: "error",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) }); }
    catch { throw new FacebookGraphError(502, "meta_network_error", "Could not reach Meta Graph API."); }
    let data = {}; try { data = await response.json(); } catch { /* safe generic error below */ }
    if (!response.ok || data.error) {
      const meta = data.error || {}; const code = String(meta.code || response.status || "unknown");
      throw new FacebookGraphError(metaErrorStatus(response.status, code), `meta_${code}`, sanitizeMetaMessage(meta.message, [token]));
    }
    return data;
  }
  async startPageReelUpload(token) {
    const data = await this.postReelForm(token, { upload_phase: "start" });
    if (!/^\d{3,30}$/.test(String(data.video_id || "")) || !data.upload_url) {
      throw new FacebookGraphError(502, "invalid_reel_start_response", "Meta returned an invalid Reel upload session.");
    }
    return { videoId: String(data.video_id), uploadUrl: String(data.upload_url) };
  }
  finishPageReelUpload(token, { videoId, title = "", description = "" }) {
    const body = { video_id: validatePageId(videoId), upload_phase: "finish", video_state: "PUBLISHED" };
    if (title) body.title = title;
    if (description) body.description = description;
    return this.postReelForm(token, body);
  }
  reelStatus(token, videoId) { return this.request(validatePageId(videoId), token, { fields: "status" }); }
}

function credentialToken(credential) {
  const manual = credential?.authMode === "manual_access_token";
  const token = manual ? credential?.tokens?.pageAccessToken : credential?.tokens?.userAccessToken;
  if (!token) throw new FacebookGraphError(404, "credential_disconnected", "Facebook credential was not found or is disconnected.");
  return token;
}

function executeCredentialMe(service, credential) {
  const token = credentialToken(credential);
  return credential.authMode === "manual_access_token" ? service.pageIdentity(token) : service.me(token);
}

function executeCredentialPages(service, credential) {
  if (credential?.authMode === "manual_access_token") {
    throw new FacebookGraphError(400, "unsupported_manual_operation", "Page discovery with me/accounts requires a Managed Meta OAuth credential.");
  }
  return service.pages(credentialToken(credential));
}

function credentialPageToken(credential, pageId) {
  if (credential?.authMode === "manual_access_token") return credentialToken(credential);
  return credential?.tokens?.pageAccessTokens?.[pageId] || credentialToken(credential);
}

module.exports = { containsForbiddenSecretFields, credentialPageToken, executeCredentialMe, executeCredentialPages,
  FacebookGraphError, FacebookGraphService, sanitizeMetaMessage, validatePageId };
