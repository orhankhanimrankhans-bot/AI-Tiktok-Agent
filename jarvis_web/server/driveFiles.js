const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { CredentialStore, GOOGLE_DRIVE_PROVIDER } = require("./credentialStore");
const { DriveSearchError } = require("./driveSearch");

async function selectedDrive({ request, credentialStore, createOAuthClient, createDriveClient, owner }) {
  const credentialId = String(request.credentialId || "");
  if (!CredentialStore.isValidId(credentialId)) throw new DriveSearchError(400, "invalid_credential_id", "Select a valid Google Drive credential.");
  const credential = await credentialStore.get(credentialId, { includeTokens: true, owner, provider: GOOGLE_DRIVE_PROVIDER });
  if (!credential) throw new DriveSearchError(404, "credential_not_found", "The selected Google credential was not found.");
  const auth = createOAuthClient();
  if (!auth) throw new DriveSearchError(503, "google_oauth_not_configured", "Google OAuth is not configured.");
  auth.setCredentials(credential.tokens);
  let refreshed = null;
  auth.on("tokens", (tokens) => { refreshed = { ...(refreshed || {}), ...tokens }; });
  return { credential, auth, drive: createDriveClient(auth), persistRefresh: async () => {
    if (refreshed) await credentialStore.save({ id: credential.id, provider: GOOGLE_DRIVE_PROVIDER, accountEmail: credential.accountEmail,
      accountName: credential.accountName, tokens: { ...credential.tokens, ...refreshed } }, owner);
  } };
}

function validFileId(value) {
  const id = String(value || "").trim();
  if (!id || id.length > 200 || !/^[A-Za-z0-9_-]+$/.test(id)) throw new DriveSearchError(400, "invalid_file_id", "Enter a valid Google Drive file ID.");
  return id;
}

function transientDriveError(error) {
  const status = Number(error?.response?.status || error?.code || 0);
  return status === 429 || (status >= 500 && status <= 599);
}

async function executeDriveMove(options) {
  const fileId = validFileId(options.request.fileId);
  const destinationFolderId = validFileId(options.request.destinationFolderId);
  const selected = await selectedDrive(options); const maxAttempts = 3;
  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const metadata = await selected.drive.files.get({ fileId, fields: "id,name,parents", supportsAllDrives: true });
        const parents = Array.isArray(metadata.data?.parents) ? metadata.data.parents.map(String) : [];
        const removeParents = parents.filter((parentId) => parentId !== destinationFolderId);
        if (!parents.includes(destinationFolderId) || removeParents.length) {
          const request = { fileId, fields: "id,name,parents", supportsAllDrives: true };
          if (!parents.includes(destinationFolderId)) request.addParents = destinationFolderId;
          if (removeParents.length) request.removeParents = removeParents.join(",");
          await selected.drive.files.update(request);
        }
        return { success: true, fileId, fileName: String(metadata.data?.name || ""), destinationFolderId, status: "moved" };
      } catch (error) {
        if (!transientDriveError(error) || attempt === maxAttempts) {
          throw new DriveSearchError(transientDriveError(error) ? 502 : 400, "drive_move_failed",
            "The source video could not be moved to the configured Google Drive folder.");
        }
        await (options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(attempt * 100);
      }
    }
  } finally { await selected.persistRefresh(); }
}

async function executeDriveDownload(options) {
  const fileId = validFileId(options.request.fileId);
  const property = String(options.request.binaryProperty || "data").trim() || "data";
  const selected = await selectedDrive(options);
  try {
    const metadata = await selected.drive.files.get({ fileId, fields: "id,name,mimeType,size" });
    if (String(metadata.data.mimeType || "").startsWith("application/vnd.google-apps.")) {
      throw new DriveSearchError(409, "workspace_export_required", "Google Workspace files require an explicit export format, which is not configured.");
    }
    const response = await selected.drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
    const bytes = Buffer.from(response.data);
    const referenceId = `bin_${crypto.randomBytes(16).toString("base64url")}`;
    fs.mkdirSync(options.binaryDir, { recursive: true });
    fs.writeFileSync(path.join(options.binaryDir, referenceId), bytes, { flag: "wx" });
    return { fileId, fileName: metadata.data.name, mimeType: metadata.data.mimeType,
      binary: { property, referenceId, size: bytes.length } };
  } finally { await selected.persistRefresh(); }
}

async function executeDriveDelete(options) {
  const fileId = validFileId(options.request.fileId);
  const selected = await selectedDrive(options);
  try { await selected.drive.files.delete({ fileId }); return { deleted: true, fileId }; }
  finally { await selected.persistRefresh(); }
}

module.exports = { executeDriveDelete, executeDriveDownload, executeDriveMove, validFileId };
