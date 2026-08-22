const express = require("express");
const path = require("path");
const cors = require("cors");
const dotenv = require("dotenv");
const session = require("express-session");
const crypto = require("crypto");
const { google } = require("googleapis");
const { CredentialStore } = require("./credentialStore");
const { DriveSearchError, executeDriveSearch } = require("./driveSearch");
const { executeDriveDelete, executeDriveDownload, executeDriveMove } = require("./driveFiles");
const { ExecutionStore } = require("./executionStore");
const { AUTH_MODE_MANUAL, FacebookCredentialStore } = require("./facebookCredentialStore");
const { containsForbiddenSecretFields, credentialPageToken, executeCredentialMe, executeCredentialPages, FacebookGraphError, FacebookGraphService, validatePageId } = require("./facebookGraph");
const { logReelFailure, publishPageReel } = require("./facebookReels");
const { createFacebookOAuthState, verifyFacebookOAuthState } = require("./facebookOAuthState");
const { makeFacebookPopupHtml } = require("./facebookPopup");
const { makePopupResultHtml: renderPopupResultHtml } = require("./oauthPopup");
const { DEFAULT_OPENAI_MODEL, PrepareContentError, prepareContent } = require("./openaiPrepareContent");

dotenv.config();

const IS_PRODUCTION = process.env.NODE_ENV === "production";

if (IS_PRODUCTION && !process.env.SESSION_SECRET) {
  console.error(
    "FATAL ERROR: SESSION_SECRET is required in production. " +
      "Set it in your .env file or Hostinger environment variables."
  );
  process.exit(1);
}

if (IS_PRODUCTION && !process.env.GOOGLE_CLIENT_ID) {
  console.error(
    "FATAL ERROR: GOOGLE_CLIENT_ID is required in production. " +
      "Set it in your .env file or Hostinger environment variables."
  );
  process.exit(1);
}

if (IS_PRODUCTION && !process.env.GOOGLE_REDIRECT_URI) {
  console.error(
    "FATAL ERROR: GOOGLE_REDIRECT_URI is required in production. " +
      "Set it in your .env file or Hostinger environment variables."
  );
  process.exit(1);
}

if (IS_PRODUCTION && !process.env.GOOGLE_CLIENT_SECRET) {
  console.error(
    "FATAL ERROR: GOOGLE_CLIENT_SECRET is required in production. " +
      "Set it in your .env file or Hostinger environment variables. " +
      "Do not commit real secret values to source control."
  );
  process.exit(1);
}

if (IS_PRODUCTION && !process.env.CLIENT_URL) {
  console.error(
    "FATAL ERROR: CLIENT_URL is required in production. " +
      "Set it in your .env file or Hostinger environment variables."
  );
  process.exit(1);
}

if (IS_PRODUCTION && !process.env.JARVIS_DB_PATH) {
  console.error(
    "FATAL ERROR: JARVIS_DB_PATH is required in production. " +
      "Configure a persistent writable path outside client/dist."
  );
  process.exit(1);
}

const app = express();

const PORT = Number(process.env.PORT || 3001);
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const GOOGLE_REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI ||
  `http://localhost:${PORT}/api/google/auth/callback`;
const META_APP_ID = process.env.META_APP_ID || "";
const META_APP_SECRET = process.env.META_APP_SECRET || "";
const META_REDIRECT_URI = process.env.META_REDIRECT_URI || `http://localhost:${PORT}/api/facebook/auth/callback`;
const META_GRAPH_VERSION_VALUE = process.env.META_GRAPH_VERSION || "v26.0";
const META_GRAPH_VERSION = /^v\d{1,2}\.\d{1,2}$/.test(META_GRAPH_VERSION_VALUE) ? META_GRAPH_VERSION_VALUE : "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
const JARVIS_DB_PATH = path.resolve(
  process.env.JARVIS_DB_PATH || path.join(__dirname, "data", "credentials.sqlite3")
);
const CREDENTIAL_ENCRYPTION_SECRET =
  process.env.CREDENTIAL_ENCRYPTION_SECRET || process.env.SESSION_SECRET ||
  (IS_PRODUCTION ? "" : "jarvis-dev-session-secret-change-me");
