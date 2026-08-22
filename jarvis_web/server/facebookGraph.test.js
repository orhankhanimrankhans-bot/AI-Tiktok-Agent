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

test("manual Page token inspection uses Graph v26 approved paths and returns required permission metadata", async () => {
  const calls = []; const service = new FacebookGraphService({ version: "v26.0", fetchImpl: async (url) => {
    calls.push(String(url)); return String(url).includes("/me/permissions")
      ? response({ data: ["pages_show_list", "pages_read_engagement", "pages_manage_posts"].map((permission) => ({ permission, status: "granted" })) })
      : response({ id: "123456", name: "TinyTech" });
  } });
  const result = await service.inspectPageToken("page-token-secret");
  assert.deepEqual(result, { ok: true, pageId: "123456", pageName: "TinyTech", status: "connected",
    permissions: { pages_show_list: true, pages_read_engagement: true, pages_manage_posts: true } });
  assert.ok(calls.every((url) => url.startsWith("https://graph.facebook.com/v26.0/")));
  assert.deepEqual(calls.map((url) => new URL(url).pathname), ["/v26.0/me", "/v26.0/me/permissions"]);
});

test("manual Page token inspection returns safe invalid-token and permission failures", async () => {
  const invalid = new FacebookGraphService({ version: "v26.0", fetchImpl: async () => response({ error: { code: 190, message: "Invalid OAuth access token page-token-secret" } }, 401) });
  await assert.rejects(() => invalid.inspectPageToken("page-token-secret"), (error) => error.statusCode === 401 && !error.message.includes("page-token-secret"));
  const missing = new FacebookGraphService({ version: "v26.0", fetchImpl: async (url) => String(url).includes("permissions")
    ? response({ data: [{ permission: "pages_show_list", status: "granted" }] }) : response({ id: "123456", name: "TinyTech" }) });
  await assert.rejects(() => missing.inspectPageToken("page-token-secret"), (error) => error.statusCode === 403 && error.code === "missing_page_permissions" && /pages_manage_posts/.test(error.message));
});

test("Graph service rejects non-approved hosts and paths by construction", async () => {
  const calls = []; const service = new FacebookGraphService({ version: "v26.0", fetchImpl: async (url) => { calls.push(String(url)); return response({}); } });
  await assert.rejects(() => service.request("https://evil.example/token", "secret"), /Unsupported Facebook Graph path/);
  assert.equal(calls.length, 0); assert.equal(service.baseUrl, "https://graph.facebook.com/v26.0");
});
