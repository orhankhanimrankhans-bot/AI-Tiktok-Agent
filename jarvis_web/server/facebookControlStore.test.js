const assert = require("node:assert/strict");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { createFacebookControlStore, score } = require("./facebookControlStore");

function testStore() {
  const db = new DatabaseSync(":memory:");
  const ids = { fbteam: ["fbteam_aaaaaaaa"], fbpage: ["fbpage_aaaaaaaa", "fbpage_bbbbbbbb"], metric: ["metric_aaaaaaaa", "metric_bbbbbbbb"] };
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
  assert.equal(page.dataConnectionStatus, "connection_required");
  assert.deepEqual(page.metrics, { followers: null, views: null, posts: null, reels: null, engagement: null, followerGrowth: null, capturedAt: null });
  assert.equal(store.list(owner).pages[0].performanceScore, 0);
  assert.deepEqual(store.list(otherOwner).pages, []);
  assert.equal(store.updateSync({ refreshIntervalMinutes: 15 }, owner).refreshIntervalMinutes, 15);
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
  assert.equal(store.deletePage(page.id, owner), true);
  assert.equal(db.prepare("SELECT count(*) AS count FROM facebook_page_metrics").get().count, 0);
  assert.equal(store.deletePage(page.id, owner), false);
  db.close();
});