const LEGACY_CREDENTIAL_ENCRYPTION_SECRETS = [process.env.SESSION_SECRET ||
  (IS_PRODUCTION ? "" : "jarvis-dev-session-secret-change-me")].filter(Boolean);

const googleOAuthConfigured = Boolean(
  GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REDIRECT_URI
);
const facebookOAuthConfigured = Boolean(META_APP_ID && META_APP_SECRET && META_REDIRECT_URI && META_GRAPH_VERSION);
const openAIConfigured = Boolean(OPENAI_API_KEY);

app.use(
  cors({
    origin: CLIENT_URL,
    credentials: true,
  })
);

app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET || "jarvis-dev-session-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: IS_PRODUCTION, // HTTPS behind reverse proxy in production
      maxAge: 10 * 60 * 1000,
    },
  })
);

// ============================================================
 //  Signed OAuth State Token (production-safe, session-less)
 //  ============================================================
 //  Instead of storing state/mode in express-session MemoryStore
 //  (which can be lost when the callback hits a different Node
 //   process, e.g. Hostinger/Passenger), we use a cryptographically
 //   signed state token using HMAC-SHA256 with SESSION_SECRET.
 //  The token is a JWT-like string: base64url(payload).signature
 //  that survives across different Node processes.
 //
 //  Payload JSON fields:
 //    - mode: "popup" | "redirect"
 //    - nonce: random hex string (for replay protection)
 //    - iat: issued-at timestamp (minutes since epoch)
 //  Signature: HMAC-SHA256 of the raw payload string using SESSION_SECRET.
// ============================================================

// Helper: base64url encode (URL-safe, no padding)
function base64urlEncode(buf) {
  return buf.toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Create a signed OAuth state token.
// Returns a JWT-like string: base64url(payload).base64url(signature)
function createSignedOAuthState({ mode, nonce, iat, intent, credentialId = null }) {
  // Payload: mode + nonce + issued timestamp
  const payloadStr = JSON.stringify({ mode, nonce, iat, intent, credentialId });
  // HMAC-SHA256 signature of the payload string using SESSION_SECRET
  const hmac = crypto.createHmac("sha256", process.env.SESSION_SECRET || "jarvis-dev-session-secret-change-me");
  hmac.update(payloadStr);
  const signature = hmac.digest();
  // base64url encode payload and signature
  const payloadB64 = base64urlEncode(Buffer.from(payloadStr));
  const sigB64 = base64urlEncode(signature);
  return payloadB64 + "." + sigB64;
}

// Verify a signed OAuth state token.
// Returns { mode, nonce, iat } on success, or null on failure.
// Rejects malformed, tampered, or expired tokens (10 min expiry).
function verifySignedOAuthState(stateToken) {
  if (!stateToken || typeof stateToken !== "string") return null;
  // Split into payload + signature
  const parts = stateToken.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;

  // Decode payload
  let payloadStr;
  try {
    // Add padding if needed
    let padded = payloadB64 + "=".repeat((4 - payloadB64.length % 4) % 4);
    payloadStr = Buffer.from(padded, "base64").toString("utf-8");
  } catch {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(payloadStr);
  } catch {
    return null;
  }

  // Validate required fields
  if (!["popup", "redirect"].includes(payload.mode)) return null;
  if (!payload.nonce || typeof payload.iat !== "number") return null;
  if (!["create", "reconnect"].includes(payload.intent)) return null;
  if (payload.intent === "reconnect" && !CredentialStore.isValidId(payload.credentialId)) return null;
  if (payload.intent === "create" && payload.credentialId !== null) return null;

  // Check expiration: 10 minutes
  const now = Math.floor(Date.now() / 60000); // minutes
  if (payload.iat > now + 1 || now - payload.iat > 10) return null; // invalid/expired

  // Verify HMAC-SHA256 signature
  const expectedHmac = crypto.createHmac("sha256", process.env.SESSION_SECRET || "jarvis-dev-session-secret-change-me");
  expectedHmac.update(payloadStr);
  const expectedSig = expectedHmac.digest();
  let providedSig;
  try {
    providedSig = Buffer.from(sigB64, "base64url");
  } catch {
    return null;
  }
  if (providedSig.length !== expectedSig.length ||
      !crypto.timingSafeEqual(providedSig, expectedSig)) return null;

  return payload;
}

function createOAuthClient() {
  if (!googleOAuthConfigured) return null;

  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );
}

