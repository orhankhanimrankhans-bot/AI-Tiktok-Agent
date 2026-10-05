import test from "node:test";
import assert from "node:assert/strict";
import { instagramNodeDefaults, buildInstagramRequest } from "./instagramConfig.js";
import { nodeConnectionHealth } from "./workflowCanvas.js";
test("Instagram starts disconnected and requires explicit publishing consent", () => {
  const config = instagramNodeDefaults(); assert.equal(config.publishConsent, false); assert.throws(() => buildInstagramRequest(config, {}));
  config.credentialId = "a".repeat(64); assert.throws(() => buildInstagramRequest(config, {})); config.publishConsent = true;
  const request = buildInstagramRequest(config, { fileId: "original", binary: { referenceId: "private-reference" } }, () => "Resolved caption");
  assert.equal(request.sourceFileId, "original"); assert.equal(request.caption, "Resolved caption"); assert.equal(request.operation, "Publish Reel");
});
test("Instagram connection health does not borrow another provider's credential", () => {
  const node = { name: "Instagram", config: { credentialId: "mine" } };
  assert.notDeepEqual(nodeConnectionHealth(node, { instagramCredentials: [{ id: "mine", connected: true }] }), nodeConnectionHealth(node, { tiktokCredentials: [{ id: "mine", connected: true }] }));
});
