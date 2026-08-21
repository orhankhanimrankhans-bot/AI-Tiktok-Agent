const assert = require("node:assert/strict"); const test = require("node:test");
const { makeFacebookPopupHtml } = require("./facebookPopup");
test("Facebook OAuth popup returns only the opaque credential ID", () => {
  const html = makeFacebookPopupHtml({ status: "connected", message: "Connected <img src=x>", credentialId: "fcred_1234567890123456789012", clientUrl: "https://jarvis.example" });
  assert.match(html, /fcred_1234567890123456789012/);
  assert.doesNotMatch(html, /access_token|pageAccessToken|refresh_token|client_secret|userAccessToken/i);
  assert.doesNotMatch(html, /<img src=x>/);
});
