const assert = require("node:assert/strict");
const test = require("node:test");
const { createFacebookPublicMetricsService, extractFollowerCount, extractPageName, extractRecentPosts, extractVideoTargets, extractReelViews, extractVideoViews, normalizeFacebookUrl, parseSocialCount, scanUrlsForPage, classifyFacebookResponse, detectChromiumRuntime } = require("./facebookPublicMetricsService");

test("public Facebook URL validation accepts only expected Facebook hosts", () => {
  assert.equal(normalizeFacebookUrl("facebook.com/corex"), "https://facebook.com/corex");
  assert.equal(normalizeFacebookUrl("http://www.facebook.com/corex#top"), "https://www.facebook.com/corex");
  assert.equal(normalizeFacebookUrl("https://mbasic.facebook.com/corex"), "https://mbasic.facebook.com/corex");
  assert.throws(() => normalizeFacebookUrl("https://example.com/corex"), /facebook.com/);
  assert.throws(() => normalizeFacebookUrl("file:///etc/passwd"), /HTTP/);
  assert.throws(() => normalizeFacebookUrl("http://localhost/facebook"), /facebook.com/);
});

test("public metric parser normalizes social counts and extracts page data", () => {
  assert.equal(parseSocialCount("48K followers"), 48000);
  assert.equal(parseSocialCount("48.2K"), 48200);
  assert.equal(parseSocialCount("1.2M"), 1200000);
  assert.equal(parseSocialCount("2.4B views"), 2400000000);
  const html = '<html><head><meta property="og:title" content="Mega Crush Lab | Facebook"><meta property="og:image" content="https://cdn.test/page.jpg"><meta name="description" content="48,213 followers"></head><body><a href="/megacrush/posts/111">A</a><a href="/megacrush/reel/222">B</a>120K views 85K views {"play_count_reduced":"7.9K"}</body></html>';
  assert.equal(extractPageName(html), "Mega Crush Lab");
  assert.deepEqual(extractFollowerCount(html), { count: 48213, display: "48,213", source: "public_text" });
  assert.deepEqual(extractVideoViews(html, 10), { total: 212900, sampled: 3, samples: [{ count: 120000, display: "120K" }, { count: 85000, display: "85K" }, { count: 7900, display: "7.9K" }] });
  assert.deepEqual(extractRecentPosts(html, 10), { count: 2, type: "recent-public-sample", window: "latest-10-public-items" });
});

test("public scanner tries mobile basic and page-id variants before declaring metrics unavailable", async () => {
  const requested = [];
  const service = createFacebookPublicMetricsService({
    now: () => "2026-09-12T12:30:00.000Z",
    fetchImpl: async (url) => {
      requested.push(url);
      const body = url.includes("mbasic.facebook.com/profile.php")
        ? '<title>Range Masters | Facebook</title><main>48,213 followers <a href="/range/posts/1">Post</a>900 views</main>'
        : '<title>Range Masters | Facebook</title>';
      return { status: 200, url, async text() { return body; } };
    },
  });
  const scan = await service.scanPage({ id: "fbpage_1", pageUrl: "https://www.facebook.com/range", pageId: "61593949095532" });
  assert.equal(scan.status, "synced");
  assert.equal(scan.pageName, "Range Masters");
  assert.equal(scan.followersCount, 48213);
  assert.equal(scan.recentViewsTotal, 900);
  assert.equal(scan.postsCount, 1);
  assert.ok(requested.some((url) => url.includes("mbasic.facebook.com/profile.php?id=61593949095532")));
  const scanUrls = scanUrlsForPage({ pageId: "61593949095532" }, "https://www.facebook.com/range");
  assert.ok(scanUrls.some((url) => url.includes("sk=about")));
  assert.ok(scanUrls.some((url) => url.includes("sk=reels_tab")));
  assert.ok(scanUrls.findIndex((url) => url.includes("sk=reels_tab")) < scanUrls.findIndex((url) => url.includes("/posts")));
});

test("public scanner follows detected video targets for visible view counts", async () => {
  const requested = [];
  const service = createFacebookPublicMetricsService({
    now: () => "2026-09-12T13:00:00.000Z",
    scanDepth: 5,
    fetchImpl: async (url) => {
      requested.push(url);
      if (url.includes("/reel/abc123")) {
        return { status: 200, url, async text() { return '<title>Demo Reel | Facebook</title><body>1.2K views</body>'; } };
      }
      const postLinks = Array.from({ length: url.includes("/posts") ? 5 : 1 }, (_, index) => `<a href="/demo/posts/${index + 1}">Post ${index + 1}</a>`).join("");
      return {
        status: 200,
        url,
        async text() { return `<title>Demo Page | Facebook</title><main>966 followers ${postLinks}<a href="/reel/abc123">Reel</a></main>`; },
      };
    },
  });
  const scan = await service.scanPage({ id: "fbpage_demo", pageUrl: "https://www.facebook.com/demo" }, { includeDiagnostics: true });
  assert.equal(scan.followersCount, 966);
  assert.equal(scan.postsCount, 5);
  assert.equal(scan.recentViewsTotal, 1200);
  assert.equal(scan.videosSampled, 1);
  assert.equal(scan.diagnostics.summary.videoTargetsDetected, 1);
  assert.equal(scan.diagnostics.summary.videoTargetsScanned, 1);
  assert.ok(requested.some((url) => url.includes("/reel/abc123")));
});

