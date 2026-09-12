"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const ALLOWED_FACEBOOK_HOSTS = new Set(["facebook.com", "www.facebook.com", "m.facebook.com", "mbasic.facebook.com", "mobile.facebook.com", "web.facebook.com"]);
const DEFAULT_SCAN_DEPTH = 10;
const DEFAULT_TIMEOUT_MS = 12000;
const MAX_REASONABLE_PUBLIC_COUNT = 2_500_000_000;
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
  const count = Math.round(base * multiplier);
  return count > MAX_REASONABLE_PUBLIC_COUNT ? null : count;
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

function bestCount(candidates, { excludedCounts = new Set() } = {}) {
  const parsed = candidates
    .map((candidate) => ({ raw: String(candidate?.raw ?? candidate ?? "").trim(), count: parseSocialCount(candidate?.raw ?? candidate), source: candidate?.source || "public_text" }))
    .filter((item) => item.raw && item.count !== null && !excludedCounts.has(String(item.count)) && (item.count >= 10 || /[KMB]/i.test(item.raw)));
  if (!parsed.length) return null;
  parsed.sort((a, b) => String(b.count).length - String(a.count).length || b.count - a.count);
  return parsed[0];
}

function pageIdExclusions(page = {}) {
  const values = [page?.pageId, page?.page_id, page?.id]
    .map((value) => String(value || "").trim())
    .filter((value) => /^\d{5,}$/.test(value));
  return new Set(values);
}