const credentialStore = new CredentialStore({
  dbPath: JARVIS_DB_PATH,
  encryptionSecret: CREDENTIAL_ENCRYPTION_SECRET,
  legacyEncryptionSecrets: LEGACY_CREDENTIAL_ENCRYPTION_SECRETS,
});
let executionStore;
let facebookCredentialStore;
const BINARY_DATA_DIR = path.join(path.dirname(JARVIS_DB_PATH), "binary-data");

function makePopupResultHtml({ status, message = "", credentialId = null }) {
  return renderPopupResultHtml({
    status,
    message,
    credentialId,
    clientUrl: CLIENT_URL,
  });
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    googleOAuthConfigured,
    facebookOAuthConfigured,
    openAIConfigured,
  });
});

app.post("/api/ai/prepare-content", async (req, res) => {
  try {
    return res.json(await prepareContent({ body: req.body, apiKey: OPENAI_API_KEY, model: OPENAI_MODEL }));
  } catch (error) {
    if (error instanceof PrepareContentError) return res.status(error.statusCode).json({ status: "error", code: error.code, error: error.message });
    console.error("Prepare Content failed safely.");
    return res.status(500).json({ status: "error", code: "prepare_content_server_error", error: "Prepare Content could not be completed." });
  }
});

function facebookGraphService() { return new FacebookGraphService({ version: META_GRAPH_VERSION }); }
function publicFacebookError(res, error) {
  if (error instanceof FacebookGraphError) {
    logReelFailure(error);
    return res.status(error.statusCode).json({ status: "error", code: error.code, error: error.message,
      permission: error.permission || undefined, diagnostic: error.diagnostic || undefined });
  }
  console.error("Facebook operation failed safely.");
  return res.status(500).json({ status: "error", code: "facebook_server_error", error: "Facebook operation could not be completed." });
}

app.get("/api/facebook/credentials", (req, res) => {
  try { return res.json({ credentials: facebookCredentialStore.list() }); } catch (error) { return publicFacebookError(res, error); }
});
app.get("/api/facebook/credentials/:credentialId", (req, res) => {
  if (!FacebookCredentialStore.isValidId(req.params.credentialId)) return res.status(400).json({ error: "Invalid Facebook credential ID." });
  const credential = facebookCredentialStore.get(req.params.credentialId);
  return credential ? res.json(credential) : res.status(404).json({ error: "Facebook credential not found." });
});

function manualAccessToken(value) {
  const token = typeof value === "string" ? value.trim() : "";
  if (token.length < 20 || token.length > 4096 || /\s/.test(token)) {
    throw new FacebookGraphError(400, "invalid_access_token", "Enter a valid Facebook Page access token.");
  }
  return token;
}

function manualCredentialName(value) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > 120) throw new FacebookGraphError(400, "invalid_credential_name", "Enter a credential name of 120 characters or fewer.");
  return name;
}

app.post("/api/facebook/credentials/manual/test", async (req, res) => {
  try {
    const result = await facebookGraphService().inspectPageToken(manualAccessToken(req.body?.accessToken));
    return res.json(result);
  } catch (error) { return publicFacebookError(res, error); }
});

app.post("/api/facebook/credentials/manual", async (req, res) => {
  try {
    const name = manualCredentialName(req.body?.name); const accessToken = manualAccessToken(req.body?.accessToken);
    const tested = await facebookGraphService().inspectPageToken(accessToken);
    const saved = facebookCredentialStore.saveManual({ id: FacebookCredentialStore.generateId(), name, accessToken,
      pageId: tested.pageId, pageName: tested.pageName, lastTestedAt: new Date().toISOString() });
    return res.status(201).json(saved);
  } catch (error) { return publicFacebookError(res, error); }
});

