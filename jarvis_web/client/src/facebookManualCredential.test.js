import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { deleteManualFacebookCredential, facebookConnectionStatus, safeFacebookCredentialError, saveManualFacebookCredential, testManualFacebookCredential } from "./facebookManualCredential.js";

const appSource = fs.readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

test("Access Token credential mode renders with a password field and controls", () => {
  assert.match(appSource, /<option value="manual_access_token">Access Token<\/option>/);
  assert.match(appSource, /id="facebook-access-token" type=\{showToken \? "text" : "password"\}/);
  assert.match(appSource, />Test Connection<\/button>/);
  assert.match(appSource, />Save<\/button>/);
});

function jsonResponse(data, status = 200) { return { ok: status < 400, status, json: async () => data }; }

test("Test Connection posts the temporary token and returns safe Page metadata", async () => {
  const calls = []; const fetchImpl = async (url, options) => { calls.push([url, options]); return jsonResponse({ ok: true, pageId: "123", pageName: "TinyTech", status: "connected" }); };
  const result = await testManualFacebookCredential(fetchImpl, "https://jarvis.test", "temporary-token");
  assert.equal(result.pageName, "TinyTech"); assert.equal(calls[0][0], "https://jarvis.test/api/facebook/credentials/manual/test");
  assert.equal(calls[0][1].method, "POST"); assert.deepEqual(JSON.parse(calls[0][1].body), { accessToken: "temporary-token" });
});

test("create, replace-token update, name-only update, and delete use dedicated manual endpoints", async () => {
  const calls = []; const fetchImpl = async (url, options) => { calls.push([url, options]); return jsonResponse({ id: "fcred_1234567890123456789012", authMode: "manual_access_token" }); };
  await saveManualFacebookCredential(fetchImpl, "", { name: "New Page", accessToken: "new-token" });
  await saveManualFacebookCredential(fetchImpl, "", { credentialId: "fcred_1234567890123456789012", name: "Renamed", accessToken: "replacement-token" });
  await saveManualFacebookCredential(fetchImpl, "", { credentialId: "fcred_1234567890123456789012", name: "Name only", accessToken: "" });
  await deleteManualFacebookCredential(fetchImpl, "", "fcred_1234567890123456789012");
  assert.deepEqual(calls.map(([, options]) => options.method), ["POST", "PATCH", "PATCH", "DELETE"]);
  assert.equal(JSON.parse(calls[2][1].body).accessToken, undefined);
  assert.match(calls[1][0], /\/fcred_1234567890123456789012\/manual$/);
});

test("failed backend calls expose status without echoing raw response details", async () => {
  await assert.rejects(() => testManualFacebookCredential(async () => jsonResponse({ error: "provider detail" }, 401), "", "temporary-token"),
    (error) => error.status === 401 && safeFacebookCredentialError(error) === "The token was rejected. Check its permissions and try again.");
});

test("saved manual credentials never render a stored token and successful save clears component memory", () => {
  const manualModal = appSource.slice(appSource.indexOf("function FacebookCredentialModal"), appSource.indexOf("function GoogleDriveSearchEditor"));
  assert.match(manualModal, /Access token securely stored/);
  assert.match(manualModal, /await onSaveAccessToken[\s\S]*setAccessToken\(""\)/);
  assert.doesNotMatch(manualModal, /credential\?\.(accessToken|token)|credential\.(accessToken|token)/);
});

test("manual token is ephemeral and is not written to workflow or localStorage", () => {
  const manualModal = appSource.slice(appSource.indexOf("function FacebookCredentialModal"), appSource.indexOf("function GoogleDriveSearchEditor"));
  assert.doesNotMatch(manualModal, /localStorage|setCanvasNodes|config\s*:/);
  assert.match(manualModal, /useState\(""\)/);
  assert.match(manualModal, /setAccessToken\(""\)/);
});

test("existing Meta OAuth controls remain available", () => {
  assert.match(appSource, /Managed Meta OAuth2/);
  assert.match(appSource, /Connect Meta Account/);
  assert.match(appSource, /Reconnect/);
  assert.match(appSource, /onDisconnect/);
});

test("connection states and safe failures render correctly", () => {
  assert.equal(facebookConnectionStatus("not_tested"), "Not tested");
  assert.equal(facebookConnectionStatus("testing"), "Testing...");
  assert.equal(facebookConnectionStatus("success"), "Connection tested successfully");
  assert.equal(facebookConnectionStatus("failed", "Safe message"), "Connection failed: Safe message");
  assert.equal(safeFacebookCredentialError({ status: 401, message: "secret provider response" }), "The token was rejected. Check its permissions and try again.");
  assert.equal(safeFacebookCredentialError({ status: 400, code: "meta_100" }), "The token or credential details are invalid. Check them and try again.");
  assert.doesNotMatch(safeFacebookCredentialError(new Error("secret provider response")), /secret provider response/);
});
