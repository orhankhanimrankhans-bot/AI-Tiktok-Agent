const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const source = fs.readFileSync(`${__dirname}/index.js`, "utf8");
const popup = fs.readFileSync(`${__dirname}/oauthPopup.js`, "utf8");

test("YouTube OAuth reuses the Google client and callback with upload-only service scope", () => {
  assert.match(source, /app\.get\("\/api\/youtube\/auth\/start"[\s\S]*startGoogleOAuth\(req, res, YOUTUBE_PROVIDER\)/);
  assert.match(source, /https:\/\/www\.googleapis\.com\/auth\/youtube\.upload/);
  assert.match(source, /provider === YOUTUBE_PROVIDER[\s\S]*youtube\.upload[\s\S]*googleapis\.com\/auth\/drive/);
  assert.equal((source.match(/app\.get\("\/api\/google\/auth\/callback"/g) || []).length, 1);
  assert.match(source, /provider: oauthProvider/); assert.match(popup, /service/);
});

test("YouTube credential reconnect and disconnect remain owner-scoped and provider-filtered", () => {
  assert.match(source, /credentialStore\.get\(requestedCredentialId, \{ owner, provider \}\)/);
  assert.match(source, /provider: oauthProvider/);
  assert.match(source, /app\.post\("\/api\/youtube\/credentials\/:credentialId\/disconnect"/);
  assert.match(source, /deleteGoogleCredential\(req, res, YOUTUBE_PROVIDER\)/);
  assert.match(source, /credentialStore\.get\(credentialId, \{ includeTokens: true, owner, provider \}\)/);
});
