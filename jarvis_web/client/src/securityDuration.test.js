import assert from "node:assert/strict";
import test from "node:test";
import { DAY_MS, durationRequest, formatDuration, previewExpiration, profileStatus, validateCustomDuration } from "./securityDuration.js";

test("custom access accepts one day through one year and calculates absolute expiry", () => {
  const now = Date.UTC(2026, 7, 24, 20, 30);
  for (const [value, unit, days] of [[1, "days", 1], [7, "days", 7], [30, "days", 30], [6, "months", 180], [1, "year", 365], [12, "months", 365]]) {
    assert.deepEqual(durationRequest("custom", value, unit), { durationValue: value, durationUnit: unit });
    assert.equal(previewExpiration("custom", value, unit, now), now + days * DAY_MS);
  }
});

test("custom access rejects empty, non-numeric, negative, and above-year values", () => {
  for (const [value, unit] of [["", "days"], ["abc", "days"], [-1, "days"], [0, "days"], [366, "days"], [24, "months"], [2, "year"]]) assert.match(validateCustomDuration(value, unit), /between 1 day and 1 year/);
});

test("profile duration and expiry status remain human readable", () => {
  assert.equal(formatDuration({ durationValue: 6, durationUnit: "months" }), "6 months session");
  assert.equal(formatDuration({ durationValue: 1, durationUnit: "year" }), "1 year session");
  assert.equal(formatDuration({ sessionLimitMinutes: 120 }), "2 hours session");
  assert.equal(formatDuration({}), "No expiration");
  assert.equal(profileStatus({ enabled: true, accessExpiresAt: 99 }, 100), "Expired");
  assert.equal(profileStatus({ enabled: false }, 100), "Disabled");
});
