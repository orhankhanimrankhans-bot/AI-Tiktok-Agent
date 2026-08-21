import assert from "node:assert/strict";
import test from "node:test";

import {
  assignCredentialToNode,
  googleCredentialLabel,
  selectOAuthCredential,
} from "./googleCredentialState.js";

test("OAuth completion selects the exact returned credential and assigns it to the node", () => {
  const credentials = [
    { id: "gcred_first", accountEmail: "first@example.com" },
    { id: "gcred_returned", accountEmail: "returned@example.com" },
  ];
  const selected = selectOAuthCredential(credentials, "gcred_returned");
  const nodes = assignCredentialToNode(
    [{ id: "node-1", config: { credentialId: "" } }],
    "node-1",
    selected.id
  );

  assert.equal(selected.accountEmail, "returned@example.com");
  assert.equal(nodes[0].config.credentialId, "gcred_returned");
  assert.equal(googleCredentialLabel(selected), "Google Drive - returned@example.com");
});
