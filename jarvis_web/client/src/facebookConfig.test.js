import assert from "node:assert/strict"; import test from "node:test";
import { assertSafeFacebookConfig, sanitizeFacebookConfig } from "./facebookConfig.js";
test("Facebook node rejects Authorization and token-like fields", () => {
  assert.throws(() => assertSafeFacebookConfig({ headers: [{ name: "Authorization", value: "Bearer secret" }] }), /only on the Corex server/);
  assert.throws(() => assertSafeFacebookConfig({ queryParameters: [{ name: "access_token", value: "secret" }] }), /only on the Corex server/);
});
test("Facebook secrets are stripped from legacy workflow configuration", () => {
  const safe = sanitizeFacebookConfig({ accessToken: "secret", pageVideo: { pageAccessToken: "nested-secret" }, headers: [{ name: "Authorization", value: "Bearer secret" }, { name: "Accept", value: "json" }] });
  assert.equal(safe.accessToken, undefined); assert.deepEqual(safe.headers, [{ name: "Accept", value: "json" }]);
  assert.doesNotMatch(JSON.stringify(safe), /Bearer secret|accessToken|pageAccessToken|nested-secret|Authorization/);
});