function extractFollowerCount(html, page = {}) {
  const text = publicText(html);
  const candidates = [];
  for (const pattern of [
    /"(?:followers_count|followersCount|subscriber_count|subscriberCount|page_followers)"\s*:?\s*"?([0-9][0-9,\.]*\s*[KMB]?)"?/gi,
    /([0-9][0-9,\.]*\s*[KMB]?)\s+(?:followers|followers\s*?|people follow this page|people follow this)/gi,
    /(?:followers|followers\s*?|people follow this page|people follow this)\D{0,40}([0-9][0-9,\.]*\s*[KMB]?)/gi,
  ]) {
    let match;
    while ((match = pattern.exec(text))) candidates.push({ raw: match[1], source: "public_text" });
  }
  const chosen = bestCount(candidates, { excludedCounts: pageIdExclusions(page) });
  return chosen ? { count: chosen.count, display: chosen.raw, source: chosen.source } : { count: null, display: null, source: null };
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

function uniqueStructuredCounts(html, regex, limit) {
  const found = []; const seen = new Set(); let match;
  while ((match = regex.exec(html)) && found.length < limit) {
    const raw = decodeEntities(match[1] || match[2] || "").trim();
    const count = parseSocialCount(raw);
    if (count === null) continue;
    const key = `${count}:${raw.toLowerCase()}`; if (seen.has(key)) continue;
    seen.add(key); found.push({ count, display: raw });
  }
  return found;
}

function extractVideoViews(html, depth = DEFAULT_SCAN_DEPTH) {
  const text = publicText(html);
  const explicitCounts = uniqueCounts(text, /([0-9][0-9,\.]*\s*[KMB]?)\s+(?:views|plays|video views|reel views)/gi, depth);
  const structuredCounts = uniqueStructuredCounts(text, /"(?:play_count|playCount|view_count|viewCount|video_view_count|videoViewCount|total_video_views|totalVideoViews|views_count|viewsCount)"\s*:?\s*(?:\{[^{}]{0,80}?"(?:count|value)"\s*:?\s*)?"?([0-9][0-9,\.]*\s*[KMB]?)"?/gi, depth);
  const seen = new Set();
  const samples = [];
  for (const item of [...explicitCounts, ...structuredCounts]) {
    const key = `${item.count}:${item.display.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    samples.push(item);
    if (samples.length >= depth) break;
  }
  return { total: samples.reduce((sum, item) => sum + item.count, 0), sampled: samples.length, samples };
}

function normalizeFacebookTargetUrl(rawUrl, baseUrl) {
  const decoded = decodeEntities(String(rawUrl || "")).replace(/\\\//g, "/").trim();
  if (!decoded || /^(?:#|javascript:|mailto:)/i.test(decoded)) return null;
  try {
    const target = new URL(decoded, baseUrl || "https://www.facebook.com/");
    if (!ALLOWED_FACEBOOK_HOSTS.has(target.hostname.toLowerCase())) return null;
    target.protocol = "https:";
    target.hash = "";
    target.hostname = target.hostname.toLowerCase() === "mbasic.facebook.com" ? "m.facebook.com" : target.hostname;
    return normalizeFacebookUrl(target.toString());
  } catch { return null; }
}

function videoKeyForUrl(url) {
  try {
    const parsed = new URL(url);
    const text = decodeEntities(`${parsed.pathname}?${parsed.search}`);
    const direct = text.match(/\/(?:reel|videos)\/([A-Za-z0-9_.:-]{3,})/i) || text.match(/[?&]v=([A-Za-z0-9_.:-]{3,})/i);
    return direct?.[1] || parsed.toString();
  } catch { return String(url); }
}

function extractVideoTargets(html, baseUrl, depth = DEFAULT_SCAN_DEPTH) {
  const source = decodeEntities(String(html || "").replace(/\\\//g, "/"));
  const patterns = [
    /https?:\/\/(?:www\.|m\.|mobile\.|web\.)?facebook\.com\/(?:reel|watch|videos)[^\s"'<>\\]+/gi,
    /["']((?:\/[^"'<>\\]*)?(?:reel|watch|videos)(?:\/|\?v=)[^"'<>\\]+)["']/gi,
    /href=["']([^"']*(?:reel|watch|videos)(?:\/|\?v=)[^"']*)["']/gi,
  ];
  const targets = [];
  const seen = new Set();
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) && targets.length < depth) {
      const normalized = normalizeFacebookTargetUrl(match[1] || match[0], baseUrl);
      if (!normalized) continue;
      const key = videoKeyForUrl(normalized);
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push(normalized);
    }
  }
  return targets;
}

function extractRecentPosts(html, depth = DEFAULT_SCAN_DEPTH) {
  const patterns = [/\/posts\/([A-Za-z0-9_.:-]+)/gi, /story_fbid[=:]([A-Za-z0-9_.:-]+)/gi, /\/reel\/([A-Za-z0-9_.:-]+)/gi, /\/videos\/([A-Za-z0-9_.:-]+)/gi, /"post_id"\s*:?\s*"?([A-Za-z0-9_.:-]+)/gi];
  const ids = new Set();
  for (const pattern of patterns) { let match; while ((match = pattern.exec(html)) && ids.size < depth) ids.add(match[1]); }
  return { count: ids.size || null, type: ids.size ? "recent-public-sample" : null, window: ids.size ? `latest-${depth}-public-items` : null };
}
function hasAnyMetric(scan) { return scan.followersCount !== null || scan.recentViewsTotal !== null || scan.postsCount !== null; }

function safeUrlForLog(value) {
  try {
    const url = new URL(String(value || ""));
    for (const key of [...url.searchParams.keys()]) if (/token|secret|password|cookie|session/i.test(key)) url.searchParams.set(key, "[redacted]");
    return url.toString();
  } catch { return String(value || "").replace(/(token|secret|password|cookie|session)=([^&\s]+)/gi, "$1=[redacted]"); }
}

function detectChromiumRuntime() {
  const checks = [];
  for (const packageName of ["playwright", "puppeteer"]) {
    try { require.resolve(packageName); checks.push({ package: packageName, installed: true }); }
    catch { checks.push({ package: packageName, installed: false }); }
  }
  return { mode: "not_configured", launched: false, available: checks.some((item) => item.installed), checks, message: "Public scanner currently uses HTTP fetch. Playwright/Puppeteer Chromium rendering is not configured." };
}

function classifyFacebookResponse({ status, finalUrl, title, html }) {
  const url = String(finalUrl || "").toLowerCase();
  const text = publicText(html).slice(0, 20000);
  const cleanTitle = String(title || "").trim();
  if (status === 403) return "blocked_403";
  if (status === 429) return "rate_limited_429";
  if (status && status >= 400) return "http_error";
  if (/checkpoint/.test(url) || /checkpoint/i.test(cleanTitle) || /checkpoint/i.test(text)) return "checkpoint";
  if (/login(?:\.php)?/.test(url) || /log in to facebook|you must log in|login approval needed/i.test(cleanTitle) || (/log in to facebook/i.test(text) && !/followers|people follow this|posts|videos|reels/i.test(text))) return "login_wall";
  if (/temporarily blocked|too many requests|try again later|rate limit/i.test(text)) return "rate_limited_page";
  if (/followers|people follow this|posts|videos|reels|og:title|pagelet|profile_social_context|profile/i.test(text) || cleanTitle && !/^facebook$/i.test(cleanTitle)) return "public_page";
  if (!String(html || "").trim()) return "empty_response";
  if (stripHtml(html).length < 200 && /<script/i.test(String(html))) return "empty_javascript_shell";
  return "unknown";
}

function extractionSummary({ followers, posts, views }) {
  return {
    followersFound: followers.count !== null,
    followers: followers.count,
    followersDisplay: followers.display,
    postsFound: Boolean(posts.count),
    postsDetected: posts.count || 0,
    postsType: posts.type,
    viewsFound: Boolean(views.sampled),
    videosDetected: views.sampled,
    viewsDetected: views.sampled ? views.total : null,
  };
}

async function saveDiagnosticSnapshot({ snapshotDir, pageRecordId, finalUrl, html }) {
  if (!snapshotDir || !html) return null;
  await fs.mkdir(snapshotDir, { recursive: true });
  const safeId = String(pageRecordId || "facebook-page").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
  const snapshotPath = path.join(snapshotDir, `facebook-public-${safeId}-${Date.now()}.html`);
  const header = `<!-- COREX Facebook public scan diagnostic snapshot. URL: ${safeUrlForLog(finalUrl)} -->\n`;
  await fs.writeFile(snapshotPath, `${header}${html}`, "utf8");
  return snapshotPath;
}

async function fetchWithTimeout(fetchImpl, url, timeoutMs) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetchImpl(url, { redirect: "follow", signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 COREX-PublicMetrics/1.1", "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9" } }); }
  finally { clearTimeout(timer); }
}

function mergeHtmlScan(scan, html, sourceUrl, depth, page) {
  const followers = extractFollowerCount(html, page);
  const views = extractVideoViews(html, depth);
  const posts = extractRecentPosts(html, depth);
  scan.pageName ||= extractPageName(html, page?.pageName || page?.page_name || "");
  scan.pagePictureUrl ||= extractPagePicture(html);
  if (scan.followersCount === null && followers.count !== null) { scan.followersCount = followers.count; scan.followersDisplay = followers.display; scan.followersSource = `${followers.source}:${new URL(sourceUrl).hostname}`; }
  if (views.sampled && (scan.recentViewsTotal === null || views.total > scan.recentViewsTotal)) { scan.recentViewsTotal = views.total; scan.videosSampled = views.sampled; }
  if (posts.count && (scan.postsCount === null || posts.count > scan.postsCount)) { scan.postsCount = posts.count; scan.postsCountType = posts.type; scan.postsWindow = posts.window; }
}

function createFacebookPublicMetricsService({ fetchImpl = globalThis.fetch, now = () => new Date().toISOString(), scanDepth = DEFAULT_SCAN_DEPTH, timeoutMs = DEFAULT_TIMEOUT_MS, logger = console, snapshotDir = path.join(__dirname, "tmp-diagnostics") } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("fetch implementation is required");
  const depth = Math.max(1, Math.min(20, Number(scanDepth) || DEFAULT_SCAN_DEPTH));
  return Object.freeze({
    async scanPage(page, options = {}) {
      const pageUrl = normalizeFacebookUrl(page?.pageUrl || page?.page_url);
      const urls = scanUrlsForPage(page, pageUrl);
      const diagnostics = {
        pageRecordId: page?.id || null,
        pageUrl: safeUrlForLog(pageUrl),
        scanDepth: depth,
        variants: urls.length,
        browser: detectChromiumRuntime(),
        attempts: [],
        parserErrors: [],
        timeoutErrors: [],
        blockedResponses: [],
        snapshotPath: null,
        videoTargetsDetected: 0,
        videoTargetAttempts: [],
      };
      logger?.info?.("Facebook public scan started", { pageRecordId: page?.id, pageUrl: diagnostics.pageUrl, scanDepth: depth, variants: urls.length, browserMode: diagnostics.browser.mode });
      const scan = { status: "metric_unavailable", message: "Public metrics are unavailable from the current Facebook page response.", pageUrl, pageName: page?.pageName || page?.page_name || "", pagePictureUrl: "", followersCount: null, followersDisplay: null, followersSource: null, recentViewsTotal: null, videosSampled: 0, postsCount: null, postsCountType: null, postsWindow: null, scanDepth: depth, source: "public_http_fetch", capturedAt: now() };
      let sawSuccess = false; let lastFailure = null;
      const videoTargets = new Map();
      for (const url of urls) {
        const attempt = { url: safeUrlForLog(url), httpStatus: null, redirects: [], finalUrl: null, responseType: "not_started", browserLaunched: false, browserLaunchStatus: diagnostics.browser.message, pageTitle: "", contentLength: 0, extraction: null, parserErrors: [], timeoutError: null };
        let response;
        try { response = await fetchWithTimeout(fetchImpl, url, timeoutMs); }
        catch (error) {
          lastFailure = error?.name === "AbortError" ? "Facebook public scan timed out; retrying later." : "Facebook public scan failed; retrying later.";
          attempt.responseType = error?.name === "AbortError" ? "timeout" : "request_error";
          attempt.timeoutError = error?.name === "AbortError" ? { timeoutMs } : null;
          attempt.error = error?.message || String(error);
          if (attempt.timeoutError) diagnostics.timeoutErrors.push({ url: attempt.url, timeoutMs });
          diagnostics.attempts.push(attempt);
          logger?.warn?.("Facebook public scan request failed", { pageRecordId: page?.id, url: attempt.url, responseType: attempt.responseType, error: attempt.error });
          continue;
        }
        attempt.httpStatus = response.status;
        attempt.finalUrl = safeUrlForLog(response.url || url);
        if ((response.url || url) !== url) attempt.redirects.push({ from: safeUrlForLog(url), to: attempt.finalUrl });
        if (response.status === 403 || response.status === 429) diagnostics.blockedResponses.push({ url: attempt.url, httpStatus: response.status, finalUrl: attempt.finalUrl });
        let html = "";
        try { html = await response.text(); } catch (error) { attempt.parserErrors.push(`response_text:${error?.message || String(error)}`); diagnostics.parserErrors.push({ url: attempt.url, error: attempt.parserErrors.at(-1) }); }
        attempt.contentLength = html.length;
        attempt.pageTitle = extractPageName(html, "") || (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ? stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)[1]) : "");
        attempt.responseType = classifyFacebookResponse({ status: response.status, finalUrl: response.url || url, title: attempt.pageTitle, html });
        if (!diagnostics.snapshotPath && options.saveSnapshot) {
          try { diagnostics.snapshotPath = await saveDiagnosticSnapshot({ snapshotDir: options.snapshotDir || snapshotDir, pageRecordId: page?.id || page?.pageId, finalUrl: response.url || url, html }); }
          catch (error) { diagnostics.parserErrors.push({ url: attempt.url, error: `snapshot:${error?.message || String(error)}` }); }
        }
        let followers; let views; let posts;
        try { followers = extractFollowerCount(html, page); } catch (error) { followers = { count: null, display: null, source: null }; attempt.parserErrors.push(`followers:${error?.message || String(error)}`); }
        try { views = extractVideoViews(html, depth); } catch (error) { views = { total: null, sampled: 0, samples: [] }; attempt.parserErrors.push(`views:${error?.message || String(error)}`); }
        try { posts = extractRecentPosts(html, depth); } catch (error) { posts = { count: null, type: null, window: null }; attempt.parserErrors.push(`posts:${error?.message || String(error)}`); }
        try {
          for (const targetUrl of extractVideoTargets(html, response.url || url, depth)) {
            if (!videoTargets.has(videoKeyForUrl(targetUrl))) videoTargets.set(videoKeyForUrl(targetUrl), targetUrl);
          }
          diagnostics.videoTargetsDetected = videoTargets.size;
        } catch (error) { attempt.parserErrors.push(`video_targets:${error?.message || String(error)}`); }
        if (attempt.parserErrors.length) diagnostics.parserErrors.push({ url: attempt.url, errors: attempt.parserErrors });
        attempt.extraction = extractionSummary({ followers, posts, views });
        diagnostics.attempts.push(attempt);
        logger?.info?.("Facebook public scan attempt", { pageRecordId: page?.id, url: attempt.url, httpStatus: attempt.httpStatus, finalUrl: attempt.finalUrl, responseType: attempt.responseType, pageTitle: attempt.pageTitle, contentLength: attempt.contentLength, extraction: attempt.extraction });
        if (!SUCCESS_STATUSES.has(response.status)) { lastFailure = response.status === 404 ? "Facebook Page not found." : response.status === 401 || response.status === 403 || response.status === 429 ? "Facebook temporarily blocked public scan." : "Facebook public scan did not return a readable page."; continue; }
        sawSuccess = true;
        mergeHtmlScan(scan, html, response.url || url, depth, page);
        if (scan.followersCount !== null && scan.recentViewsTotal !== null && scan.postsCount !== null && scan.postsCount >= depth) break;
      }
      if (sawSuccess && scan.recentViewsTotal === null && videoTargets.size) {
        for (const targetUrl of [...videoTargets.values()].slice(0, depth)) {
          const targetAttempt = { url: safeUrlForLog(targetUrl), httpStatus: null, redirects: [], finalUrl: null, responseType: "not_started", pageTitle: "", contentLength: 0, extraction: null, parserErrors: [], timeoutError: null };
          let response;
          try { response = await fetchWithTimeout(fetchImpl, targetUrl, timeoutMs); }
          catch (error) {
            targetAttempt.responseType = error?.name === "AbortError" ? "timeout" : "request_error";
            targetAttempt.timeoutError = error?.name === "AbortError" ? { timeoutMs } : null;
            targetAttempt.error = error?.message || String(error);
            if (targetAttempt.timeoutError) diagnostics.timeoutErrors.push({ url: targetAttempt.url, timeoutMs });
            diagnostics.videoTargetAttempts.push(targetAttempt);
            logger?.warn?.("Facebook public video scan request failed", { pageRecordId: page?.id, url: targetAttempt.url, responseType: targetAttempt.responseType, error: targetAttempt.error });
            continue;
          }
          targetAttempt.httpStatus = response.status;
          targetAttempt.finalUrl = safeUrlForLog(response.url || targetUrl);
          if ((response.url || targetUrl) !== targetUrl) targetAttempt.redirects.push({ from: safeUrlForLog(targetUrl), to: targetAttempt.finalUrl });
          if (response.status === 403 || response.status === 429) diagnostics.blockedResponses.push({ url: targetAttempt.url, httpStatus: response.status, finalUrl: targetAttempt.finalUrl });
          let html = "";
          try { html = await response.text(); } catch (error) { targetAttempt.parserErrors.push(`response_text:${error?.message || String(error)}`); diagnostics.parserErrors.push({ url: targetAttempt.url, error: targetAttempt.parserErrors.at(-1) }); }
          targetAttempt.contentLength = html.length;
          targetAttempt.pageTitle = extractPageName(html, "") || (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ? stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)[1]) : "");
          targetAttempt.responseType = classifyFacebookResponse({ status: response.status, finalUrl: response.url || targetUrl, title: targetAttempt.pageTitle, html });
          let views;
          try { views = extractVideoViews(html, depth); } catch (error) { views = { total: null, sampled: 0, samples: [] }; targetAttempt.parserErrors.push(`views:${error?.message || String(error)}`); }
          if (targetAttempt.parserErrors.length) diagnostics.parserErrors.push({ url: targetAttempt.url, errors: targetAttempt.parserErrors });
          targetAttempt.extraction = { viewsFound: Boolean(views.sampled), videosDetected: views.sampled, viewsDetected: views.sampled ? views.total : null };
          diagnostics.videoTargetAttempts.push(targetAttempt);
          logger?.info?.("Facebook public video scan attempt", { pageRecordId: page?.id, url: targetAttempt.url, httpStatus: targetAttempt.httpStatus, finalUrl: targetAttempt.finalUrl, responseType: targetAttempt.responseType, pageTitle: targetAttempt.pageTitle, contentLength: targetAttempt.contentLength, extraction: targetAttempt.extraction });
          if (SUCCESS_STATUSES.has(response.status) && views.sampled) {
            scan.recentViewsTotal = (scan.recentViewsTotal || 0) + views.total;
            scan.videosSampled += views.sampled;
          }
        }
      }
      diagnostics.summary = {
        pageLoaded: sawSuccess,
        finalUrl: diagnostics.attempts.find((item) => item.responseType === "public_page")?.finalUrl || diagnostics.attempts.find((item) => item.responseType !== "login_wall" && item.finalUrl)?.finalUrl || diagnostics.attempts.at(-1)?.finalUrl || null,
        facebookResponseType: diagnostics.attempts.find((item) => item.responseType === "public_page")?.responseType || diagnostics.attempts.find((item) => item.responseType !== "login_wall")?.responseType || diagnostics.attempts.at(-1)?.responseType || "none",
        followersFound: scan.followersCount !== null,
        followers: scan.followersCount,
        postsDetected: scan.postsCount || 0,
        videosDetected: scan.videosSampled || 0,
        viewsDetected: scan.recentViewsTotal,
        videoTargetsDetected: diagnostics.videoTargetsDetected,
        videoTargetsScanned: diagnostics.videoTargetAttempts.length,
        error: null,
      };
      if (!sawSuccess) {
        const failed = { ...scan, status: lastFailure === "Facebook Page not found." ? "page_not_found" : lastFailure === "Facebook temporarily blocked public scan." ? "temporarily_blocked" : "scan_failed", message: lastFailure || "Facebook public scan failed; retrying later." };
        diagnostics.summary.error = failed.message;
        logger?.warn?.("Facebook public scan completed without readable page", { pageRecordId: page?.id, status: failed.status, summary: diagnostics.summary, blockedResponses: diagnostics.blockedResponses.length, timeoutErrors: diagnostics.timeoutErrors.length });
        return options.includeDiagnostics ? { ...failed, diagnostics } : failed;
      }
      if (hasAnyMetric(scan)) {
        scan.status = scan.followersCount !== null && (scan.recentViewsTotal !== null || scan.postsCount !== null) ? "synced" : "partial";
        scan.message = `Public scan collected ${[scan.followersCount !== null ? "followers" : null, scan.recentViewsTotal !== null ? "views" : null, scan.postsCount !== null ? "posts" : null].filter(Boolean).join(", ")}.`;
      } else if (diagnostics.summary.facebookResponseType === "login_wall" || diagnostics.attempts.every((item) => item.responseType === "login_wall" || item.responseType === "checkpoint")) {
        scan.status = "login_required";
        scan.message = "Facebook returned a login/checkpoint page for public scan.";
        diagnostics.summary.error = scan.message;
      } else if (!diagnostics.browser.available) {
        scan.message = "Public HTTP scan loaded Facebook, but visible metrics were not present in returned HTML. Browser rendering is not configured on this server.";
      }
      if (scan.recentViewsTotal === null && sawSuccess && scan.postsCount !== null) {
        const reason = diagnostics.videoTargetsDetected
          ? "Public posts were found, but Facebook did not expose visible video/reel view counts in the public HTML for the page or detected video URLs."
          : "Public posts were found, but no public video/reel URLs with visible view counts were present in the returned Facebook HTML.";
        scan.viewsUnavailableReason = diagnostics.browser.available ? reason : `${reason} Browser rendering is not configured on this server.`;
      }
      diagnostics.summary.followersFound = scan.followersCount !== null;
      diagnostics.summary.followers = scan.followersCount;
      diagnostics.summary.postsDetected = scan.postsCount || 0;
      diagnostics.summary.videosDetected = scan.videosSampled || 0;
      diagnostics.summary.viewsDetected = scan.recentViewsTotal;
      diagnostics.summary.videoTargetsDetected = diagnostics.videoTargetsDetected;
      diagnostics.summary.videoTargetsScanned = diagnostics.videoTargetAttempts.length;
      diagnostics.summary.viewsUnavailableReason = scan.viewsUnavailableReason || null;
      logger?.info?.("Facebook public scan completed", { pageRecordId: page?.id, status: scan.status, videosSampled: scan.videosSampled, summary: diagnostics.summary, parserErrors: diagnostics.parserErrors.length, timeoutErrors: diagnostics.timeoutErrors.length, blockedResponses: diagnostics.blockedResponses.length });
      return options.includeDiagnostics ? { ...scan, diagnostics } : scan;
    },
  });
}

module.exports = { FacebookPublicMetricsError, createFacebookPublicMetricsService, decodeEntities, extractFollowerCount, extractPageName, extractPagePicture, extractRecentPosts, extractVideoTargets, extractVideoViews, normalizeFacebookUrl, parseSocialCount, scanUrlsForPage, classifyFacebookResponse, detectChromiumRuntime };
