export function resolvePublicPage(pathname) {
  const normalizedPath = String(pathname || "/")
    .replace(/\/{2,}/g, "/")
    .replace(/\/$/, "") || "/";

  if (normalizedPath === "/privacy-policy") return "privacy-policy";
  if (normalizedPath === "/terms") return "terms";
  if (normalizedPath === "/data-deletion") return "data-deletion";
  return null;
}
