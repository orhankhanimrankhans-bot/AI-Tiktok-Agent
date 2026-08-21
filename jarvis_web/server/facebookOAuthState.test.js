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
