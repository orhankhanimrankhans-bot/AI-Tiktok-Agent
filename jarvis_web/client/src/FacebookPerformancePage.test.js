import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const performancePage = readFileSync(new URL("./FacebookPerformancePage.jsx", import.meta.url), "utf8");
const api = readFileSync(new URL("./facebookControlApi.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("./App.css", import.meta.url), "utf8");

test("Facebook Performance page uses backend sync and the required compact sections", () => {
  assert.match(api, /\/api\/facebook\/performance/);
  assert.match(api, /\/api\/facebook\/sync/);
  assert.match(performancePage, /Update Metrics/);
  assert.match(performancePage, /Page Performance \/ Ranking/);
  assert.match(performancePage, /Team Performance Graph/);
  for (const column of ["Rank", "Page", "Manager", "Followers", "Views", "Posts", "Score", "Updated", "Open Page"]) {
    assert.match(performancePage, new RegExp(column));
  }
  assert.match(performancePage, /Waiting for first successful Facebook sync/);
  assert.match(performancePage, /metricStatus\(page, "posts"\)/);
  assert.match(performancePage, /Not available/);
  assert.match(performancePage, /Not synced/);
  assert.match(performancePage, /some\(\(page\) => !page\.metrics\?\.capturedAt\)/);
  assert.doesNotMatch(performancePage, /Pending/);
  assert.match(performancePage, /window\.open\(page\.pageUrl/);
  assert.match(styles, /\.facebook-performance-row/);
});

test("team performance logic aggregates synced pages and normalizes scores", () => {
  assert.match(performancePage, /export function teamPerformanceRows\(pages = \[\]\)/);
  assert.match(performancePage, /if \(!page\.metrics\?\.capturedAt\) continue/);
  assert.match(performancePage, /const name = page\.teamMemberName \|\| "Unassigned"/);
  assert.match(performancePage, /current\.rawScore \+= page\.performanceScore \|\| facebookPerformanceScore\(page\.metrics\)/);
  assert.match(performancePage, /Math\.round\(\(row\.rawScore \/ max\) \* 100\)/);
});
