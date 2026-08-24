const assert = require("node:assert/strict"); const test = require("node:test");
const { makeFacebookPageSelectorHtml, makeFacebookPopupHtml } = require("./facebookPopup");
test("Facebook OAuth popup returns only the opaque credential ID", () => {
  const html = makeFacebookPopupHtml({ status: "connected", message: "Connected <img src=x>", credentialId: "fcred_1234567890123456789012", clientUrl: "https://jarvis.example" });
  assert.match(html, /fcred_1234567890123456789012/);
  assert.doesNotMatch(html, /access_token|pageAccessToken|refresh_token|client_secret|userAccessToken/i);
  assert.doesNotMatch(html, /<img src=x>/);
});
test("Facebook Page selector exposes safe Page metadata and selection capability only", () => {
  const html = makeFacebookPageSelectorHtml({ selectionId: "fsel_1234567890123456789012",
    pages: [{ id: "123456", name: "TinyTech" }, { id: "654321", name: "Page 2" }], clientUrl: "https://jarvis.example" });
  assert.match(html, /Select Facebook Page/); assert.match(html, /TinyTech/); assert.match(html, /Page 2/);
  assert.match(html, /\/api\/facebook\/auth\/page-selection/);
  assert.doesNotMatch(html, /access_token|pageAccessToken|refresh_token|client_secret|userAccessToken|Authorization/i);
});
