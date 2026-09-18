"use strict";
const { causes } = require("./geminiUploadDiagnostics");
const MODELS = new Set(["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-lite"]);
const LIMITS = new Map();
for (const tier of ["FreeTier", "PaidTier"]) for (const [unit, category] of [["RequestsPerMinute", "RPM"], ["RequestsPerDay", "RPD"], ["TokensPerMinute", "TPM"]]) {
  LIMITS.set(`GenerateContent${unit}PerProjectPerModel-${tier}`, category);
}
for (const tier of ["FreeTier", "PaidTier"]) LIMITS.set(`GenerateContentInputTokensPerModelPerMinute-${tier}`, "TPM");
const METRICS = new Map([
  ["generativelanguage.googleapis.com/generate_content_free_tier_requests", "request_quota"],
  ["generativelanguage.googleapis.com/generate_content_paid_tier_requests", "request_quota"],
  ["generativelanguage.googleapis.com/generate_content_free_tier_input_token_count", "input_token_quota"],
  ["generativelanguage.googleapis.com/generate_content_paid_tier_input_token_count", "input_token_quota"],
]);
// Counts calls currently awaited by this process, not provider-side work after a timeout.
let active = 0;
function seconds(value) {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  if (typeof value === "string" && !/^\d+(?:\.\d+)?s?$/.test(value)) return undefined;
  const n = Number(String(value).replace(/s$/, ""));
  return Number.isFinite(n) && n >= 0 && n <= 86400 ? n : undefined;
}
function metadata(error) {
  const result = { causes: causes(error) }, seen = new Set(), quotas = [];
  for (let e = error, depth = 0; e && typeof e === "object" && depth < 4 && !seen.has(e); e = e.cause, depth++) {
    seen.add(e);
    const headers = e.response?.headers || e.headers;
    const delay = seconds(typeof headers?.get === "function" ? headers.get("retry-after") : headers?.["retry-after"] ?? headers?.["Retry-After"]);
    if (delay !== undefined) result.retryAfterSeconds = delay;
    let body = e.response?.data?.error || e.error;
    if (!body && e.name === "ApiError" && typeof e.message === "string" && e.message.length < 65536) { try { body = JSON.parse(e.message)?.error; } catch {} }
    for (const detail of (Array.isArray(body?.details) ? body.details : []).slice(0, 8)) {
      if (detail?.["@type"] === "type.googleapis.com/google.rpc.RetryInfo") {
        const delay = seconds(detail.retryDelay);
        if (delay !== undefined) result.retryDelaySeconds = delay;
      }
      if (detail?.["@type"] === "type.googleapis.com/google.rpc.QuotaFailure") {
        for (const v of (Array.isArray(detail.violations) ? detail.violations : []).slice(0, 8)) {
          if (LIMITS.has(v?.quotaId)) quotas.push({ limitIdentifier: v.quotaId, category: LIMITS.get(v.quotaId) });
          else if (METRICS.has(v?.quotaMetric)) quotas.push({ category: METRICS.get(v.quotaMetric) });
        }
      }
    }
  }
  if (quotas.length) result.quotas = quotas.slice(0, 8);
  return result;
}
function emit(logger, fields) { try { logger?.info?.("[GeminiInferenceDiagnostic]", fields); } catch {} }
async function observe({ logger, correlationId, attempt, model, fileActive, classify, maxAttempts }, run) {
  const base = { correlationId, attempt, stage: "generateContent", model: MODELS.has(model) ? model : "other", fileActive: Boolean(fileActive) };
  active++;
  emit(logger, { ...base, event: "start", concurrentInferenceCalls: active });
  try {
    const result = await run();
    emit(logger, { ...base, event: "success", concurrentInferenceCalls: active });
    return result;
  } catch (error) {
    try {
      const failure = classify(error), retryable = Boolean(failure.retryable);
      emit(logger, { ...base, event: "failure", concurrentInferenceCalls: active, ...metadata(error), retryable,
        willRetry: retryable && attempt < maxAttempts,
        classificationReason: !retryable ? "non_retryable" : attempt >= maxAttempts ? "budget_exhausted" : "known_transient",
        classificationCode: failure.code });
    } catch {} // Diagnostic extraction must never replace the original error.
    throw error;
  } finally {
    active--;
    emit(logger, { ...base, event: "end", concurrentInferenceCalls: active });
  }
}
module.exports = { metadata, observe };
