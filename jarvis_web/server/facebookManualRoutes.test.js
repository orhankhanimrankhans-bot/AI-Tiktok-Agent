const assert = require("node:assert/strict"); const fs = require("node:fs"); const test = require("node:test");
const source = fs.readFileSync(require.resolve("./index.js"), "utf8");

test("manual credential routes are body-only and Graph v26 is the production default", () => {
  assert.match(source, /META_GRAPH_VERSION \|\| "v26\.0"/);
  assert.match(source, /app\.post\("\/api\/facebook\/credentials\/manual\/test"/);
  assert.match(source, /app\.post\("\/api\/facebook\/credentials\/manual"/);
  assert.match(source, /app\.patch\("\/api\/facebook\/credentials\/:credentialId\/manual"/);
  assert.match(source, /app\.delete\("\/api\/facebook\/credentials\/:credentialId\/manual"/);
  assert.doesNotMatch(source, /manual\/test\?accessToken|credentials\/manual\?accessToken/);
});

test("manual routes serialize store metadata and never include token values", () => {
  const routeSection = source.slice(source.indexOf('app.post("/api/facebook/credentials/manual/test"'), source.indexOf('app.get("/api/facebook/auth/start"'));
  assert.doesNotMatch(routeSection, /res\.json\([^)]*accessToken|access_token|token_ciphertext|token_iv|token_tag/);
  assert.match(routeSection, /facebookCredentialStore\.saveManual/);
  assert.match(routeSection, /facebookCredentialStore\.updateManual/);
});

test("Graph execution routes delegate auth-mode-aware me and Page discovery", () => {
  assert.match(source, /\/api\/facebook\/graph\/me[^\n]+executeCredentialMe/);
  assert.match(source, /executeCredentialPages\(service, credential\)/);
  assert.match(source, /credentialPageToken\(credential, pageId\)/);
});

test("Reel publishing route resolves credentials and binary references only on the server", () => {
  assert.match(source, /\/api\/facebook\/reels\/publish[\s\S]{0,300}publishPageReel/);
  assert.match(source, /binaryDir:\s*BINARY_DATA_DIR/);
  assert.doesNotMatch(source, /req\.body\.upload_?url/i);
});

test("Reel route returns allowlisted diagnostics and logs known failures once", () => {
  const errorBoundary = source.slice(source.indexOf("function publicFacebookError"), source.indexOf('app.get("/api/facebook/credentials"'));
  assert.match(errorBoundary, /logReelFailure\(error\)/);
  assert.match(errorBoundary, /diagnostic:\s*error\.diagnostic/);
  assert.doesNotMatch(errorBoundary, /error\.response|error\.headers|uploadUrl|filePath|Authorization|accessToken/);
});
