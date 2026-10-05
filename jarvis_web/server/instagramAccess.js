"use strict";
const { InstagramError } = require("./instagramApi");
function authorizeInstagramOwner(store, owner) {
  if (store?.securityState() !== "enabled" || !owner) throw new InstagramError("access_denied", "An authenticated workspace is required.", 403);
  if (owner.ownerType === "admin" && owner.ownerId === "primary") return;
  const profile = owner.ownerType === "child" && owner.ownerId === "primary" ? store.childAccount() : owner.ownerType === "additional" ? store.getChild(owner.ownerId) : null;
  // Additional Access has edit_workflow; Child uses manage_workflow_credentials.
  const credentialPermission = owner.ownerType === "additional" ? "edit_workflow" : "manage_workflow_credentials";
  if (!profile?.enabled || (profile.accessExpiresAt && profile.accessExpiresAt <= Date.now()) || !profile.permissions?.[credentialPermission] || !profile.permissions?.run_workflow) throw new InstagramError("access_denied", "Instagram requires workflow execution and account-management access in this workspace.", 403);
}
module.exports = { authorizeInstagramOwner };
