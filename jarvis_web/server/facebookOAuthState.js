const crypto = require("crypto");

function encode(value) { return Buffer.from(value).toString("base64url"); }
function createFacebookOAuthState({ secret, mode, intent, credentialId = null, now = Date.now() }) {
  const payload = JSON.stringify({ provider: "facebook", mode, intent, credentialId,
    nonce: crypto.randomBytes(16).toString("hex"), iat: Math.floor(now / 60000) });
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${encode(payload)}.${signature}`;
}
function verifyFacebookOAuthState(token, { secret, validateCredentialId, now = Date.now() }) {
  if (typeof token !== "string") return null;
  const [encoded, provided, extra] = token.split("."); if (!encoded || !provided || extra) return null;
  let payloadText; let payload;
  try { payloadText = Buffer.from(encoded, "base64url").toString("utf8"); payload = JSON.parse(payloadText); } catch { return null; }
  const expected = crypto.createHmac("sha256", secret).update(payloadText).digest();
  let actual; try { actual = Buffer.from(provided, "base64url"); } catch { return null; }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  const minute = Math.floor(now / 60000);
  if (payload.provider !== "facebook" || !["popup", "redirect"].includes(payload.mode) ||
      !["create", "reconnect"].includes(payload.intent) || !payload.nonce ||
      typeof payload.iat !== "number" || payload.iat > minute + 1 || minute - payload.iat > 10) return null;
  if (payload.intent === "create" && payload.credentialId !== null) return null;
  if (payload.intent === "reconnect" && !validateCredentialId(payload.credentialId)) return null;
  return payload;
}
module.exports = { createFacebookOAuthState, verifyFacebookOAuthState };
