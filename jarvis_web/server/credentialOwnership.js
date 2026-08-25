"use strict";

const ADMIN_CREDENTIAL_OWNER = Object.freeze({ ownerType: "admin", ownerId: "primary" });
const OWNER_TYPES = new Set(["admin", "child", "additional"]);

function normalizeCredentialOwner(owner = ADMIN_CREDENTIAL_OWNER) {
  const ownerType = String(owner?.ownerType || ADMIN_CREDENTIAL_OWNER.ownerType).trim().toLowerCase();
  const ownerId = String(owner?.ownerId || ADMIN_CREDENTIAL_OWNER.ownerId).trim();
  if (!OWNER_TYPES.has(ownerType) || !ownerId || ownerId.length > 200) throw new Error("Invalid credential owner.");
  return { ownerType, ownerId };
}

module.exports = { ADMIN_CREDENTIAL_OWNER, normalizeCredentialOwner };
