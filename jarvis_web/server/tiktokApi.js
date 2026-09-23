"use strict";
class TikTokError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
const MAX_VIDEO_BYTES = 32 * 1024 * 1024;
function configFromEnv(env = process.env) {
  const clientKey = env.TIKTOK_CLIENT_KEY || "", clientSecret = env.TIKTOK_CLIENT_SECRET || "";
  const redirectUri = env.TIKTOK_REDIRECT_URI || "";
  let valid = false;
  try { const url = new URL(redirectUri); valid = url.protocol === "https:" && !url.search && !url.hash && !url.username && !url.password && url.pathname === "/api/tiktok/auth/callback"; } catch { /* unavailable */ }
  return { clientKey, clientSecret, redirectUri, configured: Boolean(clientKey && clientSecret && valid) };
}
function validateVideo(buffer, type) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12 || buffer.length > MAX_VIDEO_BYTES) throw new TikTokError("invalid_video", "Choose a video up to 32 MiB.");
  const iso = buffer.toString("ascii", 4, 8) === "ftyp";
  const webm = buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (!((iso && ["video/mp4", "video/quicktime"].includes(type)) || (webm && type === "video/webm"))) throw new TikTokError("invalid_video", "Choose an MP4, MOV, or WebM video.");
}
class TikTokApi {
  constructor(config, fetchImpl = fetch) { this.config = config; this.fetch = fetchImpl; }
  async request(path, { token, form, body, method = "POST" } = {}) {
    let response, result;
    try {
      response = await this.fetch(`https://open.tiktokapis.com/v2/${path}`, {
        method, redirect: "error", signal: AbortSignal.timeout(30000),
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": form ? "application/x-www-form-urlencoded" : "application/json" },
        ...(method === "GET" ? {} : { body: form ? new URLSearchParams(form).toString() : JSON.stringify(body || {}) }),
      });
      result = await response.json();
    } catch { throw new TikTokError("tiktok_unavailable", "TikTok did not return a usable response. Check status before retrying an upload.", 502); }
    const code = typeof result.error === "string" ? result.error : result.error?.code;
    if (!response.ok || (code && code !== "ok")) {
      const known = ["access_token_invalid", "scope_not_authorized", "rate_limit_exceeded", "spam_risk_too_many_pending_share", "invalid_grant"];
      throw new TikTokError(known.includes(code) ? code : "tiktok_request_failed", "TikTok rejected the request. Check your connection, app permissions, and pending uploads.", 502);
    }
    return result;
  }
  async tokens(fields) {
    const result = await this.request("oauth/token/", { form: { client_key: this.config.clientKey, client_secret: this.config.clientSecret, ...fields } });
    if (!result.access_token || !result.refresh_token || !result.open_id || !Number.isFinite(result.expires_in) || !Number.isFinite(result.refresh_expires_in)) throw new TikTokError("invalid_token_response", "TikTok returned incomplete account credentials.", 502);
    if (!String(result.scope).split(",").includes("video.upload")) throw new TikTokError("scope_not_authorized", "Authorize the video.upload permission to use TikTok uploads.");
    return { accessToken: result.access_token, refreshToken: result.refresh_token, openId: result.open_id,
      scopes: result.scope, expiresAt: Date.now() + result.expires_in * 1000, refreshExpiresAt: Date.now() + result.refresh_expires_in * 1000 };
  }
  async access(account) {
    if (account.expiresAt > Date.now() + 60000) return account;
    if (account.refreshExpiresAt <= Date.now()) throw new TikTokError("reconnect_required", "Reconnect your TikTok account.", 401);
    const updated = await this.tokens({ grant_type: "refresh_token", refresh_token: account.refreshToken });
    if (updated.openId !== account.openId) throw new TikTokError("account_mismatch", "Reconnect your TikTok account.", 401);
    return { ...account, ...updated };
  }
  async profile(token) {
    const result = await this.request("user/info/?fields=open_id,display_name", { token, method: "GET" });
    if (!result.data?.user?.open_id) throw new TikTokError("invalid_profile", "TikTok account identity could not be verified.", 502);
    return result.data.user;
  }
  async transfer(urlString, buffer, type) {
    let url;
    try { url = new URL(urlString); } catch { throw new TikTokError("invalid_upload_url", "TikTok returned an invalid upload destination.", 502); }
    if (url.protocol !== "https:" || !url.hostname.endsWith(".tiktokapis.com") || url.port || url.username || url.password) throw new TikTokError("invalid_upload_url", "TikTok returned an invalid upload destination.", 502);
    let response;
    try { response = await this.fetch(url.href, { method: "PUT", redirect: "error", signal: AbortSignal.timeout(120000), headers: {
      "Content-Type": type, "Content-Length": String(buffer.length), "Content-Range": `bytes 0-${buffer.length - 1}/${buffer.length}`,
    }, body: buffer }); } catch { throw new TikTokError("upload_uncertain", "Upload outcome is uncertain. Check its status before trying again.", 502); }
    if (response.status !== 201) throw new TikTokError("upload_uncertain", "TikTok has not confirmed transfer completion. Check upload status.", 502);
  }
}
module.exports = { TikTokApi, TikTokError, MAX_VIDEO_BYTES, configFromEnv, validateVideo };
