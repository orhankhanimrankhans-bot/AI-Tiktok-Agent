export function isTikTokOAuthMessage(event, popup, origin) {
  return Boolean(popup && event.source === popup && event.origin === origin &&
    event.data?.type === "corex-tiktok-oauth" && ["connected", "failed"].includes(event.data.status));
}

export function returnTikTokPopup(win, status) {
  if (!["connected", "failed"].includes(status) || !win.opener || win.opener.closed) return false;
  try {
    win.opener.postMessage({ type: "corex-tiktok-oauth", status }, win.location.origin);
    win.setTimeout(() => win.close(), 300);
    return true;
  } catch { return false; }
}
