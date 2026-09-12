const assert = require("node:assert/strict");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { createFacebookControlStore } = require("./facebookControlStore");
const { createFacebookPublicScanScheduler } = require("./facebookPublicScanScheduler");

test("Facebook public scan scheduler scans due pages and waits when interval has not elapsed", async () => {
  const db = new DatabaseSync(":memory:");
  const ids = { fbteam: ["fbteam_aaaaaaaa"], fbpage: ["fbpage_aaaaaaaa"], metric: ["metric_aaaaaaaa", "metric_bbbbbbbb"] };
  const owner = { ownerType: "admin", ownerId: "primary" };
  const store = createFacebookControlStore({ db, now: () => "2026-09-12T12:00:00.000Z", generateId: (prefix) => ids[prefix].shift() });
  store.createPage({ pageUrl: "https://www.facebook.com/corex", pageName: "Corex" }, owner);
  let calls = 0;
  const publicMetricsService = { async scanPage(page) { calls += 1; return { status: "synced", pageUrl: page.pageUrl, pageName: page.pageName, followersCount: 10, recentViewsTotal: 20, postsCount: 1, source: "public_http_fetch", capturedAt: new Date().toISOString() }; } };
  const scheduler = createFacebookPublicScanScheduler({ store, publicMetricsService, owner, logger: { warn() {} } });
  const first = await scheduler.tick();
  assert.equal(first.status, "synced");
  assert.equal(calls, 1);
  const second = await scheduler.tick();
  assert.equal(second.status, "waiting");
  assert.equal(calls, 1);
  db.close();
});
