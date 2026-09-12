const assert = require("node:assert/strict");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { createFacebookControlStore, score } = require("./facebookControlStore");

function testStore() {
  const db = new DatabaseSync(":memory:");
  const ids = { fbteam: ["fbteam_aaaaaaaa"], fbpage: ["fbpage_aaaaaaaa", "fbpage_bbbbbbbb"], metric: ["metric_aaaaaaaa", "metric_bbbbbbbb", "metric_cccccccc"] };
  const store = createFacebookControlStore({ db, now: () => "2026-09-12T12:00:00.000Z", generateId: (prefix) => ids[prefix].shift() });
  return { db, store };
}

test("Facebook Control persists pages, teams, sync settings, and empty real metrics safely", () => {
  const { db, store } = testStore();
  const owner = { ownerType: "admin", ownerId: "primary" };
  const otherOwner = { ownerType: "additional", ownerId: "team_a" };
  const team = store.createTeam({ name: "Imran", notes: "owner" }, owner);
  const page = store.createPage({ pageUrl: "https://www.facebook.com/corexpage", pageName: "Corex Page", pageId: "123", teamMemberId: team.id, status: "ACTIVE" }, owner);
  assert.equal(page.status, "ACTIVE");
  assert.equal(page.dataConnectionStatus, "public_scan_pending");
  assert.deepEqual(page.metrics, { followers: null, views: null, posts: null, reels: null, engagement: null, followerGrowth: null, capturedAt: null, metricMeta: null });
  assert.equal(store.list(owner).pages[0].performanceScore, 0);
  assert.deepEqual(store.list(otherOwner).pages, []);
  assert.equal(store.updateSync({ refreshIntervalMinutes: 15 }, owner).refreshIntervalMinutes, 15);
  assert.throws(() => store.updateSync({ refreshIntervalMinutes: 5 }, owner), /Refresh interval is invalid/);
  assert.throws(() => store.createPage({ pageUrl: "https://example.com/not-facebook", pageName: "Bad" }, owner), /Only Facebook Page URLs/);
  db.close();
});


test("Facebook Control records successful metric snapshots with frontend-ready timestamps", () => {
  const { db, store } = testStore();
  const owner = { ownerType: "admin", ownerId: "primary" };
  const page = store.createPage({
    pageUrl: "https://www.facebook.com/corexpage",
    pageName: "Corex Page",
    pageId: "123",
    credentialId: "fcred_1234567890123456789012",
  }, owner);
  const synced = store.recordPageMetrics(page.id, {
    pageName: "Corex Official",
    pageId: "123",
    pageUrl: "https://www.facebook.com/corexpage",
    pagePictureUrl: "https://example.test/corex.jpg",
    followers: 48200,
    views: 1800000,
    posts: 126,
    engagement: 6.5,
    followerGrowth: 3.2,
  }, owner);
  assert.equal(synced.pageName, "Corex Official");
  assert.equal(synced.pagePictureUrl, "https://example.test/corex.jpg");
  assert.equal(synced.syncStatus, "synced");
  assert.equal(synced.metrics.capturedAt, "2026-09-12T12:00:00.000Z");
  assert.equal(synced.metrics.followers, 48200);
  assert.equal(synced.metrics.views, 1800000);
  assert.equal(synced.metrics.posts, 126);
  assert.equal(synced.metrics.reels, 126);
  assert.equal(synced.performanceScore, score(synced.metrics));
  db.close();
});