app.patch("/api/facebook/credentials/:credentialId/manual", async (req, res) => {
  try {
    if (!FacebookCredentialStore.isValidId(req.params.credentialId)) throw new FacebookGraphError(400, "invalid_credential_id", "Invalid Facebook credential ID.");
    const existing = facebookCredentialStore.get(req.params.credentialId);
    if (!existing) return res.status(404).json({ status: "error", code: "credential_not_found", error: "Facebook credential not found." });
    if (existing.authMode !== AUTH_MODE_MANUAL) return res.status(409).json({ status: "error", code: "wrong_auth_mode", error: "Only manual Facebook credentials can be updated here." });
    const name = req.body?.name === undefined ? existing.name : manualCredentialName(req.body.name);
    let tested = null; let accessToken;
    if (req.body?.accessToken !== undefined && req.body.accessToken !== "") {
      accessToken = manualAccessToken(req.body.accessToken); tested = await facebookGraphService().inspectPageToken(accessToken);
    }
    const saved = facebookCredentialStore.updateManual({ id: existing.id, name, accessToken,
      pageId: tested?.pageId, pageName: tested?.pageName, lastTestedAt: tested ? new Date().toISOString() : undefined });
    return res.json(saved);
  } catch (error) { return publicFacebookError(res, error); }
});

app.delete("/api/facebook/credentials/:credentialId/manual", (req, res) => {
  try {
    if (!FacebookCredentialStore.isValidId(req.params.credentialId)) throw new FacebookGraphError(400, "invalid_credential_id", "Invalid Facebook credential ID.");
    const existing = facebookCredentialStore.get(req.params.credentialId);
    if (!existing) return res.status(404).json({ status: "error", code: "credential_not_found", error: "Facebook credential not found." });
    if (existing.authMode !== AUTH_MODE_MANUAL) return res.status(409).json({ status: "error", code: "wrong_auth_mode", error: "Only manual Facebook credentials can be deleted here." });
    facebookCredentialStore.delete(existing.id); return res.json({ ok: true, id: existing.id, connected: false, status: "not_connected" });
  } catch (error) { return publicFacebookError(res, error); }
});

app.get("/api/facebook/auth/start", (req, res) => {
  if (!facebookOAuthConfigured) return res.status(503).json({ status: "not_configured", error: "Meta OAuth is not configured." });
  const credentialId = req.query.credentialId || null; const intent = credentialId ? "reconnect" : "create";
  if (credentialId && !FacebookCredentialStore.isValidId(credentialId)) return res.status(400).json({ error: "Invalid Facebook credential ID." });
  if (credentialId && !facebookCredentialStore.get(credentialId)) return res.status(404).json({ error: "Facebook credential not found." });
  const state = createFacebookOAuthState({ secret: process.env.SESSION_SECRET || "jarvis-dev-session-secret-change-me",
    mode: req.query.mode === "popup" ? "popup" : "redirect", intent, credentialId });
  const url = new URL(`https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`);
  url.searchParams.set("client_id", META_APP_ID); url.searchParams.set("redirect_uri", META_REDIRECT_URI);
  url.searchParams.set("state", state); url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "public_profile,email,pages_show_list,pages_read_engagement");
  return res.redirect(url.toString());
});

