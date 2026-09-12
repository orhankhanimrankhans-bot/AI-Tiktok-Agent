"use strict";

const ALLOWED_FACEBOOK_HOSTS = new Set(["facebook.com", "www.facebook.com", "m.facebook.com", "mbasic.facebook.com", "mobile.facebook.com", "web.facebook.com"]);
const DEFAULT_SCAN_DEPTH = 10;
const DEFAULT_TIMEOUT_MS = 12000;
const SUCCESS_STATUSES = new Set([200, 201, 202]);

class FacebookPublicMetricsError extends Error {
  constructor(code, message, statusCode = 400) { super(message); this.code = code; this.statusCode = statusCode; }
}

function decodeEntities(value = "") {
  return String(value)
    .replace(/\\u0025/g, "%")
    .replace(/\\u0026/g, "&")
    .replace(/\\\//g, "/")
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

function publicText(html = "") {
  const meta = [...String(html).matchAll(/<meta[^>]+content=["']([^"']+)["'][^>]*>/gi)].map((match) => match[1]).join(" ");
  const aria = [...String(html).matchAll(/(?:aria-label|title)=["']([^"']+)["']/gi)].map((match) => match[1]).join(" ");
  const jsonish = String(html).replace(/\\n/g, " ").replace(/\\"/g, '"');
  return `${stripHtml(html)} ${decodeEntities(meta)} ${decodeEntities(aria)} ${decodeEntities(jsonish)}`.replace(/\s+/g, " ");
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
  parsed.protocol = "https:"; parsed.hash = "";
  return parsed.toString();
}

function facebookUrlVariant(original, host, suffix = "") {
  const url = new URL(original);
  url.hostname = host;
  url.protocol = "https:";
  url.hash = "";
  if (suffix) {
    const base = url.pathname.replace(/\/+$/, "");
    url.pathname = `${base}/${suffix}`.replace(/\/+/g, "/");
  }
  return url.toString();
}

function scanUrlsForPage(page, pageUrl) {
  const urls = new Set([pageUrl]);
  for (const host of ["m.facebook.com", "mbasic.facebook.com", "mobile.facebook.com", "www.facebook.com"]) {
    urls.add(facebookUrlVariant(pageUrl, host));
    for (const suffix of ["about", "posts", "reels", "videos"]) urls.add(facebookUrlVariant(pageUrl, host, suffix));
  }
  const pageId = String(page?.pageId || page?.page_id || "").trim();
  if (/^\d{5,}$/.test(pageId)) {
    for (const host of ["www.facebook.com", "m.facebook.com", "mbasic.facebook.com"]) {
      urls.add(`https://${host}/profile.php?id=${encodeURIComponent(pageId)}`);
      urls.add(`https://${host}/profile.php?id=${encodeURIComponent(pageId)}&sk=about`);
      urls.add(`https://${host}/profile.php?id=${encodeURIComponent(pageId)}&sk=videos`);
    }
  }
  return [...urls].map(normalizeFacebookUrl);
}

function extractMeta(html, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>|<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i");
  const match = html.match(regex);
  return decodeEntities(match?.[1] || match?.[2] || "").trim();
}

function extractPageName(html, fallback = "") {
  const candidates = [extractMeta(html, "og:title"), extractMeta(html, "twitter:title"), html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]]
    .filter(Boolean).map((value) => decodeEntities(value).replace(/\s*\|\s*Facebook.*$/i, "").replace(/\s*-\s*Facebook.*$/i, "").trim()).filter(Boolean);
  return candidates[0] || fallback || "";
}
function extractPagePicture(html) { return extractMeta(html, "og:image") || extractMeta(html, "twitter:image") || ""; }

function bestCount(candidates) {
  const parsed = candidates.map((raw) => ({ raw: String(raw || "").trim(), count: parseSocialCount(raw) })).filter((item) => item.raw && item.count !== null);
  if (!parsed.length) return null;
  parsed.sort((a, b) => String(b.count).length - String(a.count).length || b.count - a.count);
  return parsed[0];
}

function extractFollowerCount(html) {
  const text = publicText(html);
  const candidates = [];
  for (const pattern of [
    /"(?:followers_count|followersCount|subscriber_count|subscriberCount|page_followers)"\s*:?\s*"?([0-9][0-9,\.]*\s*[KMB]?)"?/gi,
    /([0-9][0-9,\.]*\s*[KMB]?)\s+(?:followers|people follow this page|people follow this)/gi,
    /(?:followers|people follow this page|people follow this)\D{0,80}([0-9][0-9,\.]*\s*[KMB]?)/gi,
  ]) {
    let match;
    while ((match = pattern.exec(text))) candidates.push(match[1]);
  }
  const chosen = bestCount(candidates);
  return chosen ? { count: chosen.count, display: chosen.raw, source: "public_text" } : { count: null, display: null, source: null };
}

function uniqueCounts(html, regex, limit) {
  const found = []; const seen = new Set(); let match;
  while ((match = regex.exec(html)) && found.length < limit) {
    const display = decodeEntities(match[1]).trim(); const count = parseSocialCount(display);
    if (count === null) continue;
    const key = `${count}:${display.toLowerCase()}`; if (seen.has(key)) continue;
    seen.add(key); found.push({ count, display });
  }
  return found;
}
function extractVideoViews(html, depth = DEFAULT_SCAN_DEPTH) {
  const counts = uniqueCounts(publicText(html), /([0-9][0-9,\.]*\s*[KMB]?)\s+(?:views|plays|video views|reel views)/gi, depth);
  return { total: counts.reduce((sum, item) => sum + item.count, 0), sampled: counts.length, samples: counts };
}
function extractRecentPosts(html, depth = DEFAULT_SCAN_DEPTH) {
  const patterns = [/\/posts\/([A-Za-z0-9_.:-]+)/gi, /story_fbid[=:]([A-Za-z0-9_.:-]+)/gi, /\/reel\/([A-Za-z0-9_.:-]+)/gi, /\/videos\/([A-Za-z0-9_.:-]+)/gi, /"post_id"\s*:?\s*"?([A-Za-z0-9_.:-]+)/gi];
  const ids = new Set();
  for (const pattern of patterns) { let match; while ((match = pattern.exec(html)) && ids.size < depth) ids.add(match[1]); }
  return { count: ids.size || null, type: ids.size ? "recent-public-sample" : null, window: ids.size ? `latest-${depth}-public-items` : null };
}
function hasAnyMetric(scan) { return scan.followersCount !== null || scan.recentViewsTotal !== null || scan.postsCount !== null; }

async function fetchWithTimeout(fetchImpl, url, timeoutMs) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetchImpl(url, { redirect: "follow", signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 COREX-PublicMetrics/1.1", "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9" } }); }
  finally { clearTimeout(timer); }
}

function mergeHtmlScan(scan, html, sourceUrl, depth, page) {
  const followers = extractFollowerCount(html);
  const views = extractVideoViews(html, depth);
  const posts = extractRecentPosts(html, depth);
  scan.pageName ||= extractPageName(html, page?.pageName || page?.page_name || "");
  scan.pagePictureUrl ||= extractPagePicture(html);
  if (scan.followersCount === null && followers.count !== null) { scan.followersCount = followers.count; scan.followersDisplay = followers.display; scan.followersSource = `${followers.source}:${new URL(sourceUrl).hostname}`; }
  if (scan.recentViewsTotal === null && views.sampled) { scan.recentViewsTotal = views.total; scan.videosSampled = views.sampled; }
  if (scan.postsCount === null && posts.count) { scan.postsCount = posts.count; scan.postsCountType = posts.type; scan.postsWindow = posts.window; }
}

function createFacebookPublicMetricsService({ fetchImpl = globalThis.fetch, now = () => new Date().toISOString(), scanDepth = DEFAULT_SCAN_DEPTH, timeoutMs = DEFAULT_TIMEOUT_MS, logger = console } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("fetch implementation is required");
  const depth = Math.max(1, Math.min(20, Number(scanDepth) || DEFAULT_SCAN_DEPTH));
  return Object.freeze({
    async scanPage(page) {
      const pageUrl = normalizeFacebookUrl(page?.pageUrl || page?.page_url);
      const urls = scanUrlsForPage(page, pageUrl);
      logger?.info?.("Facebook public scan started", { pageRecordId: page?.id, scanDepth: depth, variants: urls.length });
      const scan = { status: "metric_unavailable", message: "Public metrics are unavailable from the current Facebook page response.", pageUrl, pageName: page?.pageName || page?.page_name || "", pagePictureUrl: "", followersCount: null, followersDisplay: null, followersSource: null, recentViewsTotal: null, videosSampled: 0, postsCount: null, postsCountType: null, postsWindow: null, scanDepth: depth, source: "public_http_fetch", capturedAt: now() };
      let sawSuccess = false; let lastFailure = null;
      for (const url of urls) {
        let response;
        try { response = await fetchWithTimeout(fetchImpl, url, timeoutMs); } catch (error) { lastFailure = error?.name === "AbortError" ? "Facebook public scan timed out; retrying later." : "Facebook public scan failed; retrying later."; continue; }
        if (!SUCCESS_STATUSES.has(response.status)) { lastFailure = response.status === 404 ? "Facebook Page not found." : response.status === 401 || response.status === 403 || response.status === 429 ? "Facebook temporarily blocked public scan." : "Facebook public scan did not return a readable page."; continue; }
        sawSuccess = true;
        const finalUrl = normalizeFacebookUrl(response.url || url);
        const html = await response.text();
        mergeHtmlScan(scan, html, finalUrl, depth, page);
        if (scan.followersCount !== null && scan.recentViewsTotal !== null && scan.postsCount !== null) break;
      }
      if (!sawSuccess) {
        return { ...scan, status: lastFailure === "Facebook Page not found." ? "page_not_found" : lastFailure === "Facebook temporarily blocked public scan." ? "temporarily_blocked" : "scan_failed", message: lastFailure || "Facebook public scan failed; retrying later." };
      }
      if (hasAnyMetric(scan)) {
        scan.status = scan.followersCount !== null && (scan.recentViewsTotal !== null || scan.postsCount !== null) ? "synced" : "partial";
        scan.message = `Public scan collected ${[scan.followersCount !== null ? "followers" : null, scan.recentViewsTotal !== null ? "views" : null, scan.postsCount !== null ? "posts" : null].filter(Boolean).join(", ")}.`;
      }
      logger?.info?.("Facebook public scan completed", { pageRecordId: page?.id, status: scan.status, videosSampled: scan.videosSampled });
      return scan;
    },
  });
}

module.exports = { FacebookPublicMetricsError, createFacebookPublicMetricsService, decodeEntities, extractFollowerCount, extractPageName, extractPagePicture, extractRecentPosts, extractVideoViews, normalizeFacebookUrl, parseSocialCount, scanUrlsForPage };
