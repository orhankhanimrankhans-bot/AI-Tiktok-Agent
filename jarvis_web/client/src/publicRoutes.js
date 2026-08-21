export function resolvePublicPage(pathname) {
  const normalizedPath = String(pathname || "/")
    .replace(/\/{2,}/g, "/")
    .replace(/\/$/, "") || "/";

  return normalizedPath === "/privacy-policy" ? "privacy-policy" : null;
}
