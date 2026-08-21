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