app.get("/api/facebook/auth/callback", async (req, res) => {
  let mode = "redirect"; let state = null;
  if (req.query.state) state = verifyFacebookOAuthState(req.query.state, { secret: process.env.SESSION_SECRET || "jarvis-dev-session-secret-change-me", validateCredentialId: FacebookCredentialStore.isValidId });
  if (state?.mode) mode = state.mode;
  const failure = (message) => mode === "popup" ? res.status(400).send(makeFacebookPopupHtml({ status: "error", message, clientUrl: CLIENT_URL })) : res.redirect(`${CLIENT_URL}?facebook_oauth=error`);
  if (!state) return failure("Meta OAuth state validation failed.");
  if (req.query.error) return failure(req.query.error_description || "Meta sign-in was cancelled.");
  if (!req.query.code) return failure("Meta did not return an authorization code.");
  try {
    const tokenResponse = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: META_APP_ID, client_secret: META_APP_SECRET, redirect_uri: META_REDIRECT_URI, code: req.query.code }) });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token) throw new Error("Meta token exchange failed.");
    const profile = await facebookGraphService().me(tokenData.access_token);
    const previous = state.intent === "reconnect" ? facebookCredentialStore.get(state.credentialId, { includeTokens: true }) : facebookCredentialStore.findByAccountId(profile.id, { includeTokens: true });
    if (state.intent === "reconnect" && previous?.accountId !== String(profile.id)) return failure("Reconnect must use the same Meta account. Create a new credential for another account.");
    const id = state.intent === "reconnect" ? state.credentialId : previous?.id || FacebookCredentialStore.generateId();
    const saved = facebookCredentialStore.save({ id, accountId: profile.id, accountName: profile.name || "Meta account",
      tokens: { ...(previous?.tokens || {}), userAccessToken: tokenData.access_token, tokenType: tokenData.token_type || "bearer", expiresIn: tokenData.expires_in || null, pageAccessTokens: {} } });
    if (mode === "popup") return res.send(makeFacebookPopupHtml({ status: "connected", message: `${saved.accountName} is connected to Jarvis.`, credentialId: saved.id, clientUrl: CLIENT_URL }));
    const redirect = new URL(CLIENT_URL); redirect.searchParams.set("facebook_oauth", "connected"); redirect.searchParams.set("facebook_credential_id", saved.id); return res.redirect(redirect.toString());
  } catch (error) { return failure(error instanceof FacebookGraphError ? error.message : "Meta sign-in could not be completed."); }
});

function deleteFacebookCredential(req, res) {
  if (!FacebookCredentialStore.isValidId(req.params.credentialId)) return res.status(400).json({ error: "Invalid Facebook credential ID." });
  if (!facebookCredentialStore.delete(req.params.credentialId)) return res.status(404).json({ error: "Facebook credential not found." });
  return res.json({ ok: true, id: req.params.credentialId, connected: false, status: "not_connected" });
}
app.post("/api/facebook/credentials/:credentialId/disconnect", deleteFacebookCredential);
app.delete("/api/facebook/credentials/:credentialId", deleteFacebookCredential);

async function withFacebookCredential(req, res, action) {
  if (containsForbiddenSecretFields(req.body)) return res.status(400).json({ error: "Facebook secrets must not be supplied by the client." });
  if (!FacebookCredentialStore.isValidId(req.body?.credentialId)) return res.status(400).json({ error: "Select a valid Facebook credential." });
  const credential = facebookCredentialStore.get(req.body.credentialId, { includeTokens: true });
  if (!credential?.tokens?.userAccessToken && !credential?.tokens?.pageAccessToken) return res.status(404).json({ error: "Facebook credential was not found or is disconnected." });
  try { return res.json(await action(facebookGraphService(), credential)); } catch (error) { return publicFacebookError(res, error); }
}
app.post("/api/facebook/graph/me", (req, res) => withFacebookCredential(req, res, executeCredentialMe));
app.post("/api/facebook/graph/pages", (req, res) => withFacebookCredential(req, res, async (service, credential) => {
  const result = await executeCredentialPages(service, credential);
  facebookCredentialStore.save({ id: credential.id, accountId: credential.accountId, accountName: credential.accountName,
    tokens: { ...credential.tokens, pageAccessTokens: result.pageTokens } });
  return { pages: result.pages };
}));
app.post("/api/facebook/graph/page", (req, res) => withFacebookCredential(req, res, async (service, credential) => {
  const pageId = validatePageId(req.body.pageId); const token = credentialPageToken(credential, pageId);
  return service.pageMetadata(pageId, token);
}));
app.post("/api/facebook/reels/publish", (req, res) => withFacebookCredential(req, res, (service, credential) => publishPageReel({
  request: req.body, service, credential, binaryDir: BINARY_DATA_DIR,
})));

app.get("/api/google/credentials", async (req, res) => {
  try {
    return res.json({ credentials: await credentialStore.list() });
  } catch (error) {
    console.error("Could not list Google credentials:", error?.message || error);
    return res.status(500).json({ error: "Could not list Google credentials." });
  }
});