test("Facebook Control uses stored metric snapshots without fabricating values and deletes snapshots with the page", () => {
  const { db, store } = testStore();
  const owner = { ownerType: "admin", ownerId: "primary" };
  const page = store.createPage({ pageUrl: "https://facebook.com/corex", pageName: "Corex", credentialId: "fcred_1234567890123456789012" }, owner);
  db.prepare("INSERT INTO facebook_page_metrics (id, owner_type, owner_id, page_record_id, captured_at, followers, views, reels, posts, engagement, follower_growth) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("metric_1", owner.ownerType, owner.ownerId, page.id, "2026-09-12T12:05:00.000Z", 1000, 2500, 12, 12, 8.5, 4.2);
  const saved = store.list(owner).pages[0];
  assert.equal(saved.metrics.followers, 1000);
  assert.equal(saved.metrics.views, 2500);
  assert.equal(saved.metrics.posts, 12);
  assert.equal(saved.performanceScore, score(saved.metrics));
  const failed = store.markPageSyncIssue(page.id, "metric_unavailable", "Metric unavailable.", owner);
  assert.equal(failed.lastSyncAt, "2026-09-12T12:00:00.000Z");
  assert.equal(store.deletePage(page.id, owner), true);
  assert.equal(db.prepare("SELECT count(*) AS count FROM facebook_page_metrics").get().count, 0);
  assert.equal(db.prepare("SELECT count(*) AS count FROM facebook_public_metric_snapshots").get().count, 0);
  assert.equal(store.deletePage(page.id, owner), false);
  db.close();
});

test("Facebook Control stores public metric snapshots and preserves last good values on scan failure", () => {
  const { db, store } = testStore();
  const owner = { ownerType: "admin", ownerId: "primary" };
  const page = store.createPage({ pageUrl: "https://www.facebook.com/megacrush", pageName: "Mega Crush Lab" }, owner);
  const scanned = store.recordPublicMetrics(page.id, {
    status: "synced",
    message: "Public scan collected followers, views, posts.",
    pageName: "Mega Crush Lab",
    pageUrl: "https://www.facebook.com/megacrush",
    followersCount: 48200,
    followersDisplay: "48.2K",
    followersSource: "public_text",
    recentViewsTotal: 1800000,
    videosSampled: 3,
    postsCount: 23,
    postsCountType: "recent-public-sample",
    postsWindow: "latest-10-public-items",
    scanDepth: 10,
    source: "public_http_fetch",
  }, owner);
  assert.equal(scanned.syncStatus, "synced");
  assert.equal(scanned.metrics.followers, 48200);
  assert.equal(scanned.metrics.views, 1800000);
  assert.equal(scanned.metrics.posts, 23);
  assert.equal(scanned.metrics.metricMeta.posts.quality, "recent-public-sample");
  const failed = store.recordPublicMetrics(page.id, { status: "temporarily_blocked", message: "Facebook temporarily blocked public scan.", pageUrl: "https://www.facebook.com/megacrush" }, owner);
  assert.equal(failed.syncStatus, "temporarily_blocked");
  assert.equal(failed.metrics.followers, 48200);
  assert.equal(db.prepare("SELECT count(*) AS count FROM facebook_public_metric_snapshots").get().count, 1);
  db.close();
});


test("Facebook Control ignores stale impossible public follower snapshots and accepts the repaired scan", () => {
  const { db, store } = testStore();
  const owner = { ownerType: "admin", ownerId: "primary" };
  const page = store.createPage({ pageUrl: "https://www.facebook.com/profile.php?id=61566901767304", pageName: "Mega Crush Lab", pageId: "61566901767304" }, owner);
  db.prepare("INSERT INTO facebook_public_metric_snapshots (id, owner_type, owner_id, page_record_id, captured_at, followers_count, followers_display, followers_source, recent_views_total, videos_sampled, posts_count, posts_count_type, posts_window, scan_depth, scan_status, scan_error, source, metric_meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("metric_bad", owner.ownerType, owner.ownerId, page.id, "2026-09-12T11:59:00.000Z", 61566901767304, "61566901767304", "public_text", null, 0, 1, "recent-public-sample", "latest-10-public-items", 10, "synced", "", "public_http_fetch", null);
  const stale = store.list(owner).pages[0];
  assert.equal(stale.metrics.followers, null);
  assert.equal(stale.metrics.posts, null);
  const repaired = store.recordPublicMetrics(page.id, {
    status: "synced",
    message: "Public scan collected followers, posts.",
    pageName: "Mega Crush Lab",
    pageUrl: "https://www.facebook.com/people/Mega-Crush-Lab/61566901767304/",
    followersCount: 966,
    followersDisplay: "966",
    followersSource: "public_text:www.facebook.com",
    postsCount: 10,
    postsCountType: "recent-public-sample",
    postsWindow: "latest-10-public-items",
    scanDepth: 10,
    source: "public_http_fetch",
  }, owner);
  assert.equal(repaired.metrics.followers, 966);
  assert.equal(repaired.metrics.posts, 10);
  assert.equal(repaired.performanceScore, score(repaired.metrics));
  db.close();
});
