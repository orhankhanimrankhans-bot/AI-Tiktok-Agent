const assert = require("node:assert/strict");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { createFacebookControlStore } = require("./facebookControlStore");
const { FacebookGraphError } = require("./facebookGraph");
const { publicSyncError, syncFacebookControl } = require("./facebookControlRoutes");

function setupStore() {
  const db = new DatabaseSync(":memory:");
  const ids = {
    fbteam: ["fbteam_aaaaaaaa"],
    fbpage: ["fbpage_aaaaaaaa"],
    metric: ["metric_aaaaaaaa"],
  };
  const store = createFacebookControlStore({
    db,
    now: () => "2026-09-12T12:00:00.000Z",
    generateId: (prefix) => ids[prefix].shift(),
  });
  const owner = { ownerType: "admin", ownerId: "primary" };
  const team = store.createTeam({ name: "Imran" }, owner);
  const page = store.createPage({
    pageUrl: "https://www.facebook.com/corexpage",
    pageName: "Corex Page",
    pageId: "123",
    teamMemberId: team.id,
    credentialId: "fcred_1234567890123456789012",
  }, owner);
  return { db, store, owner, page };
}

function credentialStore() {
  return {
    list() { return [{ id: "fcred_1234567890123456789012", pageId: "123", pageName: "Corex Page", connected: true }]; },
    get(id) {
      assert.equal(id, "fcred_1234567890123456789012");
      return {
        id,
        authMode: "oauth",
        pageId: "123",
        pageName: "Corex Page",
        tokens: {
          userAccessToken: "user-token-secret",
          pageAccessTokens: { "123": "page-token-secret" },
        },
      };
    },
  };
}

test("Facebook Control sync fetches real Graph metrics through the existing credential", async () => {
  const { db, store, owner } = setupStore();
  const calls = [];
  const graphServiceFactory = () => ({
    async pageMetadata(pageId, token) {
      calls.push(["metadata", pageId, token]);
      return { id: "123", name: "Corex Official", fan_count: 48200, link: "https://www.facebook.com/corexpage", picture: { data: { url: "https://example.test/corex.jpg" } } };
    },
    async pagePosts(pageId, token) {
      calls.push(["posts", pageId, token]);
      return { summary: { total_count: 126 } };
    },
    async pageInsights(pageId, token) {
      calls.push(["insights", pageId, token]);
      return { data: [{ name: "page_impressions_unique", values: [{ value: 1700000 }, { value: 1800000 }] }] };
    },
  });
  const result = await syncFacebookControl({ owner, store, facebookCredentialStore: credentialStore(), graphServiceFactory, logger: { warn() {}, error() {} } });
  assert.equal(result.status, "synced");
  assert.equal(result.pages[0].pageName, "Corex Official");
  assert.equal(result.pages[0].pageId, "123");
  assert.equal(result.pages[0].pagePictureUrl, "https://example.test/corex.jpg");
  assert.equal(result.pages[0].metrics.followers, 48200);
  assert.equal(result.pages[0].metrics.views, 1800000);
  assert.equal(result.pages[0].metrics.posts, 126);
  assert.equal(result.pages[0].metrics.reels, 126);
  assert.equal(result.pages[0].metrics.capturedAt, "2026-09-12T12:00:00.000Z");
  assert.deepEqual(calls, [
    ["metadata", "123", "page-token-secret"],
    ["posts", "123", "page-token-secret"],
    ["insights", "123", "page-token-secret"],
  ]);
  assert.doesNotMatch(JSON.stringify(result), /page-token-secret|user-token-secret/);
  db.close();
});


test("Facebook Control sync auto-links saved credentials by Page ID before fetching metrics", async () => {
  const { db, store, owner } = setupStore();
  store.updatePage("fbpage_aaaaaaaa", {
    pageUrl: "https://www.facebook.com/corexpage",
    pageName: "Corex Page",
    pageId: "123",
    credentialId: "",
  }, owner);
  const graphServiceFactory = () => ({
    async pageMetadata() { return { id: "123", name: "Corex Page", fan_count: 9000, link: "https://www.facebook.com/corexpage" }; },
    async pagePosts() { return { summary: { total_count: 45 } }; },
    async pageInsights() { return { data: [{ name: "page_video_views", values: [{ value: 321000 }] }] }; },
  });
  const result = await syncFacebookControl({ owner, store, facebookCredentialStore: credentialStore(), graphServiceFactory, logger: { warn() {}, error() {} } });
  assert.equal(result.status, "synced");
  assert.equal(result.pages[0].credentialId, "fcred_1234567890123456789012");
  assert.equal(result.pages[0].metrics.followers, 9000);
  assert.equal(result.pages[0].metrics.views, 321000);
  assert.equal(result.pages[0].metrics.posts, 45);
  db.close();
});

