const assert = require("node:assert/strict"); const test = require("node:test");
const { createFacebookOAuthState, verifyFacebookOAuthState } = require("./facebookOAuthState");
test("Facebook OAuth state validates purpose, signature, expiry, and reconnect IDs", () => {
  const secret = "signed-state-test-secret"; const now = Date.now();
  const token = createFacebookOAuthState({ secret, mode: "popup", intent: "reconnect", credentialId: "fcred_1234567890123456789012", now });
  const valid = verifyFacebookOAuthState(token, { secret, now, validateCredentialId: (id) => /^fcred_/.test(id) });
  assert.equal(valid.provider, "facebook"); assert.equal(valid.credentialId, "fcred_1234567890123456789012");
  assert.equal(verifyFacebookOAuthState(`${token}x`, { secret, now, validateCredentialId: () => true }), null);
  assert.equal(verifyFacebookOAuthState(token, { secret, now: now + 11 * 60000, validateCredentialId: () => true }), null);
});

test("Facebook OAuth state cryptographically binds the initiating workspace", () => {
  const secret = "state-secret"; const token = createFacebookOAuthState({ secret, mode: "popup", intent: "create", ownerType: "additional", ownerId: "profile_a" });
  const value = verifyFacebookOAuthState(token, { secret, validateCredentialId: () => true });
  assert.equal(value.ownerType, "additional"); assert.equal(value.ownerId, "profile_a");
  const [payload, signature] = token.split("."); const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString("utf8")), ownerId: "primary" })).toString("base64url");
  assert.equal(verifyFacebookOAuthState(`${forged}.${signature}`, { secret, validateCredentialId: () => true }), null);
});
