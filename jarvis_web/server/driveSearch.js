const { CredentialStore } = require("./credentialStore");

const MAX_RESULTS = 1000;
const DEFAULT_LIMIT = 50;
const NAME_SEARCH_METHOD = "Search File/Folder Name";

class DriveSearchError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = "DriveSearchError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function escapeDriveQueryValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function normalizeSearchRequest(request = {}) {
  const credentialId = typeof request.credentialId === "string"
    ? request.credentialId.trim()
    : "";
  if (!credentialId) {
    throw new DriveSearchError(400, "missing_credential", "Select a Google Drive credential before executing.");
  }

  const searchMethod = request.searchMethod || NAME_SEARCH_METHOD;
  if (searchMethod !== NAME_SEARCH_METHOD) {
    throw new DriveSearchError(400, "unsupported_search_method", "Only Search File/Folder Name is currently supported.");
  }

  const query = typeof request.query === "string" ? request.query.trim() : "";
  if (!query) {
    throw new DriveSearchError(400, "missing_query", "Enter a file or folder name to search for.");
  }

  const requestedLimit = Number.parseInt(request.limit, 10);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(MAX_RESULTS, Math.max(1, requestedLimit))
    : DEFAULT_LIMIT;

  return {
    credentialId,
    query,
    folderId: typeof request.folderId === "string" ? request.folderId.trim() : "",
    mimeType: typeof request.mimeType === "string" ? request.mimeType.trim() : "",
    returnAll: request.returnAll === true,
    limit,
    searchMethod,
  };
}

function buildDriveQuery({ query, folderId, mimeType }) {
  const clauses = [
    `name contains '${escapeDriveQueryValue(query)}'`,
    "trashed = false",
  ];
  if (folderId) clauses.push(`'${escapeDriveQueryValue(folderId)}' in parents`);
  if (mimeType && mimeType.toLowerCase() !== "any") {
    clauses.push(`mimeType = '${escapeDriveQueryValue(mimeType)}'`);
  }
  return clauses.join(" and ");
}

function sanitizeGoogleMessage(message) {
  return String(message || "")
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [REDACTED]")
    .replace(/(access_token|refresh_token|authorization|client_secret|token_ciphertext)\s*[:=]\s*[^\s,;}]+/gi, "$1=[REDACTED]")
    .slice(0, 500);
}

function inspectGoogleError(error) {
  const status = Number(error?.response?.status || error?.code || 0);
  const apiError = error?.response?.data?.error;
  return {
    status,
    apiCode: apiError?.code || status || null,
    reason: apiError?.errors?.[0]?.reason || error?.errors?.[0]?.reason || "unknown",
    message: sanitizeGoogleMessage(apiError?.message || error?.message || "Google Drive request failed."),
  };
}

function googleErrorDetails(error) {
  const diagnostic = inspectGoogleError(error);
  const { status, reason, message } = diagnostic;
  if (status === 401) {
    return new DriveSearchError(401, "invalid_google_credential", "The selected Google credential is expired or invalid. Reconnect it and try again.");
  }
  if (status === 403 && /rateLimit|userRateLimit|quota/i.test(reason)) {
    return new DriveSearchError(429, "google_rate_limit", "Google Drive rate limit reached. Try again shortly.");
  }
  if (status === 403 && /accessNotConfigured|serviceDisabled|apiDisabled/i.test(`${reason} ${message}`)) {
    return new DriveSearchError(503, "drive_api_not_enabled", "Google Drive API is not enabled for this Google Cloud project.");
  }
  if (status === 403 && /insufficientPermissions|insufficient_scope|insufficient authentication scopes/i.test(`${reason} ${message}`)) {
    return new DriveSearchError(403, "insufficient_oauth_scopes", "The selected credential lacks the required Google Drive OAuth scope. Reconnect it and grant Drive access.");
  }
  if (status === 403) {
    return new DriveSearchError(403, "google_drive_forbidden", "Google denied this Drive search. Check account access and Google Cloud policy.");
  }
  if (status === 400) {
    return new DriveSearchError(400, "malformed_drive_search", "Google Drive rejected the search parameters.");
  }
  return new DriveSearchError(502, "google_drive_failure", "Google Drive search failed. Try again later.");
}

function publicDriveFile(file = {}) {
  const result = {};
  for (const field of [
    "id", "name", "mimeType", "webViewLink", "modifiedTime",
    "createdTime", "parents", "size",
  ]) {
    if (file[field] !== undefined) result[field] = file[field];
  }
  return result;
}

async function executeDriveSearch({
  request,
  credentialStore,
  createOAuthClient,
  createDriveClient,
  logger = console,
}) {
  const params = normalizeSearchRequest(request);
  if (!CredentialStore.isValidId(params.credentialId)) {
    throw new DriveSearchError(400, "invalid_credential_id", "Invalid Google credential ID.");
  }

  const credential = await credentialStore.get(params.credentialId, { includeTokens: true });
  if (!credential) {
    throw new DriveSearchError(404, "credential_not_found", "The selected Google credential was not found.");
  }
  if (!credential.tokens?.access_token && !credential.tokens?.refresh_token) {
    throw new DriveSearchError(409, "credential_not_usable", "The selected Google credential has no usable OAuth tokens. Reconnect it and try again.");
  }

  const oauth2Client = createOAuthClient();
  if (!oauth2Client) {
    throw new DriveSearchError(503, "google_oauth_not_configured", "Google OAuth is not configured on the server.");
  }
  oauth2Client.setCredentials(credential.tokens);

  let refreshedTokens = null;
  oauth2Client.on("tokens", (tokens) => {
    refreshedTokens = { ...(refreshedTokens || {}), ...tokens };
  });

  const drive = createDriveClient(oauth2Client);
  const files = [];
  let pageToken;
  const maxResults = params.returnAll ? MAX_RESULTS : params.limit;

  try {
    do {
      const response = await drive.files.list({
        q: buildDriveQuery(params),
        fields: "nextPageToken, files(id,name,mimeType,webViewLink,modifiedTime,createdTime,parents,size)",
        pageSize: Math.min(1000, maxResults - files.length),
        pageToken,
      });
      files.push(...(response.data?.files || []));
      pageToken = response.data?.nextPageToken;
    } while (params.returnAll && pageToken && files.length < maxResults);
  } catch (error) {
    const diagnostic = inspectGoogleError(error);
    logger.error("Google Drive API request failed", diagnostic);
    throw googleErrorDetails(error);
  } finally {
    if (refreshedTokens) {
      await credentialStore.save({
        id: credential.id,
        accountEmail: credential.accountEmail,
        accountName: credential.accountName,
        tokens: { ...credential.tokens, ...refreshedTokens },
      });
    }
  }

  const limitedFiles = files.slice(0, maxResults).map(publicDriveFile);
  return {
    status: "success",
    credentialId: credential.id,
    count: limitedFiles.length,
    files: limitedFiles,
  };
}

module.exports = {
  DriveSearchError,
  buildDriveQuery,
  executeDriveSearch,
  inspectGoogleError,
  normalizeSearchRequest,
  sanitizeGoogleMessage,
};