test("Facebook Control sync maps Graph permission errors without deleting last good metrics", async () => {
  const { db, store, owner, page } = setupStore();
  store.recordPageMetrics(page.id, { pageName: "Corex Page", pageId: "123", pageUrl: "https://www.facebook.com/corexpage", followers: 100, views: 200, posts: 3 }, owner);
  const graphServiceFactory = () => ({
    async pageMetadata() { throw new FacebookGraphError(403, "meta_200", "Permission required: pages_read_engagement.", "pages_read_engagement"); },
  });
  const result = await syncFacebookControl({ owner, store, facebookCredentialStore: credentialStore(), graphServiceFactory, logger: { warn() {}, error() {} } });
  assert.equal(result.status, "partial");
  assert.equal(result.pages[0].syncStatus, "permission_required");
  assert.equal(result.pages[0].syncMessage, "Page permission required: pages_read_engagement.");
  assert.equal(result.pages[0].metrics.followers, 100);
  assert.equal(result.pages[0].metrics.capturedAt, "2026-09-12T12:00:00.000Z");
  db.close();
});


test("Facebook Control sync does not create fake zero metrics when Meta returns no numbers", async () => {
  const { db, store, owner } = setupStore();
  const graphServiceFactory = () => ({
    async pageMetadata() { return { id: "123", name: "Corex Page", link: "https://www.facebook.com/corexpage" }; },
    async pagePosts() { return { summary: {} }; },
    async pageInsights() { return { data: [] }; },
  });
  const result = await syncFacebookControl({ owner, store, facebookCredentialStore: credentialStore(), graphServiceFactory, logger: { warn() {}, error() {} } });
  assert.equal(result.status, "partial");
  assert.equal(result.pages[0].syncStatus, "metric_unavailable");
  assert.equal(result.pages[0].metrics.capturedAt, null);
  assert.equal(result.pages[0].metrics.followers, null);
  assert.equal(result.pages[0].metrics.views, null);
  assert.equal(result.pages[0].metrics.posts, null);
  db.close();
});

test("Facebook Graph errors are converted to safe public sync states", () => {
  assert.deepEqual(publicSyncError(new FacebookGraphError(401, "meta_190", "expired")), { status: "token_expired", message: "Facebook token expired." });
  assert.deepEqual(publicSyncError(new FacebookGraphError(429, "meta_4", "limit")), { status: "rate_limited", message: "Facebook API temporarily rate limited." });
  assert.deepEqual(publicSyncError(new FacebookGraphError(400, "meta_100", "bad metric")), { status: "metric_unavailable", message: "Metric unavailable with current Facebook API permissions." });
});

test("Facebook Control manual sync scans public Page URLs without credentials and preserves manager association", async () => {
  const db = new DatabaseSync(":memory:");
  const ids = { fbteam: ["fbteam_aaaaaaaa", "fbteam_bbbbbbbb"], fbpage: ["fbpage_aaaaaaaa", "fbpage_bbbbbbbb"], metric: ["metric_aaaaaaaa", "metric_bbbbbbbb"] };
  const store = createFacebookControlStore({ db, now: () => "2026-09-12T12:00:00.000Z", generateId: (prefix) => ids[prefix].shift() });
  const owner = { ownerType: "admin", ownerId: "primary" };
  const imran = store.createTeam({ name: "Imran Khan" }, owner);
  const shahab = store.createTeam({ name: "Shahab Khan" }, owner);
  store.createPage({ pageUrl: "https://www.facebook.com/mega", pageName: "Mega Crush Lab", teamMemberId: imran.id }, owner);
  store.createPage({ pageUrl: "https://www.facebook.com/range", pageName: "RANGE MASTERS", teamMemberId: shahab.id }, owner);
  const scans = [];
  const publicMetricsService = { async scanPage(page) { scans.push(page.pageUrl); return { status: "synced", message: "Public scan collected followers, views, posts.", pageUrl: page.pageUrl, pageName: page.pageName, followersCount: page.pageUrl.includes("mega") ? 1000 : 2000, recentViewsTotal: 3000, postsCount: 4, postsCountType: "recent-public-sample", postsWindow: "latest-10-public-items", capturedAt: "2026-09-12T12:01:00.000Z", source: "public_http_fetch" }; } };
  const result = await syncFacebookControl({ owner, store, publicMetricsService, logger: { warn() {}, error() {} } });
  assert.equal(result.status, "synced");
  assert.deepEqual(scans, ["https://www.facebook.com/mega", "https://www.facebook.com/range"]);
  assert.equal(result.pages.find((page) => page.pageName === "Mega Crush Lab").teamMemberName, "Imran Khan");
  assert.equal(result.pages.find((page) => page.pageName === "RANGE MASTERS").metrics.followers, 2000);
  db.close();
});

test("Facebook Control public sync keeps last good metrics when a later scan has no public numbers", async () => {
  const { db, store, owner, page } = setupStore();
  store.recordPublicMetrics(page.id, { status: "synced", pageUrl: page.pageUrl, followersCount: 100, recentViewsTotal: 200, postsCount: 3, capturedAt: "2026-09-12T12:00:00.000Z", source: "public_http_fetch" }, owner);
  const publicMetricsService = { async scanPage() { return { status: "metric_unavailable", message: "Public metrics are unavailable.", pageUrl: page.pageUrl, capturedAt: "2026-09-12T12:05:00.000Z", source: "public_http_fetch" }; } };
  const result = await syncFacebookControl({ owner, store, publicMetricsService, logger: { warn() {}, error() {} } });
  assert.equal(result.status, "partial");
  assert.equal(result.pages[0].syncStatus, "metric_unavailable");
  assert.equal(result.pages[0].metrics.followers, 100);
  assert.equal(result.pages[0].metrics.views, 200);
  assert.equal(result.pages[0].metrics.posts, 3);
  db.close();
});
