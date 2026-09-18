"use strict";
const { metadata } = require("./geminiInferenceDiagnostics");
const MAX_PROVIDER_DELAY_MS = 120000;
function guidance(error) {
  try {
    const data = metadata(error);
    const values = [data.retryDelaySeconds, data.retryAfterSeconds].filter(n => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 86400);
    return { delayMs: values.length ? Math.min(MAX_PROVIDER_DELAY_MS, Math.ceil(Math.max(...values) * 1000)) : 0,
      requestQuota: Boolean(data.quotas?.some(q => ["request_quota", "RPM", "RPD"].includes(q.category))) };
  } catch { return { delayMs: 0, requestQuota: false }; }
}
function createCooldown(now = Date.now) {
  let until = 0;
  return {
    record(delayMs) { if (Number.isFinite(delayMs) && delayMs > 0) until = Math.max(until, now() + Math.min(delayMs, MAX_PROVIDER_DELAY_MS)); },
    async wait(sleep) {
      const deadline = now() + MAX_PROVIDER_DELAY_MS;
      while (until > now()) {
        const remaining = Math.min(until, deadline) - now();
        if (remaining <= 0) {
          const error = new Error("Gemini shared cooldown is still active. Try again later.");
          error.code = "gemini_cooldown_wait_timeout";
          throw error;
        }
        await sleep(remaining);
      }
    },
  };
}
const sharedCooldown = createCooldown();
module.exports = { MAX_PROVIDER_DELAY_MS, guidance, createCooldown, sharedCooldown };
