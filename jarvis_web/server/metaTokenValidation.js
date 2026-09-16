"use strict";
const { FacebookGraphError } = require("./facebookGraph");
async function validateMetaTokenApp(token, config, fetchImpl = fetch) {
  const url = new URL(`https://graph.facebook.com/${config.graphVersion}/debug_token`);
  url.searchParams.set("input_token", token);
  let response, data;
  try {
    response = await fetchImpl(url, { redirect: "error", signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${config.appId}|${config.appSecret}` } });
    data = await response.json();
  } catch { throw new FacebookGraphError(502, "META_TOKEN_VALIDATION_FAILED", "Meta could not verify the token's app. No credential was saved."); }
  if (!response.ok || data?.data?.is_valid !== true || String(data.data.app_id) !== config.appId) {
    throw new FacebookGraphError(400, "META_TOKEN_APP_MISMATCH", "Use a valid token issued by this workspace's Meta app.");
  }
  return true;
}
async function exchangeMetaCode(code, config, fetchImpl = fetch) {
  if (typeof code !== "string" || !code || code.length > 4096) throw new FacebookGraphError(400, "META_CODE_INVALID", "Meta did not return a valid authorization code.");
  try {
    const response = await fetchImpl(`https://graph.facebook.com/${config.graphVersion}/oauth/access_token`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(20000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: config.appId, client_secret: config.appSecret, redirect_uri: config.redirectUri, code }) });
    const data = await response.json();
    if (!response.ok || typeof data.access_token !== "string" || !data.access_token) throw new Error("exchange failed");
    return data;
  } catch { throw new FacebookGraphError(502, "META_CODE_EXCHANGE_FAILED", "Meta token exchange failed. Restart sign-in."); }
}
module.exports = { validateMetaTokenApp, exchangeMetaCode };
