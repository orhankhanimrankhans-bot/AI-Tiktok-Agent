"use strict";
const SECRET_KEY = /^(?:authorization|cookie|set-cookie|(?:app|client)[_-]?secret|(?:user|page|refresh|session)?[_-]?(?:access[_-]?)?tokens?|pageAccessTokens|appsecret_proof)$/i;
function secretValues(value) {
  if (typeof value === "string") return value ? [value] : [];
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => SECRET_KEY.test(key) || key === "pageAccessTokens" ? (typeof child === "object" ? Object.values(child).flatMap(secretValues) : secretValues(child)) : []);
}
function publicMetaData(value, secrets = []) {
  if (typeof value === "string") {
    for (const secret of secrets) if (typeof secret === "string" && secret) value = value.split(secret).join("[REDACTED]");
    return value.replace(/((?:access_token|refresh_token|app_secret|client_secret|session_token)=)[^&\s]+/gi, "$1[REDACTED]").replace(/Bearer\s+[^\s]+|OAuth\s+access_token\s*=\s*[^\s]+/gi, "Authorization [REDACTED]");
  }
  if (Array.isArray(value)) return value.map(item => publicMetaData(item, secrets));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !SECRET_KEY.test(key)).map(([key, child]) => [key, publicMetaData(child, secrets)]));
}
module.exports = { publicMetaData, secretValues };
