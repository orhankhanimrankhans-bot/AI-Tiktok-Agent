import test from "node:test";
import assert from "node:assert/strict";
import { validateMetaAppSetup, saveMetaAppSetup, metaSetupView } from "./metaAppSetup.js";
const form = { appId: " 123456 ", graphVersion: "v26.0", redirectUri: "https://corex.example/api/facebook/auth/callback" };

for (const [name, config, expected] of [
  ["owner configured", { configured: true, appId: "111111" }, "ready"],
  ["friend unconfigured", { configured: false, code: "META_APP_NOT_CONFIGURED" }, "required"],
  ["friend configured", { configured: true, appId: "222222" }, "ready"],
  ["third user unconfigured", { configured: false, code: "META_APP_NOT_CONFIGURED" }, "required"],
]) {
  test(`Meta setup visibility: ${name}`, () => {
    const view = metaSetupView(config);
    assert.equal(view.state, expected);
    assert.equal(view.showForm, expected === "required");
    assert.equal(view.showConnect, expected === "ready");
  });
}

test("missing, legacy and malformed configuration never enable standalone Connect", () => {
  for (const config of [null, {}, { connectionMode: "managed_oauth2" }, { configured: "false" }, { configured: true }]) {
    assert.deepEqual(metaSetupView(config), { state: "unavailable", showForm: false, showConnect: false });
  }
  assert.equal(metaSetupView({ configured: false, connectionMode: "managed_oauth2" }).showForm, true);
  assert.equal(metaSetupView({ configured: true, appId: "111111" }, { loading: true }).showConnect, false);
});
test("Meta setup trims IDs and requires a new secret without any default App ID", () => {
  assert.equal(validateMetaAppSetup(form,"private-test-secret").appId,"123456");
  for (const appId of ["", "abc", "12", "1".repeat(31)]) assert.throws(()=>validateMetaAppSetup({...form,appId},"private-test-secret"));
  assert.throws(()=>validateMetaAppSetup(form,""),/Secret is missing/);
});
test("saving uses session ownership and exposes only safe config metadata", async () => {
  let request;
  const result=await saveMetaAppSetup(async (url,options)=>{request={url,...options};return {ok:true,json:async()=>({configured:true,appId:"123456",appSecret:"unexpected-secret"})};},"",validateMetaAppSetup(form,"private-test-secret"));
  assert.equal(request.credentials,"include"); assert.equal(request.method,"PUT");
  assert.equal(JSON.parse(request.body).appId,"123456"); assert.equal(JSON.parse(request.body).workspaceId,undefined);
  assert.doesNotMatch(JSON.stringify(result),/secret/i);
});
test("failed saves cannot return provider or server secrets to the setup panel", async () => {
  await assert.rejects(saveMetaAppSetup(async()=>({ok:false,status:400,json:async()=>({error:"private-secret"})}),"",{}),e=>!e.message.includes("private-secret"));
});
