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
