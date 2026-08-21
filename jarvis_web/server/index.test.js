const assert = require("node:assert/strict");
const test = require("node:test");

const { makePopupResultHtml } = require("./oauthPopup");

test("OAuth success popup returns credentialId without token data", () => {
  const credentialId = "gcred_1234567890123456789012";
  const html = makePopupResultHtml({
    status: "connected",
    message: "user@example.com is connected to Jarvis.",
    credentialId,
    clientUrl: "http://localhost:5173",
  });

  assert.match(html, new RegExp(`credentialId[^\\n]+${credentialId}`));
  assert.doesNotMatch(html, /access_token|refresh_token|token_ciphertext|"tokens"/i);
});