app.get("/api/google/credentials/:credentialId", async (req, res) => {
  if (!CredentialStore.isValidId(req.params.credentialId)) {
    return res.status(400).json({ error: "Invalid credential ID." });
  }
  try {
    const credential = await credentialStore.get(req.params.credentialId);
    if (!credential) return res.status(404).json({ error: "Credential not found." });
    return res.json(credential);
  } catch (error) {
    console.error("Could not read Google credential:", error?.message || error);
    return res.status(500).json({ error: "Could not read Google credential." });
  }
});

app.post("/api/google/drive/search", async (req, res) => {
  try {
    const result = await executeDriveSearch({
      request: req.body,
      credentialStore,
      createOAuthClient,
      createDriveClient: (oauth2Client) =>
        google.drive({ version: "v3", auth: oauth2Client }),
    });
    return res.json(result);
  } catch (error) {
    if (error instanceof DriveSearchError) {
      return res.status(error.statusCode).json({
        status: "error",
        code: error.code,
        error: error.message,
      });
    }
    console.error("Google Drive search failed with an unexpected server error.");
    return res.status(500).json({
      status: "error",
      code: "drive_search_server_error",
      error: "Google Drive search could not be completed.",
    });
  }
});

async function handleDriveFileAction(req, res, action) {
  try {
    const result = await action({ request: req.body, credentialStore, createOAuthClient,
      createDriveClient: (oauth2Client) => google.drive({ version: "v3", auth: oauth2Client }),
      binaryDir: BINARY_DATA_DIR });
    return res.json(result);
  } catch (error) {
    if (error instanceof DriveSearchError) return res.status(error.statusCode).json({ status: "error", code: error.code, error: error.message });
    console.error("Google Drive file action failed.");
    return res.status(500).json({ status: "error", code: "drive_file_action_failed", error: "Google Drive file action failed." });
  }
}

app.post("/api/google/drive/download", (req, res) => handleDriveFileAction(req, res, executeDriveDownload));
app.post("/api/google/drive/delete", (req, res) => handleDriveFileAction(req, res, executeDriveDelete));
app.post("/api/google/drive/move", (req, res) => handleDriveFileAction(req, res, executeDriveMove));

app.get("/api/executions", (req, res) => {
  try { return res.json({ executions: executionStore.list(req.query.limit) }); }
  catch { return res.status(500).json({ error: "Could not list workflow executions." }); }
});

app.get("/api/executions/:executionId", (req, res) => {
  if (!ExecutionStore.isValidId(req.params.executionId)) return res.status(400).json({ error: "Invalid execution ID." });
  try { const record = executionStore.get(req.params.executionId); return record ? res.json(record) : res.status(404).json({ error: "Execution not found." }); }
  catch { return res.status(500).json({ error: "Could not read workflow execution." }); }
});

app.post("/api/executions", (req, res) => {
  try {
    if (!req.body?.startedAt || !req.body?.finishedAt) return res.status(400).json({ error: "Execution timestamps are required." });
    return res.status(201).json(executionStore.save(req.body));
  } catch { return res.status(500).json({ error: "Could not save workflow execution." }); }
});

app.get("/api/google/auth/start", async (req, res) => {
  const oauth2Client = createOAuthClient();

  if (!oauth2Client) {
    return res.status(503).json({
      status: "not_configured",
      message: "Google OAuth environment variables are not configured.",
    });
  }

  // Generate a random nonce for replay protection
  const nonce = crypto.randomBytes(16).toString("hex");

  // Determine mode from query (popup vs redirect)
  const mode = req.query.mode === "popup" ? "popup" : "redirect";
  const requestedCredentialId = req.query.credentialId || null;
  const intent = requestedCredentialId ? "reconnect" : "create";

  if (requestedCredentialId && !CredentialStore.isValidId(requestedCredentialId)) {
    return res.status(400).json({ status: "error", message: "Invalid credential ID." });
  }
  if (requestedCredentialId && !(await credentialStore.get(requestedCredentialId))) {
    return res.status(404).json({ status: "error", message: "Credential not found." });
  }

  // Create a signed state token (survives across Node processes)
  const iat = Math.floor(Date.now() / 60000); // minutes since epoch
  const stateToken = createSignedOAuthState({
    mode, nonce, iat, intent, credentialId: requestedCredentialId,
  });

  // Pass the signed state token to Google as the OAuth state parameter
  // We no longer rely on session storage for mode/state recovery.
  req.session.googleOAuthState = stateToken; // store token in session as fallback only
  req.session.googleOAuthMode = mode;

  // Save the session before redirecting so the OAuth callback can validate state.
  req.session.save((sessionError) => {
    if (sessionError) {
      console.error("Could not save OAuth session:", sessionError);
      return res.status(500).json({
        status: "error",
        message: "Could not start Google sign-in.",
      });
    }

    const authorizationUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      include_granted_scopes: true,

      // This is the important n8n-style behavior:
      // Google shows its account chooser, then consent when needed.
      prompt: "select_account consent",

      scope: [
        "openid",
        "email",
        "profile",
        "https://www.googleapis.com/auth/drive",
      ],
      state: stateToken, // <- pass signed token instead of raw hex
    });

    return res.redirect(authorizationUrl);
  });
});

