const assert = require("node:assert/strict"); const test = require("node:test");
const { containsForbiddenSecretFields, FacebookGraphError, FacebookGraphService } = require("./facebookGraph");
function response(data, status = 200) { return { ok: status < 400, status, json: async () => data }; }
test("Meta /me and /me/accounts return identity and Pages without tokens", async () => {
  const calls = []; const service = new FacebookGraphService({ version: "v25.0", fetchImpl: async (url, options) => { calls.push([url, options]); return String(url).includes("me/accounts") ? response({ data: [{ id: "123", name: "Page", access_token: "page-secret" }] }) : response({ id: "42", name: "User" }); } });
  assert.deepEqual(await service.me("user-secret"), { id: "42", name: "User" });
  const result = await service.pages("user-secret"); assert.deepEqual(result.pages, [{ id: "123", name: "Page" }]); assert.equal(result.pageTokens["123"], "page-secret");
  assert.doesNotMatch(JSON.stringify(result.pages), /secret|access_token/); assert.ok(calls.every(([url]) => new URL(url).origin === "https://graph.facebook.com"));
});
test("Meta errors are permission-aware and redact tokens", async () => {
  const service = new FacebookGraphService({ version: "v25.0", fetchImpl: async () => response({ error: { code: 200, message: "Token user-secret lacks permission" } }, 403) });
  await assert.rejects(() => service.pages("user-secret"), (error) => error instanceof FacebookGraphError && /pages_show_list/.test(error.message) && !/user-secret/.test(error.message));
});
test("server rejects nested client-supplied Facebook secret fields", () => {
  assert.equal(containsForbiddenSecretFields({ credentialId: "fcred_safe", nested: { access_token: "secret" } }), true);
  assert.equal(containsForbiddenSecretFields({ credentialId: "fcred_safe", pageId: "123" }), false);
});

test("manual Page token inspection validates Page identity without requesting Page permissions", async () => {
  const calls = []; const service = new FacebookGraphService({ version: "v26.0", fetchImpl: async (url, options) => {
    calls.push([String(url), options]); return response({ id: "123456", name: "TinyTech" });
  } });
  const result = await service.inspectPageToken("page-token-secret");
  assert.deepEqual(result, { ok: true, pageId: "123456", pageName: "TinyTech", status: "connected", permissionsVerified: false });
  assert.equal(calls.length, 1); assert.equal(new URL(calls[0][0]).pathname, "/v26.0/me");
  assert.equal(new URL(calls[0][0]).searchParams.get("fields"), "id,name");
  assert.equal(calls[0][0].includes("page-token-secret"), false);
  assert.equal(JSON.stringify(result).includes("page-token-secret"), false);
});

test("manual Page token inspection returns a safe invalid-token failure", async () => {
  const invalid = new FacebookGraphService({ version: "v26.0", fetchImpl: async () => response({ error: { code: 190, message: "Invalid OAuth access token page-token-secret" } }, 401) });
  await assert.rejects(() => invalid.inspectPageToken("page-token-secret"), (error) => error.statusCode === 401 && !error.message.includes("page-token-secret"));
});

test("Meta code 100 is a reached-Meta validation error and remains token-safe", async () => {
  const service = new FacebookGraphService({ version: "v26.0", fetchImpl: async () => response({ error: { code: 100,
    message: "(#100) Tried accessing nonexistent field using page-token-secret" } }, 400) });
  await assert.rejects(() => service.inspectPageToken("page-token-secret"), (error) => error instanceof FacebookGraphError
    && error.statusCode === 400 && error.code === "meta_100" && !error.message.includes("page-token-secret") && !/Authorization/i.test(error.message));
});

test("Graph service rejects non-approved hosts and paths by construction", async () => {
  const calls = []; const service = new FacebookGraphService({ version: "v26.0", fetchImpl: async (url) => { calls.push(String(url)); return response({}); } });
  await assert.rejects(() => service.request("https://evil.example/token", "secret"), /Unsupported Facebook Graph path/);
  assert.equal(calls.length, 0); assert.equal(service.baseUrl, "https://graph.facebook.com/v26.0");
});
