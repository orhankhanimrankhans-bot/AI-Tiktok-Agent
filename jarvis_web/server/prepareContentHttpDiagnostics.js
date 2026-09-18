"use strict";
const { randomUUID } = require("node:crypto");
function trackPrepareContentHttp(req, res, logger = console, now = Date.now) {
  const correlationId = randomUUID(), started = now();
  let disconnected = false, jsonAttemptedAfterDisconnect = false;
  function emit(event) {
    const timestamp = now();
    try { logger.info("[PrepareContentHttp]", { correlationId, event, requestStartedAt: new Date(started).toISOString(),
      timestamp: new Date(timestamp).toISOString(), elapsedMs: Math.max(0, timestamp - started),
      status: res.statusCode, finished: Boolean(res.writableFinished), disconnected,
      jsonAttemptedAfterDisconnect }); } catch {}
  }
  res.setHeader("X-Corex-Request-Id", correlationId);
  req.once("aborted", () => { disconnected = true; emit("request_aborted"); });
  res.once("finish", () => emit("response_finish"));
  res.once("close", () => { disconnected ||= !res.writableFinished; emit("response_close"); });
  const originalJson = res.json;
  res.json = function (...args) {
    disconnected ||= Boolean(req.aborted) || (Boolean(res.destroyed) && !res.writableFinished);
    jsonAttemptedAfterDisconnect ||= disconnected;
    emit("json_attempt");
    return originalJson.apply(this, args);
  };
  emit("request_start");
  return correlationId;
}
module.exports = { trackPrepareContentHttp };
