const FORBIDDEN_NAME = /^(authorization|access[_-]?token|page[_-]?access[_-]?token|client[_-]?secret|app[_-]?secret|appsecret_proof|token)$/i;
const TOKEN_VALUE = /^\s*Bearer\s+\S+/i;

export function isForbiddenFacebookPair(pair = {}) {
  return FORBIDDEN_NAME.test(String(pair.name || "").trim()) || TOKEN_VALUE.test(String(pair.value || ""));
}
export function assertSafeFacebookConfig(config = {}) {
  const inspect = (value) => {
    if (typeof value === "string" && TOKEN_VALUE.test(value)) throw new Error("Facebook access tokens and Authorization fields must be configured only on the Jarvis server.");
    if (Array.isArray(value)) { value.forEach(inspect); return; }
    if (!value || typeof value !== "object") return;
    if (isForbiddenFacebookPair(value)) throw new Error("Facebook access tokens and Authorization fields must be configured only on the Jarvis server.");
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_NAME.test(key)) throw new Error("Facebook access tokens and Authorization fields must be configured only on the Jarvis server.");
      inspect(child);
    }
  };
  inspect(config);
  return config;
}
export function sanitizeFacebookConfig(config = {}) {
  const clean = (value) => {
    if (typeof value === "string") return TOKEN_VALUE.test(value) ? "" : value;
    if (Array.isArray(value)) return value.filter((item) => !isForbiddenFacebookPair(item)).map(clean);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !FORBIDDEN_NAME.test(key)).map(([key, child]) => [key, clean(child)]));
  };
  const safe = clean(config);
  for (const key of ["queryParameters", "headers", "bodyParameters"]) if (!Array.isArray(safe[key])) safe[key] = [];
  return safe;
}
export function facebookCredentialLabel(credential) {
  return `Facebook - ${credential?.accountName || credential?.accountId || "Account"}`;
}
