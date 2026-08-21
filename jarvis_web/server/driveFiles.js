const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { CredentialStore } = require("./credentialStore");
const { DriveSearchError } = require("./driveSearch");

async function selectedDrive({ request, credentialStore, createOAuthClient, createDriveClient }) {
  const credentialId = String(request.credentialId || "");
  if (!CredentialStore.isValidId(credentialId)) throw new DriveSearchError(400, "invalid_credential_id", "Select a valid Google Drive credential.");
  const credential = await credentialStore.get(credentialId, { includeTokens: true });
  if (!credential) throw new DriveSearchError(404, "credential_not_found", "The selected Google credential was not found.");
  const auth = createOAuthClient();
  if (!auth) throw new DriveSearchError(503, "google_oauth_not_configured", "Google OAuth is not configured.");
  auth.setCredentials(credential.tokens);
  let refreshed = null;
  auth.on("tokens", (tokens) => { refreshed = { ...(refreshed || {}), ...tokens }; });
  return { credential, auth, drive: createDriveClient(auth), persistRefresh: async () => {
    if (refreshed) await credentialStore.save({ id: credential.id, accountEmail: credential.accountEmail,
      accountName: credential.accountName, tokens: { ...credential.tokens, ...refreshed } });
  } };
}

function validFileId(value) {
  const id = String(value || "").trim();
  if (!id || id.length > 200 || !/^[A-Za-z0-9_-]+$/.test(id)) throw new DriveSearchError(400, "invalid_file_id", "Enter a valid Google Drive file ID.");
  return id;
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

module.exports = { executeDriveDelete, executeDriveDownload, validFileId };