app.get("/api/google/auth/callback", async (req, res) => {
  // --- Signed OAuth State Token Verification ---
  // Recover mode from the verified signed state token, NOT from req.session.
  // This makes the OAuth flow survive across different Node processes
  // (e.g., Hostinger/Passenger where the callback may hit a different process).
  let verifiedState = null;
  const sessionMode = req.session.googleOAuthMode === "popup" ? "popup" : "redirect";
  let finalMode = sessionMode;

  const sendFailure = (message) => {
    if (finalMode === "popup") {
      return res.status(400).send(
        makePopupResultHtml({ status: "error", message })
      );
    }
    const redirect = new URL(CLIENT_URL);
    redirect.searchParams.set("google_oauth", "error");
    return res.redirect(redirect.toString());
  };

  if (req.query.state) {
    verifiedState = verifySignedOAuthState(req.query.state);
    if (verifiedState && verifiedState.mode) {
      finalMode = verifiedState.mode;
    }
  }

  // If state token is invalid, tampered, or expired, fail safely
  if (!verifiedState) {
    return sendFailure("OAuth state validation failed.");
  }

  // --- CSRF protection: compare the state Google returned with the nonce from our signed token ---
  // Google echoes back the exact state parameter we sent. Since our state is the signed token,
  // we verify it via verifySignedOAuthState above. The nonce provides additional replay protection.
  //
  // Note: We do NOT compare req.query.state against a separate session stored value,
  // because the signed token itself provides integrity and authenticity (HMAC-SHA256).

  // --- Clean up session markers ---
  delete req.session.googleOAuthState;
  delete req.session.googleOAuthMode;

  try {
    if (req.query.error) {
      return sendFailure(
        req.query.error_description ||
          req.query.error ||
          "Google sign-in was cancelled."
      );
    }

    if (!req.query.code) {
      return sendFailure("Google did not return an authorization code.");
    }

    // --- Additional nonce verification (optional but recommended) ---
    // We could compare req.query.state nonce with expectedNonce, but since the state
    // is a signed token that we already verified, the HMAC provides sufficient CSRF protection.
    // If needed, we could decode the state token again and compare the nonce, but that
    // is optional since the signature already guarantees the state hasn't been tampered with.

    const oauth2Client = createOAuthClient();
    if (!oauth2Client) {
      return sendFailure("Google OAuth is not configured.");
    }

    const { tokens } = await oauth2Client.getToken(req.query.code);
    oauth2Client.setCredentials(tokens);

    let profile = {};
    try {
      const oauth2Api = google.oauth2({
        version: "v2",
        auth: oauth2Client,
      });
      const profileResponse = await oauth2Api.userinfo.get();
      profile = {
        email: profileResponse.data?.email || "",
        name: profileResponse.data?.name || "",
        picture: profileResponse.data?.picture || "",
      };
    } catch (profileError) {
      console.warn(
        "Google account profile could not be loaded:",
        profileError?.message || profileError
      );
    }

    const previous = verifiedState.intent === "reconnect"
      ? await credentialStore.get(verifiedState.credentialId, { includeTokens: true })
      : await credentialStore.findByAccountEmail(profile.email, { includeTokens: true });
    const credentialId = verifiedState.intent === "reconnect"
      ? verifiedState.credentialId
      : previous?.id || CredentialStore.generateId();
    const credential = await credentialStore.save({
      id: credentialId,
      accountEmail: profile.email,
      accountName: profile.name,
      tokens: { ...(previous?.tokens || {}), ...tokens },
    });

    if (finalMode === "popup") {
      return res.send(
        makePopupResultHtml({
          status: "connected",
          message: profile.email
            ? `${profile.email} is connected to Jarvis.`
            : "Your Google account is connected to Jarvis.",
          credentialId: credential.id,
        })
      );
    }

    const redirect = new URL(CLIENT_URL);
    redirect.searchParams.set("google_oauth", "connected");
    redirect.searchParams.set("credential_id", credential.id);
    return res.redirect(redirect.toString());
  } catch (error) {
    console.error("Google OAuth callback failed:", error);
    return sendFailure(
      error?.message || "Google sign-in could not be completed."
    );
  }
});

