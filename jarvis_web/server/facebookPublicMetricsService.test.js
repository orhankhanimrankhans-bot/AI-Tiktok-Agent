const assert = require("node:assert/strict");
const test = require("node:test");
const { createFacebookPublicMetricsService, extractFollowerCount, extractPageName, extractRecentPosts, extractVideoViews, normalizeFacebookUrl, parseSocialCount, scanUrlsForPage } = require("./facebookPublicMetricsService");

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
  const html = '<html><head><meta property="og:title" content="Mega Crush Lab | Facebook"><meta property="og:image" content="https://cdn.test/page.jpg"><meta name="description" content="48,213 followers"></head><body><a href="/megacrush/posts/111">A</a><a href="/megacrush/reel/222">B</a>120K views 85K views</body></html>';
  assert.equal(extractPageName(html), "Mega Crush Lab");
  assert.deepEqual(extractFollowerCount(html), { count: 48213, display: "48,213", source: "public_text" });
  assert.deepEqual(extractVideoViews(html, 10), { total: 205000, sampled: 2, samples: [{ count: 120000, display: "120K" }, { count: 85000, display: "85K" }] });
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
  assert.ok(scanUrlsForPage({ pageId: "61593949095532" }, "https://www.facebook.com/range").some((url) => url.includes("sk=about")));
});

test("public scanner never invents missing numbers", async () => {
  const unavailable = createFacebookPublicMetricsService({ fetchImpl: async (url) => ({ status: 200, url, async text() { return "<title>Empty | Facebook</title>"; } }) });
  const emptyScan = await unavailable.scanPage({ pageUrl: "https://www.facebook.com/empty" });
  assert.equal(emptyScan.status, "metric_unavailable");
  assert.equal(emptyScan.followersCount, null);
  assert.equal(emptyScan.recentViewsTotal, null);
  assert.equal(emptyScan.postsCount, null);
});
