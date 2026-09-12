"use strict";

const ALLOWED_FACEBOOK_HOSTS = new Set(["facebook.com", "www.facebook.com", "m.facebook.com", "web.facebook.com"]);
const DEFAULT_SCAN_DEPTH = 10;
const DEFAULT_TIMEOUT_MS = 12000;

class FacebookPublicMetricsError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

function decodeEntities(value = "") {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number.parseInt(number, 10)));
}

function stripHtml(value = "") {
  return decodeEntities(String(value).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function parseSocialCount(value) {
  const text = decodeEntities(String(value || "")).trim().replace(/\s+/g, " ");
  const match = text.match(/([0-9]+(?:[,.][0-9]+)?)(?:\s*([KMB]))?/i);
  if (!match) return null;
  const suffix = (match[2] || "").toUpperCase();
  let numeric = match[1].replace(/,/g, "");
  if (!suffix && /^\d{1,3}(\.\d{3})+$/.test(match[1])) numeric = match[1].replace(/\./g, "");
  const base = Number.parseFloat(numeric);
  if (!Number.isFinite(base)) return null;
  const multiplier = suffix === "K" ? 1_000 : suffix === "M" ? 1_000_000 : suffix === "B" ? 1_000_000_000 : 1;
  return Math.round(base * multiplier);
}

function normalizeFacebookUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) throw new FacebookPublicMetricsError("INVALID_FACEBOOK_URL", "Facebook Page URL is required.");
  let parsed;
  try { parsed = new URL(raw.includes("://") ? raw : `https://${raw}`); } catch { throw new FacebookPublicMetricsError("INVALID_FACEBOOK_URL", "Invalid Facebook URL."); }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new FacebookPublicMetricsError("INVALID_FACEBOOK_URL", "Only public HTTP Facebook URLs are supported.");
  if (parsed.username || parsed.password) throw new FacebookPublicMetricsError("INVALID_FACEBOOK_URL", "Facebook URL credentials are not allowed.");
  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_FACEBOOK_HOSTS.has(host)) throw new FacebookPublicMetricsError("INVALID_FACEBOOK_URL", "Only public facebook.com page URLs are supported.");
  parsed.protocol = "https:";
  parsed.hash = "";
  return parsed.toString();
}

function extractMeta(html, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>|<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i");
  const match = html.match(regex);
  return decodeEntities(match?.[1] || match?.[2] || "").trim();
}

function extractPageName(html, fallback = "") {
  const candidates = [
    extractMeta(html, "og:title"),
    extractMeta(html, "twitter:title"),
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1],
  ].filter(Boolean).map((value) => decodeEntities(value).replace(/\s*\|\s*Facebook.*$/i, "").replace(/\s*-\s*Facebook.*$/i, "").trim()).filter(Boolean);
  return candidates[0] || fallback || "";
}

function extractPagePicture(html) {
  return extractMeta(html, "og:image") || extractMeta(html, "twitter:image") || "";
}

function extractFollowerCount(html) {
  const text = stripHtml(html);
  const structured = html.match(/"(?:followers_count|followersCount|subscriber_count|subscriberCount)"\s*:?\s*"?([0-9][0-9,\.]*\s*[KMB]?)"?/i);
  const patterns = [
    /([0-9][0-9,\.]*\s*[KMB]?)\s+(?:followers|people follow this)/i,
    /(?:followers|people follow this)\D{0,40}([0-9][0-9,\.]*\s*[KMB]?)/i,
  ];
  const raw = structured?.[1] || patterns.map((pattern) => text.match(pattern)?.[1]).find(Boolean);
  const count = parseSocialCount(raw);
  return count === null ? { count: null, display: null, source: null } : { count, display: String(raw).trim(), source: structured ? "public_structured" : "public_text" };
}

