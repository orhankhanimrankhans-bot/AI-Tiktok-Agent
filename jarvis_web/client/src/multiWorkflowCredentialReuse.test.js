import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const manager = fs.readFileSync(new URL("./WorkflowManager.jsx", import.meta.url), "utf8");

test("credential lists refresh for the authenticated workspace and every opened workflow", () => {
  assert.match(app, /credentialWorkspaceKey = session[\s\S]*session\.role[\s\S]*session\.profileId/);
  assert.match(app, /initialSync\(\)[\s\S]*\[credentialWorkspaceKey\]/);
  assert.match(app, /syncFacebookCredentials\(\)[\s\S]*\[credentialWorkspaceKey\]/);
  assert.match(app, /openServerWorkflow[\s\S]*Promise\.allSettled\(\[syncGoogleCredential\(\), syncFacebookCredentials\(\)\]\)[\s\S]*getWorkflow/);
});

test("creating another workflow refreshes reusable Google and Facebook credentials", () => {
  assert.match(manager, /await onWorkflowCreated\?\.\(created\)/);
  assert.match(app, /onWorkflowCreated=\{\(\) => Promise\.allSettled\(\[syncGoogleCredential\(\), syncFacebookCredentials\(\)\]\)\}/);
  assert.doesNotMatch(manager, /ownerId|owner_id|profileId|workflowId.*credential/i);
});
