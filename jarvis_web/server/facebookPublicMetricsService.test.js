const assert = require("node:assert/strict");
const test = require("node:test");
const { createFacebookPublicMetricsService, extractFollowerCount, extractPageName, extractRecentPosts, extractVideoViews, normalizeFacebookUrl, parseSocialCount } = require("./facebookPublicMetricsService");

test("public Facebook URL validation accepts only expected Facebook hosts", () => {
  assert.equal(normalizeFacebookUrl("facebook.com/corex"), "https://facebook.com/corex");
  assert.equal(normalizeFacebookUrl("http://www.facebook.com/corex#top"), "https://www.facebook.com/corex");
  assert.throws(() => normalizeFacebookUrl("https://example.com/corex"), /facebook.com/);
  assert.throws(() => normalizeFacebookUrl("file:///etc/passwd"), /HTTP/);
  assert.throws(() => normalizeFacebookUrl("http://localhost/facebook"), /facebook.com/);
});

test("public metric parser normalizes social counts and extracts page data", () => {
  assert.equal(parseSocialCount("48K followers"), 48000);
  assert.equal(parseSocialCount("48.2K"), 48200);
  assert.equal(parseSocialCount("1.2M"), 1200000);
  assert.equal(parseSocialCount("2.4B views"), 2400000000);
  const html = '<html><head><meta property="og:title" content="Mega Crush Lab | Facebook"><meta property="og:image" content="https://cdn.test/page.jpg"></head><body>48.2K followers <a href="/megacrush/posts/111">A</a><a href="/megacrush/reel/222">B</a>120K views 85K views</body></html>';
  assert.equal(extractPageName(html), "Mega Crush Lab");
  assert.deepEqual(extractFollowerCount(html), { count: 48200, display: "48.2K", source: "public_text" });
  assert.deepEqual(extractVideoViews(html, 10), { total: 205000, sampled: 2, samples: [{ count: 120000, display: "120K" }, { count: 85000, display: "85K" }] });
  assert.deepEqual(extractRecentPosts(html, 10), { count: 2, type: "recent-public-sample", window: "latest-10-public-items" });
});

test("public scanner fetches HTML, aggregates real visible public metrics, and never invents missing numbers", async () => {
  const html = '<title>Range Masters | Facebook</title><main>1.2M followers <a href="/range/posts/1">Post</a>900 views</main>';
  const service = createFacebookPublicMetricsService({ now: () => "2026-09-12T12:30:00.000Z", fetchImpl: async () => ({ status: 200, url: "https://www.facebook.com/range", async text() { return html; } }) });
  const scan = await service.scanPage({ id: "fbpage_1", pageUrl: "https://www.facebook.com/range" });
  assert.equal(scan.status, "synced");
  assert.equal(scan.pageName, "Range Masters");
  assert.equal(scan.followersCount, 1200000);
  assert.equal(scan.recentViewsTotal, 900);
  assert.equal(scan.postsCount, 1);
  const unavailable = createFacebookPublicMetricsService({ fetchImpl: async () => ({ status: 200, url: "https://www.facebook.com/empty", async text() { return "<title>Empty | Facebook</title>"; } }) });
  const emptyScan = await unavailable.scanPage({ pageUrl: "https://www.facebook.com/empty" });
  assert.equal(emptyScan.status, "metric_unavailable");
  assert.equal(emptyScan.followersCount, null);
  assert.equal(emptyScan.recentViewsTotal, null);
  assert.equal(emptyScan.postsCount, null);
});