function uniqueCounts(html, regex, limit) {
  const found = [];
  const seen = new Set();
  let match;
  while ((match = regex.exec(html)) && found.length < limit) {
    const display = decodeEntities(match[1]).trim();
    const count = parseSocialCount(display);
    if (count === null) continue;
    const key = `${count}:${display.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ count, display });
  }
  return found;
}

function extractVideoViews(html, depth = DEFAULT_SCAN_DEPTH) {
  const text = stripHtml(html);
  const counts = uniqueCounts(text, /([0-9][0-9,\.]*\s*[KMB]?)\s+(?:views|plays)/gi, depth);
  return { total: counts.reduce((sum, item) => sum + item.count, 0), sampled: counts.length, samples: counts };
}

function extractRecentPosts(html, depth = DEFAULT_SCAN_DEPTH) {
  const patterns = [/\/posts\/([A-Za-z0-9_.:-]+)/gi, /story_fbid[=:]([A-Za-z0-9_.:-]+)/gi, /\/reel\/([A-Za-z0-9_.:-]+)/gi, /\/videos\/([A-Za-z0-9_.:-]+)/gi];
  const ids = new Set();
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) && ids.size < depth) ids.add(match[1]);
  }
  return { count: ids.size || null, type: ids.size ? "recent-public-sample" : null, window: ids.size ? `latest-${depth}-public-items` : null };
}

function hasAnyMetric(scan) {
  return scan.followersCount !== null || scan.recentViewsTotal !== null || scan.postsCount !== null;
}

async function fetchWithTimeout(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { redirect: "follow", signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0 COREX-PublicMetrics/1.0", "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9" } });
  } finally {
    clearTimeout(timer);
  }
}

function createFacebookPublicMetricsService({ fetchImpl = globalThis.fetch, now = () => new Date().toISOString(), scanDepth = DEFAULT_SCAN_DEPTH, timeoutMs = DEFAULT_TIMEOUT_MS, logger = console } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("fetch implementation is required");
  const depth = Math.max(1, Math.min(20, Number(scanDepth) || DEFAULT_SCAN_DEPTH));
  return Object.freeze({
    async scanPage(page) {
      const pageUrl = normalizeFacebookUrl(page?.pageUrl || page?.page_url);
      logger?.info?.("Facebook public scan started", { pageRecordId: page?.id, scanDepth: depth });
      let response;
      try { response = await fetchWithTimeout(fetchImpl, pageUrl, timeoutMs); } catch (error) { return { status: error?.name === "AbortError" ? "temporarily_blocked" : "scan_failed", message: error?.name === "AbortError" ? "Facebook public scan timed out; retrying later." : "Facebook public scan failed; retrying later.", pageUrl, capturedAt: now(), source: "public_http_fetch" }; }
      if (![200, 201, 202].includes(response.status)) {
        const status = response.status === 404 ? "page_not_found" : response.status === 401 || response.status === 403 || response.status === 429 ? "temporarily_blocked" : "scan_failed";
        const message = status === "page_not_found" ? "Facebook Page not found." : status === "temporarily_blocked" ? "Facebook temporarily blocked public scan." : "Facebook public scan did not return a readable page.";
        return { status, message, pageUrl, capturedAt: now(), source: "public_http_fetch" };
      }
      const finalUrl = normalizeFacebookUrl(response.url || pageUrl);
      const html = await response.text();
      const followers = extractFollowerCount(html);
      const views = extractVideoViews(html, depth);
      const posts = extractRecentPosts(html, depth);
      const scan = {
        status: "metric_unavailable",
        message: "Public metrics are unavailable from the current Facebook page response.",
        pageUrl: finalUrl,
        pageName: extractPageName(html, page?.pageName || page?.page_name || ""),
        pagePictureUrl: extractPagePicture(html),
        followersCount: followers.count,
        followersDisplay: followers.display,
        followersSource: followers.source,
        recentViewsTotal: views.sampled ? views.total : null,
        videosSampled: views.sampled,
        postsCount: posts.count,
        postsCountType: posts.type,
        postsWindow: posts.window,
        scanDepth: depth,
        source: "public_http_fetch",
        capturedAt: now(),
      };
      if (hasAnyMetric(scan)) {
        scan.status = scan.followersCount !== null && (scan.recentViewsTotal !== null || scan.postsCount !== null) ? "synced" : "partial";
        scan.message = `Public scan collected ${[scan.followersCount !== null ? "followers" : null, scan.recentViewsTotal !== null ? "views" : null, scan.postsCount !== null ? "posts" : null].filter(Boolean).join(", ")}.`;
      }
      logger?.info?.("Facebook public scan completed", { pageRecordId: page?.id, status: scan.status, videosSampled: scan.videosSampled });
      return scan;
    },
  });
}

module.exports = { FacebookPublicMetricsError, createFacebookPublicMetricsService, decodeEntities, extractFollowerCount, extractPageName, extractPagePicture, extractRecentPosts, extractVideoViews, normalizeFacebookUrl, parseSocialCount };
