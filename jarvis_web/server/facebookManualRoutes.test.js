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

test("OAuth creation selects one Page-scoped credential and reconnect updates only one", () => {
  assert.match(source, /available = await service\.pages/);
  assert.match(source, /makeFacebookPageSelectorHtml/);
  assert.match(source, /createPageSelection/);
  assert.match(source, /app\.post\("\/api\/facebook\/auth\/page-selection"/);
  assert.match(source, /findByPage\(\{ accountId: selected\.accountId, pageId: selected\.page\.id \}\)/);
  assert.match(source, /pageAccessTokens: \{ \[selected\.page\.id\]: pageToken \}/);
  assert.match(source, /state\.intent === "reconnect"[\s\S]*previous\.id/);
  assert.doesNotMatch(source, /pages\.map\(\(page\) => facebookCredentialStore\.save/);
});

test("Page selection accepts safe identifiers only and never returns token material", () => {
  const route = source.slice(source.indexOf('app.post("/api/facebook/auth/page-selection"'), source.indexOf('app.get("/api/facebook/auth/callback"'));
  assert.match(route, /\["selectionId", "pageId"\]/);
  assert.match(route, /consumePageSelection/);
  assert.doesNotMatch(route, /res\.json\([^)]*(?:accessToken|pageToken|tokens)/);
});

test("manual routes serialize store metadata and never include token values", () => {
  const routeSection = source.slice(source.indexOf('app.post("/api/facebook/credentials/manual/test"'), source.indexOf('app.get("/api/facebook/auth/start"'));
  assert.doesNotMatch(routeSection, /res\.json\([^)]*accessToken|access_token|token_ciphertext|token_iv|token_tag/);
  assert.match(routeSection, /facebookCredentialStore\.saveManual/);
  assert.match(routeSection, /facebookCredentialStore\.updateManual/);
});

test("Graph execution routes delegate auth-mode-aware me and Page discovery", () => {
  assert.match(source, /\/api\/facebook\/graph\/me[^\n]+withFacebookGraphRequest/);
  assert.match(source, /executionServices\.facebook\.graphRequest/);
  assert.match(source, /method: req\.method, endpoint, body: req\.body, query: req\.query/);
  assert.match(source, /\/api\/facebook\/graph\/pages[^\n]+"pages"/);
  assert.match(source, /\/api\/facebook\/graph\/page[^\n]+"page"/);
  assert.doesNotMatch(source.slice(source.indexOf("async function withFacebookGraphRequest"), source.indexOf("async function withFacebookCredential")), /facebookCredentialStore\.get|facebookGraphService\(\)/);
});

test("Reel publishing route resolves credentials and binary references only on the server", () => {
  assert.match(source, /\/api\/facebook\/reels\/publish", publishFacebookReel/);
  assert.match(source, /toLegacyReelResponse\(await executionServices\.facebook\.publishReel\(req\.body\)\)/);
  const route = source.slice(source.indexOf("async function publishFacebookReel"), source.indexOf('app.get("/api/google/credentials"'));
  assert.doesNotMatch(route, /facebookCredentialStore\.get|facebookGraphService\(\)|publishPageReel|BINARY_DATA_DIR/);
  assert.doesNotMatch(source, /req\.body\.upload_?url/i);
});

test("Reel route returns allowlisted diagnostics and logs known failures once", () => {
  const errorBoundary = source.slice(source.indexOf("function publicFacebookError"), source.indexOf('app.get("/api/facebook/credentials"'));
  assert.match(errorBoundary, /logReelFailure\(error\)/);
  assert.match(errorBoundary, /diagnostic:\s*error\.diagnostic/);
  assert.doesNotMatch(errorBoundary, /error\.response|error\.headers|uploadUrl|filePath|Authorization|accessToken/);
});
