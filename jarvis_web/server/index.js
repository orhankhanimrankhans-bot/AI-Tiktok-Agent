const express = require("express");
const path = require("path");
const cors = require("cors");
const dotenv = require("dotenv");
const session = require("express-session");
const crypto = require("crypto");
const { google } = require("googleapis");

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

const app = express();

const PORT = Number(process.env.PORT || 3001);
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const GOOGLE_REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI ||
  `http://localhost:${PORT}/api/google/auth/callback`;

const googleOAuthConfigured = Boolean(
  GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REDIRECT_URI
);

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

// Development-only in-memory credential store.
// Tokens are lost when the server restarts.
// Replace this with encrypted persistent storage (database) before production.
const GOOGLE_CREDENTIAL_ID = "google_drive_main";
const googleCredentialStore = new Map();

function createOAuthClient() {
  if (!googleOAuthConfigured) return null;

  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );
}

function getStoredGoogleCredential() {
  return googleCredentialStore.get(GOOGLE_CREDENTIAL_ID) || null;
}

function makePopupResultHtml({ status, message = "" }) {
  const payload = JSON.stringify({
    type: "jarvis-google-oauth",
    status,
    message,
  }).replace(/</g, "\\u003c");

  const targetOrigin = JSON.stringify(new URL(CLIENT_URL).origin);

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Jarvis Google Connection</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        font-family: Arial, sans-serif;
        color: #e9f6f8;
        background: #101719;
      }
      .card {
        width: min(88vw, 420px);
        padding: 26px;
        text-align: center;
        border: 1px solid #35545a;
        border-radius: 12px;
        background: #172326;
      }
      h2 { margin: 0 0 10px; }
      p { margin: 0; color: #b9c8cc; line-height: 1.5; }
    </style>
  </head>
  <body>
    <div class="card">
      <h2>${status === "connected" ? "Google account connected" : "Google sign-in not completed"}</h2>
      <p>${message || (status === "connected" ? "Returning to Jarvis…" : "You can close this window.")}</p>
    </div>
    <script>
      (function () {
        const payload = ${payload};
        const targetOrigin = ${targetOrigin};

        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(payload, targetOrigin);
          window.setTimeout(() => window.close(), 450);
          return;
        }

        const fallback = new URL(${JSON.stringify(CLIENT_URL)});
        fallback.searchParams.set(
          "google_oauth",
          payload.status === "connected" ? "connected" : "error"
        );
        window.location.replace(fallback.toString());
      })();
    </script>
  </body>
</html>`;
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    googleOAuthConfigured,
  });
});

app.get("/api/google/credential/status", (req, res) => {
  const credential = getStoredGoogleCredential();

  res.json({
    id: GOOGLE_CREDENTIAL_ID,
    name: "Google Drive account",
    connected: Boolean(credential?.tokens?.access_token),
    status: credential?.tokens?.access_token ? "connected" : "not_connected",
    accountEmail: credential?.profile?.email || "",
    accountName: credential?.profile?.name || "",
  });
});

app.get("/api/google/auth/start", (req, res) => {
  const oauth2Client = createOAuthClient();

  if (!oauth2Client) {
    return res.status(503).json({
      status: "not_configured",
      message: "Google OAuth environment variables are not configured.",
    });
  }

  const state = crypto.randomBytes(24).toString("hex");

  req.session.googleOAuthState = state;
  req.session.googleOAuthMode = req.query.mode === "popup" ? "popup" : "redirect";

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
      state,
    });

    return res.redirect(authorizationUrl);
  });
});

app.get("/api/google/auth/callback", async (req, res) => {
  const mode = req.session.googleOAuthMode || "redirect";
  const expectedState = req.session.googleOAuthState;

  delete req.session.googleOAuthState;
  delete req.session.googleOAuthMode;

  const sendFailure = (message) => {
    if (mode === "popup") {
      return res.status(400).send(
        makePopupResultHtml({
          status: "error",
          message,
        })
      );
    }

    const redirect = new URL(CLIENT_URL);
    redirect.searchParams.set("google_oauth", "error");
    return res.redirect(redirect.toString());
  };

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

    if (!expectedState || req.query.state !== expectedState) {
      return sendFailure("OAuth state validation failed.");
    }

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

    googleCredentialStore.set(GOOGLE_CREDENTIAL_ID, {
      id: GOOGLE_CREDENTIAL_ID,
      provider: "google-drive",
      type: "oauth2",
      tokens,
      profile,
      updatedAt: new Date().toISOString(),
    });

    if (mode === "popup") {
      return res.send(
        makePopupResultHtml({
          status: "connected",
          message: profile.email
            ? `${profile.email} is connected to Jarvis.`
            : "Your Google account is connected to Jarvis.",
        })
      );
    }

    const redirect = new URL(CLIENT_URL);
    redirect.searchParams.set("google_oauth", "connected");
    return res.redirect(redirect.toString());
  } catch (error) {
    console.error("Google OAuth callback failed:", error);
    return sendFailure(
      error?.message || "Google sign-in could not be completed."
    );
  }
});

app.post("/api/google/auth/disconnect", async (req, res) => {
  const credential = getStoredGoogleCredential();

  try {
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

    googleCredentialStore.delete(GOOGLE_CREDENTIAL_ID);

    return res.json({
      ok: true,
      connected: false,
      status: "not_connected",
    });
  } catch (error) {
    console.error("Google disconnect failed:", error);
    return res.status(500).json({
      ok: false,
      error: error?.message || "Could not disconnect Google Drive.",
    });
  }
});


// Serve the production React/Vite frontend.
const CLIENT_DIST = path.join(__dirname, "..", "client", "dist");

app.use(express.static(CLIENT_DIST));

app.use((req, res, next) => {
  if (req.method === "GET" && !req.path.startsWith("/api/")) {
    return res.sendFile(path.join(CLIENT_DIST, "index.html"));
  }

  return next();
});
app.listen(PORT, () => {
  console.log("");
  console.log("=================================");
  console.log(" JARVIS BACKEND");
  console.log("=================================");
  console.log(`API: http://localhost:${PORT}`);
  console.log(`Client: ${CLIENT_URL}`);
  console.log(
    `Google OAuth configured: ${googleOAuthConfigured ? "YES" : "NO"}`
  );
  console.log("=================================");
  console.log("");
});


