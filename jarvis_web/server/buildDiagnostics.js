"use strict";
const fs = require("node:fs");
const path = require("node:path");
const build = require("../shared/buildVersion.json");

function createBuildDiagnostics(clientDist, environment) {
  // Capture the backend release at process initialization, not from environment variables.
  const version = build.version;
  const serverStartedAt = new Date().toISOString();
  return () => {
    let clientBuild = "unavailable";
    try {
      const html = fs.readFileSync(path.join(clientDist, "index.html"), "utf8");
      const marker = html.match(/<meta\s+name="corex-build"\s+content="([A-Za-z0-9._-]{1,80})"\s*\/?\s*>/);
      const metadata = JSON.parse(fs.readFileSync(path.join(clientDist, "build.json"), "utf8"));
      if (marker && marker[1] === metadata.version) clientBuild = marker[1];
    } catch { /* Missing or inconsistent artifacts must not claim the backend's version. */ }
    return { version, environment: environment === "production" ? "production" : "development", serverStartedAt, clientBuild, metaSetupVersion: build.metaSetupVersion };
  };
}

function metaConfigDiagnostics(config, credentials) {
  const configured = config.configured === true;
  // Existing owned tokens remain usable independently of new-connection App setup.
  const connected = credentials.some(value => value.connectionStatus === "connected");
  return {
    configured,
    connectionStatus: connected ? "connected" : credentials.length ? "reconnect_required" : "not_connected",
    mode: "user_managed",
    hasAppId: configured && Boolean(config.appId),
    hasAppSecret: configured && config.secretConfigured === true,
  };
}

module.exports = { createBuildDiagnostics, metaConfigDiagnostics };
