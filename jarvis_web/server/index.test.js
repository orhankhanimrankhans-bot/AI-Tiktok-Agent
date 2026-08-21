const assert = require("node:assert/strict");
const test = require("node:test");

const { makePopupResultHtml } = require("./index");

test("OAuth success popup returns credentialId without token data", () => {
  const credentialId = "gcred_1234567890123456789012";
  const html = makePopupResultHtml({
    status: "connected",
    message: "user@example.com is connected to Jarvis.",
    credentialId,
  });

  assert.match(html, new RegExp(`credentialId[^\\n]+${credentialId}`));
  assert.doesNotMatch(html, /access_token|refresh_token|token_ciphertext|"tokens"/i);
});
