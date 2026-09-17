const { publicMetaData } = require("./metaPublicData");
class FacebookGraphError extends Error {
  constructor(statusCode, code, message, permission = "", diagnostic = null) {
    super(message); this.statusCode = statusCode; this.code = code; this.permission = permission; this.diagnostic = diagnostic;
  }
}
const PERMISSIONS = { pages: "pages_show_list", page_metadata: "pages_read_engagement" };
const REEL_PUBLISH_PERMISSION = "pages_manage_posts";
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
function safeMetaDiagnostic(meta, responseStatus, { stage = "graph", requiredPermission = "", secrets = [] } = {}) {
  const diagnostic = { stage };
  if (Number.isInteger(responseStatus) && responseStatus >= 100 && responseStatus <= 599) diagnostic.httpStatus = responseStatus;
  if (Number.isSafeInteger(meta?.code) || typeof meta?.code === "string") diagnostic.metaCode = meta.code;
  if (Number.isSafeInteger(meta?.error_subcode) || typeof meta?.error_subcode === "string") diagnostic.metaSubcode = meta.error_subcode;
  if (typeof meta?.type === "string" && meta.type.trim()) diagnostic.metaType = sanitizeMetaMessage(meta.type, secrets).slice(0, 80);
  if (typeof meta?.is_transient === "boolean") diagnostic.isTransient = meta.is_transient;
  if (typeof meta?.fbtrace_id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(meta.fbtrace_id)) diagnostic.traceId = meta.fbtrace_id;
  if (typeof meta?.error_user_title === "string" && meta.error_user_title.trim()) diagnostic.errorUserTitle = sanitizeMetaMessage(meta.error_user_title, secrets).slice(0, 160);
  const reason = meta?.error_user_msg || meta?.message;
  if (typeof reason === "string" && reason.trim()) diagnostic.reason = sanitizeMetaMessage(reason, secrets).slice(0, 600);
  if (requiredPermission) diagnostic.requiredPermission = requiredPermission;
  return publicMetaData(diagnostic, secrets);
}
function validateGraphVersion(version) { if (!/^v\d{1,2}\.\d{1,2}$/.test(version)) throw new FacebookGraphError(500, "invalid_graph_version", "Meta Graph API version is not configured safely."); return version; }
function validatePageId(pageId) { const value = String(pageId || "").trim(); if (!/^\d{3,30}$/.test(value)) throw new FacebookGraphError(400, "invalid_page_id", "Enter a valid numeric Facebook Page ID."); return value; }
function metaErrorStatus(responseStatus, code) {
  if (responseStatus === 401 || code === "190") return 401;
  if (responseStatus === 403 || ["10", "200", "299"].includes(code)) return 403;
  if (responseStatus === 429) return 429;
  if (responseStatus === 400 || code === "100") return 400;
  return 502;
}