test("video target parser normalizes public Facebook reel and watch links", () => {
  const targets = extractVideoTargets('<a href="/reel/abc123?mibextid=x">R</a><a href="https://www.facebook.com/watch/?v=987654">W</a>', 'https://www.facebook.com/demo', 10);
  assert.equal(targets.length, 2);
  assert.ok(targets.some((url) => url.includes('/reel/abc123')));
  assert.ok(targets.some((url) => url.includes('/watch/?v=987654')));
});


test("reel parser counts every visible reel view chip including repeated values", () => {
  const html = '<script>{"video_id":"r1","play_count_reduced":"1K"},{"video_id":"r2","play_count_reduced":"1K"},{"video_id":"r3","play_count_reduced":"2.5K"}</script>';
  const reels = extractReelViews(html, 10);
  assert.equal(reels.sampled, 3);
  assert.equal(reels.total, 4500);
  assert.equal(reels.type, "public-reels-visible-views");
});

test("public scanner prioritizes the Facebook reels tab and sums visible tile views", async () => {
  const requested = [];
  const service = createFacebookPublicMetricsService({
    now: () => "2026-09-12T14:00:00.000Z",
    fetchImpl: async (url) => {
      requested.push(url);
      if (url.includes("sk=reels_tab")) {
        return { status: 200, url, async text() { return '<title>Wings & War Reels</title><body>2.1K followers <a href="/wings/posts/1">Post</a><script>{"play_count_reduced":"7.9K"},{"play_count_reduced":"8.2K"},{"play_count_reduced":"6.2K"},{"play_count_reduced":"9.5K"},{"play_count_reduced":"13K"}</script></body>'; } };
      }
      return { status: 200, url, async text() { return '<title>Wings & War</title><body>2.1K followers <a href="/wings/posts/1">Post</a>466 views</body>'; } };
    },
  });
  const scan = await service.scanPage({ id: "wings", pageUrl: "https://www.facebook.com/people/Wings-War/61594103515251/", pageId: "61594103515251" });
  assert.equal(scan.followersCount, 2100);
  assert.equal(scan.recentViewsTotal, 44800);
  assert.equal(scan.videosSampled, 5);
  assert.equal(scan.postsCount, 5);
  assert.equal(scan.postsCountType, "public-reels-count");
  assert.ok(requested[1].includes("sk=reels_tab"));
});

test("public scanner never invents missing numbers", async () => {
  const unavailable = createFacebookPublicMetricsService({ fetchImpl: async (url) => ({ status: 200, url, async text() { return "<title>Empty | Facebook</title>"; } }) });
  const emptyScan = await unavailable.scanPage({ pageUrl: "https://www.facebook.com/empty" });
  assert.equal(emptyScan.status, "metric_unavailable");
  assert.equal(emptyScan.followersCount, null);
  assert.equal(emptyScan.recentViewsTotal, null);
  assert.equal(emptyScan.postsCount, null);
});


test("follower parser does not treat a Facebook page id as the follower count", () => {
  const html = '<html><body>{"pageID":"61566901767304","label":"Followers"}</body></html>';
  assert.deepEqual(extractFollowerCount(html, { pageId: "61566901767304" }), { count: null, display: null, source: null });
  assert.deepEqual(extractFollowerCount('<meta name="description" content="48,213 followers">', { pageId: "61566901767304" }), { count: 48213, display: "48,213", source: "public_text" });
});

test("public scanner returns safe diagnostics without fake metrics", async () => {
  const requested = [];
  const logs = [];
  const service = createFacebookPublicMetricsService({
    now: () => "2026-09-12T12:45:00.000Z",
    fetchImpl: async (url) => {
      requested.push(url);
      return { status: 200, url: url.replace("www.facebook.com/demo", "www.facebook.com/people/Demo/61566901767304"), async text() { return '<title>Demo Page | Facebook</title><body>{"pageID":"61566901767304","label":"Followers"}<a href="/demo/posts/1">Post</a></body>'; } };
    },
    logger: { info(message, detail) { logs.push({ message, detail }); }, warn() {} },
  });
  const scan = await service.scanPage({ id: "fbpage_demo", pageUrl: "https://www.facebook.com/demo", pageId: "61566901767304" }, { includeDiagnostics: true });
  assert.equal(scan.followersCount, null);
  assert.equal(scan.postsCount, 1);
  assert.equal(scan.status, "partial");
  assert.equal(scan.diagnostics.summary.pageLoaded, true);
  assert.equal(scan.diagnostics.summary.followersFound, false);
  assert.equal(scan.diagnostics.attempts[0].responseType, "public_page");
  assert.ok(scan.diagnostics.attempts[0].contentLength > 0);
  assert.ok(logs.some((entry) => entry.message === "Facebook public scan attempt"));
  assert.ok(requested.length > 0);
});

test("facebook response classifier identifies login and public page responses", () => {
  assert.equal(classifyFacebookResponse({ status: 200, finalUrl: "https://www.facebook.com/login.php", title: "Facebook", html: "Log in to Facebook" }), "login_wall");
  assert.equal(classifyFacebookResponse({ status: 429, finalUrl: "https://www.facebook.com/page", title: "Facebook", html: "" }), "rate_limited_429");
  assert.equal(classifyFacebookResponse({ status: 200, finalUrl: "https://www.facebook.com/people/Demo/1", title: "Demo | Facebook", html: "Demo 48 followers posts" }), "public_page");
  assert.equal(detectChromiumRuntime().mode, "not_configured");
});
