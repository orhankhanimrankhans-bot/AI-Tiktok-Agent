function makePopupResultHtml({ status, message = "", credentialId = null, clientUrl }) {
  const payload = JSON.stringify({
    type: "jarvis-google-oauth",
    status,
    message,
    credentialId,
  }).replace(/</g, "\\u003c");
  const targetOrigin = JSON.stringify(new URL(clientUrl).origin);

  return `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Jarvis Google Connection</title><meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: Arial, sans-serif; color: #e9f6f8; background: #101719; }.card { width: min(88vw, 420px); padding: 26px; text-align: center; border: 1px solid #35545a; border-radius: 12px; background: #172326; }h2 { margin: 0 0 10px; }p { margin: 0; color: #b9c8cc; line-height: 1.5; }</style>
  </head>
  <body>
    <div class="card"><h2>${status === "connected" ? "Google account connected" : "Google sign-in not completed"}</h2><p>${message || (status === "connected" ? "Returning to Jarvis…" : "You can close this window.")}</p></div>
    <script>
      (function () {
        const payload = ${payload};
        const targetOrigin = ${targetOrigin};
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(payload, targetOrigin);
          window.setTimeout(() => window.close(), 450);
          return;
        }
        const fallback = new URL(${JSON.stringify(clientUrl)});
        fallback.searchParams.set("google_oauth", payload.status === "connected" ? "connected" : "error");
        if (payload.credentialId) fallback.searchParams.set("credential_id", payload.credentialId);
        window.location.replace(fallback.toString());
      })();
    </script>
  </body>
</html>`;
}

module.exports = { makePopupResultHtml };