class FacebookGraphService {
  constructor({ version, fetchImpl = fetch }) { this.version = validateGraphVersion(version); this.fetch = fetchImpl; this.baseUrl = `https://graph.facebook.com/${version}`; }
  async request(path, token, params = {}, permission = "", stage = "graph") {
    if (!/^(me|me\/accounts|me\/permissions|\d{3,30}|\d{3,30}\/(?:insights|videos|posts))$/.test(path)) throw new FacebookGraphError(400, "invalid_graph_path", "Unsupported Facebook Graph path.");
    const url = new URL(`${this.baseUrl}/${path}`); for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    let response; try { response = await this.fetch(url, { redirect: "error", headers: { Authorization: `Bearer ${token}` } }); }
    catch { throw new FacebookGraphError(502, "meta_network_error", "Could not reach Meta Graph API."); }
    let data = {}; try { data = await response.json(); } catch { /* safe generic error below */ }
    if (!response.ok || data.error) {
      const meta = data.error || {}; const code = sanitizeMetaMessage(String(meta.code || response.status || "unknown"), [token]);
      const required = ["10", "200", "299"].includes(code) ? permission : "";
      const prefix = required ? `Permission required: ${required}. ` : "";
      throw new FacebookGraphError(metaErrorStatus(response.status, code),
        `meta_${code}`, `${prefix}${sanitizeMetaMessage(meta.message, [token])}`, required,
        safeMetaDiagnostic(meta, response.status, { stage, requiredPermission: required, secrets: [token] }));
    }
    return path === "me/accounts" ? data : publicMetaData(data, [token]);
  }
  me(token) { return this.request("me", token, { fields: "id,name" }); }
  pageIdentity(token) { return this.request("me", token, { fields: "id,name" }); }
  async inspectPageToken(token) {
    const page = await this.pageIdentity(token);
    if (!/^\d{3,30}$/.test(String(page.id || "")) || !String(page.name || "").trim()) {
      throw new FacebookGraphError(400, "wrong_token_type", "The access token did not identify a Facebook Page.");
    }
    return { ok: true, pageId: String(page.id), pageName: String(page.name), status: "connected", permissionsVerified: false };
  }
  async pages(token) {
    const pageTokens = {}, pages = [], seen = new Set(), cursors = new Set();
    let after;
    for (let batch = 0; batch < 100; batch++) {
      // Follow opaque cursors on our fixed Graph endpoint, never paging.next URLs.
      const data = await this.request("me/accounts", token, { fields: "id,name,category,tasks,access_token", limit: "100", ...(after ? { after } : {}) }, PERMISSIONS.pages);
      if (!Array.isArray(data.data)) throw new FacebookGraphError(502, "facebook_pages_invalid", "Meta returned an invalid Page list. Refresh Pages to try again.");
      for (const page of data.data) {
        if (!/^\d{3,30}$/.test(String(page?.id || ""))) continue;
        const id = String(page.id);
        if (typeof page.access_token === "string" && page.access_token) pageTokens[id] = page.access_token;
        if (!seen.has(id)) {
          seen.add(id);
          pages.push({ id, name: String(page.name || "Facebook Page"),
            ...(typeof page.category === "string" ? { category: page.category } : {}),
            ...(Array.isArray(page.tasks) ? { tasks: page.tasks.filter(task => typeof task === "string") } : {}) });
        }
      }
      if (!data.paging?.next) return { pages, pageTokens };
      after = data.paging?.cursors?.after;
      if (typeof after !== "string" || !after || after.length > 4096 || cursors.has(after)) break;
      cursors.add(after);
    }
    throw new FacebookGraphError(502, "facebook_pages_incomplete", "The authorized Page list could not be completed. Refresh Pages to try again.");
  }
  async permissions(token) {
    const data = await this.request("me/permissions", token, {}, REEL_PUBLISH_PERMISSION, "authorization");
    const granted = (Array.isArray(data.data) ? data.data : []).filter((item) => item?.status === "granted" && typeof item.permission === "string").map((item) => item.permission);
    return { grantedPermissions: [...new Set(granted)] };
  }
  async requireReelPublishingPermission(token) {
    const result = await this.permissions(token);
    if (!result.grantedPermissions.includes(REEL_PUBLISH_PERMISSION)) {
      throw new FacebookGraphError(403, "facebook_missing_permission",
        "Reconnect Facebook and grant pages_manage_posts before publishing. In Development mode, the Facebook user must also have an App role.",
        REEL_PUBLISH_PERMISSION, { stage: "authorization", requiredPermission: REEL_PUBLISH_PERMISSION });
    }
    return result;
  }
  async pageMetadata(pageId, token) {
    const id = validatePageId(pageId);
    try {
      return await this.request(id, token, { fields: "id,name,category,followers_count,fan_count,link,picture{url}" }, PERMISSIONS.page_metadata, "page_metadata");
    } catch (error) {
      if (error instanceof FacebookGraphError && error.code === "meta_100") {
        return this.request(id, token, { fields: "id,name,category,fan_count,link,picture{url}" }, PERMISSIONS.page_metadata, "page_metadata");
      }
      throw error;
    }
  }
  pageVideos(pageId, token) { return this.request(`${validatePageId(pageId)}/videos`, token, { limit: "0", summary: "true" }, PERMISSIONS.page_metadata, "page_videos"); }
  pagePosts(pageId, token) { return this.request(`${validatePageId(pageId)}/posts`, token, { fields: "id", limit: "0", summary: "true" }, PERMISSIONS.page_metadata, "page_posts"); }
  pageInsights(pageId, token) { return this.request(`${validatePageId(pageId)}/insights`, token, { metric: "page_impressions_unique,page_video_views", period: "day", limit: "5" }, PERMISSIONS.page_metadata, "page_insights"); }
  async postReelForm(token, params, stage = "publishing") {
    const url = new URL(`${this.baseUrl}/me/video_reels`);
    let response; try { response = await this.fetch(url, { method: "POST", redirect: "error",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) }); }
    catch { throw new FacebookGraphError(502, "meta_network_error", "Could not reach Meta Graph API."); }
    let data = {}; try { data = await response.json(); } catch { /* safe generic error below */ }
    if (!response.ok || data.error) {
      const meta = data.error || {}; const code = sanitizeMetaMessage(String(meta.code || response.status || "unknown"), [token]);
      throw new FacebookGraphError(metaErrorStatus(response.status, code), `meta_${code}`, sanitizeMetaMessage(meta.message, [token]), "",
        safeMetaDiagnostic(meta, response.status, { stage, secrets: [token] }));
    }
    return data;
  }
  async startPageReelUpload(token) {
    const data = await this.postReelForm(token, { upload_phase: "start" }, "start");
    if (!/^\d{3,30}$/.test(String(data.video_id || "")) || !data.upload_url) {
      throw new FacebookGraphError(502, "invalid_reel_start_response", "Meta returned an invalid Reel upload session.");
    }
    return { videoId: String(data.video_id), uploadUrl: String(data.upload_url) };
  }
  finishPageReelUpload(token, { videoId, title = "", description = "" }) {
    const body = { video_id: validatePageId(videoId), upload_phase: "finish", video_state: "PUBLISHED" };
    if (title) body.title = title;
    if (description) body.description = description;
    return this.postReelForm(token, body, "finish");
  }
  reelStatus(token, videoId, stage = "facebook_processing") { return this.request(validatePageId(videoId), token, { fields: "status" }, "", stage); }
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
  FacebookGraphError, FacebookGraphService, REEL_PUBLISH_PERMISSION, safeMetaDiagnostic, sanitizeMetaMessage, validatePageId };
