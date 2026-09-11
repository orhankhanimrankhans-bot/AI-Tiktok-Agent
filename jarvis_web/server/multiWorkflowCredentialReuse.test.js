"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { CredentialStore } = require("./credentialStore");
const { FacebookCredentialStore } = require("./facebookCredentialStore");
const { createWorkflowStore } = require("./workflowStore");

test("Admin, Child, and Additional workflows reuse only same-workspace credentials", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-multi-workflow-credential-"));
  const google = new CredentialStore({ dbPath: path.join(directory, "credentials.sqlite3"), encryptionSecret: "multi-workflow-test-secret" }); await google.open();
  const facebook = new FacebookCredentialStore({ db: google.db, encryptionSecret: "multi-workflow-test-secret" }); facebook.open();
  const workflows = createWorkflowStore({ dbPath: path.join(directory, "workflows.sqlite3") });
  t.after(async () => { workflows.close(); await google.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const owners = [{ ownerType: "admin", ownerId: "primary" }, { ownerType: "child", ownerId: "primary" },
    { ownerType: "additional", ownerId: "profile_a" }, { ownerType: "additional", ownerId: "profile_b" }];
  const records = new Map();
  for (const owner of owners) {
    const googleId = CredentialStore.generateId(); const facebookId = FacebookCredentialStore.generateId();
    await google.save({ id: googleId, accountEmail: `${owner.ownerType}-${owner.ownerId}@example.com`, tokens: { refresh_token: `google-${owner.ownerId}` } }, owner);
    facebook.save({ id: facebookId, accountId: `account-${owner.ownerId}`, pageId: `page-${owner.ownerId}`, tokens: { userAccessToken: `facebook-${owner.ownerId}` } }, owner);
    const definition = (name) => ({ name, nodes: [{ id: "google", config: { credentialId: googleId } }, { id: "facebook", config: { credentialId: facebookId } }], connections: [] });
    const first = workflows.createWorkflow(definition("Workflow 1"), owner); const second = workflows.createWorkflow(definition("Workflow 2"), owner);
    const duplicate = workflows.createWorkflow({ ...definition("Workflow 1 copy"), nodes: first.nodes }, owner);
    for (const workflow of [first, second, duplicate]) {
      assert.equal(workflow.nodes[0].config.credentialId, googleId); assert.equal(workflow.nodes[1].config.credentialId, facebookId);
      assert.ok(await google.get(googleId, { owner })); assert.ok(facebook.get(facebookId, { owner }));
    }
    records.set(`${owner.ownerType}:${owner.ownerId}`, { googleId, facebookId });
  }
  const additionalA = owners[2];
  for (const foreign of [owners[0], owners[1], owners[3]]) {
    const ids = records.get(`${foreign.ownerType}:${foreign.ownerId}`);
    assert.equal(await google.get(ids.googleId, { owner: additionalA }), null);
    assert.equal(facebook.get(ids.facebookId, { owner: additionalA }), null);
  }
  assert.equal(workflows.listWorkflows({ owner: additionalA }).total, 3);
  assert.equal(workflows.listWorkflows({ owner: owners[3] }).total, 3);
});