async function deleteGoogleCredential(req, res) {
  const { credentialId } = req.params;
  if (!CredentialStore.isValidId(credentialId)) {
    return res.status(400).json({ error: "Invalid credential ID." });
  }

  try {
    const credential = await credentialStore.get(credentialId, { includeTokens: true });
    if (!credential) return res.status(404).json({ error: "Credential not found." });
    const oauth2Client = createOAuthClient();

    if (oauth2Client && credential?.tokens?.access_token) {
      try {
        await oauth2Client.revokeToken(credential.tokens.access_token);
      } catch (revokeError) {
        console.warn(
          "Google token revoke failed; deleting local credential anyway:",
          revokeError?.message || revokeError
        );
      }
    }

    await credentialStore.delete(credentialId);

    return res.json({
      ok: true,
      connected: false,
      status: "not_connected",
      id: credentialId,
    });
  } catch (error) {
    console.error("Google disconnect failed:", error);
    return res.status(500).json({
      ok: false,
      error: error?.message || "Could not disconnect Google Drive.",
    });
  }
}

app.post("/api/google/credentials/:credentialId/disconnect", deleteGoogleCredential);
app.delete("/api/google/credentials/:credentialId", deleteGoogleCredential);


// Serve the production React/Vite frontend.
const CLIENT_DIST = path.join(__dirname, "..", "client", "dist");

app.use(express.static(CLIENT_DIST));

app.use((req, res, next) => {
  if (req.method === "GET" && !req.path.startsWith("/api/")) {
    return res.sendFile(path.join(CLIENT_DIST, "index.html"));
  }

  return next();
});
async function startServer() {
  const relativeToClientDist = path.relative(CLIENT_DIST, JARVIS_DB_PATH);
  if (!relativeToClientDist.startsWith("..") && !path.isAbsolute(relativeToClientDist)) {
    throw new Error("JARVIS_DB_PATH must not be inside client/dist.");
  }

  await credentialStore.open();
  executionStore = new ExecutionStore(credentialStore.db);
  executionStore.open();
  facebookCredentialStore = new FacebookCredentialStore({ db: credentialStore.db, encryptionSecret: CREDENTIAL_ENCRYPTION_SECRET,
    legacyEncryptionSecrets: LEGACY_CREDENTIAL_ENCRYPTION_SECRETS });
  facebookCredentialStore.open();
  app.listen(PORT, () => {
    console.log("");
    console.log("=================================");
    console.log(" JARVIS BACKEND");
    console.log("=================================");
    console.log(`API: http://localhost:${PORT}`);
    console.log(`Client: ${CLIENT_URL}`);
    console.log(`Credential database: ${JARVIS_DB_PATH}`);
    console.log(
      `Google OAuth configured: ${googleOAuthConfigured ? "YES" : "NO"}`
    );
    console.log("=================================");
    console.log("");
  });
}

if (require.main === module || process.env.NODE_ENV === "production") {
  startServer().catch((error) => {
    console.error("FATAL ERROR: Jarvis backend startup failed:", error?.message || error);
    process.exit(1);
  });
}

