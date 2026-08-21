class FacebookGraphError extends Error {
  constructor(statusCode, code, message, permission = "") { super(message); this.statusCode = statusCode; this.code = code; this.permission = permission; }
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
  return value.replace(/access_token=[^&\s]+/gi, "access_token=[REDACTED]").replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]").slice(0, 600);
}
function validateGraphVersion(version) { if (!/^v\d{1,2}\.\d{1,2}$/.test(version)) throw new FacebookGraphError(500, "invalid_graph_version", "Meta Graph API version is not configured safely."); return version; }
function validatePageId(pageId) { const value = String(pageId || "").trim(); if (!/^\d{3,30}$/.test(value)) throw new FacebookGraphError(400, "invalid_page_id", "Enter a valid numeric Facebook Page ID."); return value; }

class FacebookGraphService {
  constructor({ version, fetchImpl = fetch }) { this.version = validateGraphVersion(version); this.fetch = fetchImpl; this.baseUrl = `https://graph.facebook.com/${version}`; }
  async request(path, token, params = {}, permission = "") {
    if (!/^(me|me\/accounts|\d{3,30})$/.test(path)) throw new FacebookGraphError(400, "invalid_graph_path", "Unsupported Facebook Graph path.");
    const url = new URL(`${this.baseUrl}/${path}`); for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    let response; try { response = await this.fetch(url, { headers: { Authorization: `Bearer ${token}` } }); }
    catch { throw new FacebookGraphError(502, "meta_network_error", "Could not reach Meta Graph API."); }
    let data = {}; try { data = await response.json(); } catch { /* safe generic error below */ }
    if (!response.ok || data.error) {
      const meta = data.error || {}; const code = String(meta.code || response.status || "unknown");
      const required = ["10", "200", "299"].includes(code) ? permission : "";
      const prefix = required ? `Permission required: ${required}. ` : "";
      throw new FacebookGraphError(response.status === 401 ? 401 : response.status === 403 ? 403 : 502,
        `meta_${code}`, `${prefix}${sanitizeMetaMessage(meta.message, [token])}`, required);
    }
    return data;
  }
  me(token) { return this.request("me", token, { fields: "id,name,email" }); }
  async pages(token) {
    const data = await this.request("me/accounts", token, { fields: "id,name,category,tasks,access_token", limit: "100" }, PERMISSIONS.pages);
    const pageTokens = {}; const pages = (data.data || []).map((page) => { if (page.id && page.access_token) pageTokens[page.id] = page.access_token; const { access_token, ...safe } = page; return safe; });
    return { pages, pageTokens };
  }
  pageMetadata(pageId, token) { return this.request(validatePageId(pageId), token, { fields: "id,name,category,fan_count,followers_count,link,picture" }, PERMISSIONS.page_metadata); }
}
module.exports = { containsForbiddenSecretFields, FacebookGraphError, FacebookGraphService, sanitizeMetaMessage, validatePageId };
