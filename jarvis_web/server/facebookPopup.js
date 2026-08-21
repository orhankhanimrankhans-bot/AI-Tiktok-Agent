function makeFacebookPopupHtml({ status, message = "", credentialId = null, clientUrl }) {
  const payload = JSON.stringify({ type: "jarvis-facebook-oauth", status, message, credentialId }).replace(/</g, "\\u003c");
  const origin = JSON.stringify(new URL(clientUrl).origin);
  const safeMessage = String(message).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Jarvis Meta Connection</title></head><body style="background:#101719;color:#e9f6f8;font-family:Arial;display:grid;place-items:center;min-height:100vh"><main><h2>${status === "connected" ? "Meta account connected" : "Meta sign-in not completed"}</h2><p>${safeMessage}</p></main><script>(function(){const payload=${payload};if(window.opener&&!window.opener.closed){window.opener.postMessage(payload,${origin});setTimeout(()=>window.close(),450);return;}const url=new URL(${JSON.stringify(clientUrl)});url.searchParams.set('facebook_oauth',payload.status==='connected'?'connected':'error');if(payload.credentialId)url.searchParams.set('facebook_credential_id',payload.credentialId);window.location.replace(url.toString());})();</script></body></html>`;
}
module.exports = { makeFacebookPopupHtml };
