const uploadDiagnostics = require("./geminiUploadDiagnostics");
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { GoogleGenAI } = require("@google/genai");

const BINARY_REFERENCE = /^bin_[A-Za-z0-9_-]{16,128}$/;
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const MINIMUM_CONFIDENCE = 0.65;
const FACT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["primaryObject", "secondaryObject", "action", "scene", "visibleDetails", "confidence"],
  properties: {
    primaryObject: { type: "string", maxLength: 200 },
    secondaryObject: { type: "string", maxLength: 200 },
    action: { type: "string", maxLength: 300 },
    scene: { type: "string", maxLength: 300 },
    visibleDetails: { type: "array", maxItems: 20, items: { type: "string", maxLength: 200 } },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
});

class GeminiVideoError extends Error {
  constructor(code, message, diagnosticCode = "", retryable = false) { super(message); this.retryable = retryable; this.name = "GeminiVideoError"; this.code = code; this.diagnosticCode = diagnosticCode; }
}

function providerStatus(error) {
  for (const value of [error?.status, error?.statusCode, error?.response?.status, error?.code]) {
    const status = Number(value); if (Number.isInteger(status) && status >= 100 && status <= 599) return status;
  }
  return undefined;
}

function providerCode(error) {
  const code = String(error?.code || "").toUpperCase().replace(/[^A-Z0-9_.-]/g, "").slice(0, 80);
  return code && !/^\d{3}$/.test(code) ? code : "";
}

function safeProviderMessage(error, apiKey) {
  let message = typeof error?.message === "string" ? error.message : "Provider request failed.";
  if (apiKey) message = message.split(apiKey).join("[redacted]");
  return message
    .replace(/authorization\s*[:=]?\s*bearer\s+[^\s,;]+/gi, "[redacted-secret]")
    .replace(/(x-goog-api-key|api[_ -]?key|access[_ -]?token|refresh[_ -]?token)\s*[:=]\s*[^\s,;]+/gi, "[redacted-secret]")
    .replace(/https?:\/\/[^\s"']+/gi, "[url]")
    .replace(/[A-Za-z]:\\[^\r\n"']+/g, "[path]")
    .replace(/bin_[A-Za-z0-9_-]{16,128}/g, "[binary-reference]")
    .replace(/[\r\n\t]+/g, " ").trim().slice(0, 400) || "Provider request failed.";
}

function diagnosticCode(stage, error) {
  const label = { upload: "UPLOAD", processing: "PROCESSING", generateContent: "GENERATE", structuredParse: "STRUCTURED_PARSE", cleanup: "CLEANUP" }[stage] || "UNKNOWN";
  return `GEMINI_${label}_${providerStatus(error) || "FAILED"}`;
}
function logFailure({ logger, stage, error }) {
  const diagnostic = diagnosticCode(stage, error);
  logger?.error?.("[GeminiVideoAnalysis]", { stage, diagnosticCode: diagnostic,
    ...(providerStatus(error) ? { status: providerStatus(error) } : {}) });
  return diagnostic;
}

function privateVideoPath(binaryDir, binary, mimeType) {
  if (!String(mimeType || "").toLowerCase().startsWith("video/")) throw new GeminiVideoError("visual_analysis_requires_video", "Prepare Content requires a downloaded video.");
  const referenceId = String(binary?.referenceId || "");
  if (!BINARY_REFERENCE.test(referenceId)) throw new GeminiVideoError("visual_analysis_missing_binary", "Prepare Content requires the downloaded video binary.");
  const root = path.resolve(binaryDir);
  const filePath = path.resolve(root, referenceId);
  const relative = path.relative(root, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(filePath)) throw new GeminiVideoError("visual_analysis_binary_not_found", "The downloaded video is unavailable for visual analysis.");
  return filePath;
}

function boundedFact(value, maximum, required = false) {
  if (typeof value !== "string") return required ? null : "";
  const text = value.trim();
  if ((required && !text) || text.length > maximum) return null;
  return text;
}

function normalizeFacts(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new GeminiVideoError("gemini_invalid_analysis", "Gemini returned invalid video analysis.", "", true);
  const primaryObject = boundedFact(value.primaryObject, 200, true);
  const secondaryObject = boundedFact(value.secondaryObject, 200);
  const action = boundedFact(value.action, 300, true);
  const scene = boundedFact(value.scene, 300);
  const visibleDetails = Array.isArray(value.visibleDetails) ? value.visibleDetails.map((item) => boundedFact(item, 200)).filter(Boolean).slice(0, 20) : null;
  const confidence = Number(value.confidence);
  if (!primaryObject || secondaryObject === null || !action || scene === null || !visibleDetails || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new GeminiVideoError("gemini_invalid_analysis", "Gemini returned invalid video analysis.", "", true);
  }
  if (confidence < MINIMUM_CONFIDENCE) throw new GeminiVideoError("gemini_low_confidence", "Gemini could not identify the video's object and action confidently enough.");
  return { primaryObject, secondaryObject, action, scene, visibleDetails, confidence };
}

function responseText(response) {
  return typeof response?.text === "function" ? response.text() : String(response?.text || "");
}

function fileState(file) { return String(file?.state?.name || file?.state || "").toUpperCase(); }

async function withTimeout(operation, timeoutMs, code, message) {
  let timer;
  try {
    return await Promise.race([operation, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new GeminiVideoError(code, message, "", true)), timeoutMs); })]);
  } finally { clearTimeout(timer); }
}

function providerPayload(error) {
  let payload = error?.response?.data?.error || error?.error;
  // SDK 2.20.0 keeps the JSON error body in ApiError.message. Inspect only for
  // classification; neither this body nor its message is ever logged/returned.
  if (!payload && error?.name === "ApiError" && typeof error.message === "string" && error.message.length < 65536) {
    try { payload = JSON.parse(error.message)?.error; } catch { /* Not a JSON provider response. */ }
  }
  return payload;
}

function fileNotReady(error) {
  // Narrowly recognize readiness failures, never arbitrary INVALID_ARGUMENT errors.
  if (![400, 409, 412].includes(providerStatus(error))) return false;
  const message = String(providerPayload(error)?.message || error?.message || "").slice(0, 65536);
  return /(?:file|video|media)\b[^\n]{0,500}(?:not\b[^\n]{0,40}\b(?:active|ready)|still\s+(?:being\s+)?process|processing\s+(?:state|not\s+complete)|currently\b[^\n]{0,40}\bprocessing)/i.test(message);
}

const RETRY_DELAYS_MS = Object.freeze([3000, 8000, 15000]);
function isRetryable(error) {
  if (error instanceof GeminiVideoError) return error.retryable;
  if (fileNotReady(error)) return true;
  const status = providerStatus(error);
  if (status) return [408, 429, 500, 502, 503, 504].includes(status);
  return ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_SOCKET"].includes(error?.code || error?.cause?.code)
    || ["AbortError", "TimeoutError"].includes(error?.name);
}
function classifyFailure(error, stage) {
  if (error instanceof GeminiVideoError) { error.diagnosticCode ||= diagnosticCode(stage, error); return error; }
  const status = providerStatus(error);
  let code = "gemini_analysis_failed", message = "The Gemini service request failed.";
  if (fileNotReady(error)) { code = "gemini_file_not_ready"; message = "The uploaded video is not ready for analysis yet. Try again shortly."; }
  else if (status === 429) { code = "gemini_rate_limited"; message = "Gemini quota or rate limit reached. Try again later."; }
  else if ([500, 502, 503].includes(status)) { code = "gemini_temporarily_unavailable"; message = "Gemini is temporarily unavailable. Try again later."; }
  else if (status === 401) { code = "gemini_authentication_failed"; message = "Gemini credentials could not be authenticated."; }
  else if (status === 403) { code = "gemini_permission_denied"; message = "Gemini denied access to this resource."; }
  else if (status === 413) { code = "visual_analysis_video_too_large"; message = "The video exceeds the provider size limit."; }
  else if ([408, 504].includes(status) || ["AbortError", "TimeoutError"].includes(error?.name)) { code = "gemini_analysis_timeout"; message = "The Gemini request timed out."; }
  else if (status === 400) { code = "gemini_processing_failed"; message = "Gemini rejected the video or analysis request."; }
  else if (stage === "upload") { code = "gemini_upload_failed"; message = "The Gemini video upload failed."; }
  return new GeminiVideoError(code, message, diagnosticCode(stage, error), isRetryable(error));
}
function geminiHttpStatus(error) {
  if (/timeout$/.test(error.code)) return 504;
  return ({ gemini_file_not_ready: 503, gemini_rate_limited: 429, gemini_temporarily_unavailable: 503,
    gemini_authentication_failed: 502, gemini_permission_denied: 502, gemini_upload_failed: 502,
    gemini_upload_retry_exhausted: 503, gemini_upload_network_failed: 503, gemini_upload_local_read_failed: 422, gemini_upload_invalid_file: 422, gemini_upload_unconfirmed: 502, gemini_analysis_failed: 502, gemini_invalid_analysis: 502, visual_analysis_video_too_large: 413 })[error.code] || 422;
}
async function parseAnalysisResponse(response) {
  const finish = response?.candidates?.[0]?.finishReason;
  if (response?.promptFeedback?.blockReason || (finish && !["STOP", "MAX_TOKENS"].includes(finish)))
    throw new GeminiVideoError("gemini_analysis_blocked", "Gemini declined this video analysis request.");
  if (finish === "MAX_TOKENS") throw new GeminiVideoError("gemini_invalid_analysis", "Gemini returned truncated video analysis.", "", true);
  const text = await responseText(response);
  if (!text.trim()) throw new GeminiVideoError("gemini_invalid_analysis", "Gemini returned an empty video analysis response.", "", true);
  let parsed;
  try { parsed = JSON.parse(text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, "$1")); }
  catch { throw new GeminiVideoError("gemini_invalid_analysis", "Gemini returned incomplete or invalid video analysis JSON.", "", true); }
  return normalizeFacts(parsed);
}

const UPLOAD_RETRY_DELAYS_MS = Object.freeze([1000, 3000]);
const NETWORK_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET"]);
function classifyUpload(error) {
  const chain = []; const seen = new Set();
  for (let e = error; e && typeof e === "object" && chain.length < 8 && !seen.has(e); e = e.cause) { chain.push(e); seen.add(e); }
  const statusError = chain.find(e => providerStatus(e));
  if ([400, 415].includes(providerStatus(statusError))) return new GeminiVideoError("gemini_upload_rejected", "Gemini rejected the uploaded video or its media type.", diagnosticCode("upload", statusError));
  if (statusError) return classifyFailure(statusError, "upload");
  const local = chain.find(e => ["ENOENT", "EACCES", "EPERM", "EISDIR", "EIO"].includes(e.code));
  if (local) return new GeminiVideoError("gemini_upload_local_read_failed", "The downloaded video could not be read for upload.", "GEMINI_UPLOAD_LOCAL_READ");
  if (chain.some(e => NETWORK_CODES.has(e.code) || ["AbortError", "TimeoutError"].includes(e.name)))
    return new GeminiVideoError("gemini_upload_network_failed", "The connection to Gemini failed while uploading the video. Try again shortly.", "GEMINI_UPLOAD_NETWORK", true);
  return classifyFailure(error, "upload");
}

function developerUploadConfig(filePath, mimeType, fileSize, timeoutMs) {
  // SDK 2.20.0 replaces initialization defaults when per-call httpOptions exist.
  // Its upload path already includes v1beta; retain the SDK's resumable headers.
  return { mimeType, httpOptions: {
    apiVersion: "", retryOptions: { attempts: 1 }, timeout: timeoutMs,
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(fileSize),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "X-Goog-Upload-File-Name": path.basename(filePath),
    },
  } };
}

async function uploadVideo({ session, client, filePath, mimeType, timeoutMs, sleep, logger }) {
  for (;;) {
    if ((session.uploadAttempts || 0) >= UPLOAD_RETRY_DELAYS_MS.length + 1)
      throw new GeminiVideoError("gemini_upload_retry_exhausted", "Gemini could not prepare a usable video after three uploads. Try again later.");
    session.uploadAttempts = (session.uploadAttempts || 0) + 1;
    let pending, timedOut = false;
    let uploadSubstage = "pre_upload_validation";
    const diagnostic = (event, extra = {}) => uploadDiagnostics.emit(logger, { correlationId: session.correlationId, attempt: session.uploadAttempts, event, substage: uploadSubstage, ...uploadDiagnostics.metadata(filePath, mimeType, session.fileName), ...extra });
    diagnostic("validation");
    try {
      const stat = fs.statSync(filePath); fs.accessSync(filePath, fs.constants.R_OK);
      if (!stat.isFile() || !stat.size) throw new GeminiVideoError("gemini_upload_invalid_file", "The downloaded video is empty or is not a readable file.");
      // Pass a path on every attempt: the SDK opens and closes a fresh file handle.
      uploadSubstage = "sdk_upload_initialization";
      diagnostic("before_sdk_upload");
      uploadSubstage = "sdk_upload_unknown";
      pending = client.files.upload({ file: filePath, config: developerUploadConfig(filePath, mimeType, stat.size, timeoutMs) });
      let file;
      try { file = await withTimeout(pending, timeoutMs, "gemini_upload_timeout", "Gemini upload timed out; completion could not be confirmed. Try again later."); }
      catch (error) { timedOut = error.code === "gemini_upload_timeout"; throw error; }
      uploadSubstage = "provider_file_response_handling";
      diagnostic("response", { confirmedFile: Boolean(file?.name) });
      if (!file?.name) throw new GeminiVideoError("gemini_upload_unconfirmed", "Gemini did not confirm the uploaded file. Try again later.");
      return file;
    } catch (error) {
      const failure = classifyUpload(error);
      diagnostic("failure", { substage: uploadDiagnostics.substage(error, uploadSubstage), causes: uploadDiagnostics.causes(error), retryable: Boolean(failure.retryable), willRetry: !timedOut && failure.retryable && session.uploadAttempts <= UPLOAD_RETRY_DELAYS_MS.length, classificationReason: timedOut ? "unconfirmed_timeout" : !failure.retryable ? "non_retryable" : session.uploadAttempts > UPLOAD_RETRY_DELAYS_MS.length ? "budget_exhausted" : "known_transient", classificationCode: failure.code });
      logger?.error?.("[GeminiVideoAnalysis] upload", { stage: "upload", attempt: session.uploadAttempts, diagnosticCode: failure.diagnosticCode || diagnosticCode("upload", error), code: failure.code, ...(providerStatus(error) ? { status: providerStatus(error) } : {}) });
      // SDK uploads can outlive a caller timeout. Never start a concurrent replacement.
      if (timedOut) {
        pending.then(file => file?.name && cleanupDeveloperFile({ client, remoteFile: file }, { logger })).catch(() => {});
      }
      if (timedOut || !failure.retryable || session.uploadAttempts > UPLOAD_RETRY_DELAYS_MS.length) { failure.retryable = false; throw failure; }
      await sleep(UPLOAD_RETRY_DELAYS_MS[session.uploadAttempts - 1]);
    }
  }
}

async function analyzeAttempt({ session, binaryDir, binary, mimeType, apiKey, model = DEFAULT_GEMINI_MODEL, timeoutMs = 120000,
  pollIntervalMs = 2000, createClient = (key) => new GoogleGenAI({ apiKey: key }), sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), logger = console }) {
  if (!apiKey) throw new GeminiVideoError("gemini_not_configured", "Gemini video analysis is not configured on the Corex server.");
  const filePath = privateVideoPath(binaryDir, binary, mimeType);
  const fileSize = fs.statSync(filePath).size;
  const startedAt = Date.now();
  const client = session.client || (session.client = createClient(apiKey));
  let remoteFile = session.remoteFile || await uploadVideo({ session, client, filePath, mimeType, timeoutMs, sleep, logger });
  const deadline = Date.now() + timeoutMs;
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    while (fileState(remoteFile) !== "ACTIVE") {
      if (fileState(remoteFile) === "FAILED") { const providerError = Object.assign(new Error(remoteFile?.error?.message || "Gemini file processing failed."), { code: remoteFile?.error?.code }); const diagnostic = logFailure({ logger, stage: "processing", model, error: providerError, apiKey, state: fileState(remoteFile), mimeType, fileSize, startedAt }); throw new GeminiVideoError("gemini_processing_failed", "Gemini could not process the downloaded video.", diagnostic, [4, 8, 10, 13, 14].includes(Number(remoteFile?.error?.code))); }
      if (Date.now() >= deadline) { const error = new GeminiVideoError("gemini_processing_timeout", "Gemini video processing timed out.", "", true); error.diagnosticCode = logFailure({ logger, stage: "processing", model, error, apiKey, state: fileState(remoteFile), mimeType, fileSize, startedAt }); throw error; }
      await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
      try { remoteFile = await withTimeout(client.files.get({ name: remoteFile.name, config: { abortSignal: controller.signal, httpOptions: { retryOptions: { attempts: 1 }, timeout: Math.max(1, deadline - Date.now()) } } }), Math.max(1, deadline - Date.now()), "gemini_processing_timeout", "Gemini video processing timed out."); }
      catch (error) { const diagnostic = logFailure({ logger, stage: "processing", model, error, apiKey, state: fileState(remoteFile), mimeType, fileSize, startedAt }); throw classifyFailure(error, "processing"); }
    }
    if (!remoteFile.uri) { remoteFile = { ...remoteFile, state: "PROCESSING" }; const error = new Error("Processed Gemini file has no usable URI."); const diagnostic = logFailure({ logger, stage: "processing", model, error, apiKey, state: fileState(remoteFile), mimeType, fileSize, startedAt }); throw new GeminiVideoError("gemini_processing_failed", "Gemini did not provide a processed video reference.", diagnostic, true); }
    let response;
    try {
      response = await withTimeout(client.models.generateContent({
        model,
        contents: [
          { fileData: { fileUri: remoteFile.uri, mimeType: remoteFile.mimeType || mimeType } },
          { text: "Inspect the entire short video and return factual visual analysis only. Identify the real primary object, any important secondary object, the actual action, the scene, and concrete visible details. Ignore the filename completely. Do not create a title, caption, hashtags, or marketing copy. Do not guess; use broader terminology when uncertain and lower confidence." },
        ],
        config: { abortSignal: controller.signal, httpOptions: { retryOptions: { attempts: 1 }, timeout: Math.max(1, deadline - Date.now()) }, temperature: 0, maxOutputTokens: 700, responseMimeType: "application/json", responseJsonSchema: FACT_SCHEMA },
      }), Math.max(1, deadline - Date.now()), "gemini_analysis_timeout", "Gemini video understanding timed out.");
    } catch (error) {
      const diagnostic = logFailure({ logger, stage: "generateContent", model, error, apiKey, state: fileState(remoteFile), mimeType, fileSize, startedAt });
      if (error instanceof GeminiVideoError) { error.diagnosticCode = diagnostic; throw error; }
      const failure = classifyFailure(error, "generateContent");
      // ACTIVE can be stale at inference time. Re-poll this same resource on retry.
      if (failure.code === "gemini_file_not_ready") remoteFile = { ...remoteFile, state: "PROCESSING" };
      throw failure;
    }
    try { return await parseAnalysisResponse(response); }
    catch (error) { const diagnostic = logFailure({ logger, stage: "structuredParse", model, error, apiKey, state: fileState(remoteFile), mimeType, fileSize, startedAt }); if (error instanceof GeminiVideoError) { error.diagnosticCode = diagnostic; throw error; } throw new GeminiVideoError("gemini_invalid_analysis", "Gemini returned invalid video analysis.", diagnostic, error.retryable); }
  } finally {
    clearTimeout(abortTimer);
    controller.abort();
    session.remoteFile = remoteFile;
  }
}

async function cleanupDeveloperFile(session, options) {
  const remoteFile = session.remoteFile;
  session.remoteFile = undefined;
  if (!remoteFile?.name) return;
  try { await withTimeout(session.client.files.delete({ name: remoteFile.name, config: { abortSignal: AbortSignal.timeout(10000), httpOptions: { retryOptions: { attempts: 1 }, timeout: 10000 } } }), 10000, "gemini_cleanup_timeout", "Gemini cleanup timed out."); }
  catch (error) { logFailure({ logger: options.logger || console, stage: "cleanup", model: options.model || DEFAULT_GEMINI_MODEL, error, mimeType: options.mimeType, startedAt: Date.now() }); }
}

async function analyzeVideo(options) {
  const { sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = options;
  if (!options.apiKey) throw new GeminiVideoError("gemini_not_configured", "Gemini video analysis is not configured on the Corex server.");
  if ((options.timeoutMs != null && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0 || options.timeoutMs > 120000))
    || (options.pollIntervalMs != null && (!Number.isFinite(options.pollIntervalMs) || options.pollIntervalMs <= 0)))
    throw new GeminiVideoError("gemini_invalid_configuration", "Gemini timeout configuration is invalid.");
  privateVideoPath(options.binaryDir, options.binary, options.mimeType);
  const session = { correlationId: uploadDiagnostics.newCorrelationId(), fileName: "video" + (options.fileExtension || "") };
  try {
    for (let attempt = 0; ; attempt++) {
      try { return await analyzeAttempt({ ...options, sleep, session }); }
      catch (error) {
        if (!isRetryable(error) || attempt >= RETRY_DELAYS_MS.length) throw error;
        if (fileState(session.remoteFile) === "FAILED") await cleanupDeveloperFile(session, options);
        if (!session.remoteFile?.name) session.remoteFile = undefined;
        (options.logger || console).warn?.("[GeminiVideoAnalysis] retry", { attempt: attempt + 1, nextAttempt: attempt + 2,
          delayMs: RETRY_DELAYS_MS[attempt], diagnosticCode: error.diagnosticCode });
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
  } finally { await cleanupDeveloperFile(session, options); }
}

module.exports = { developerUploadConfig, UPLOAD_RETRY_DELAYS_MS, classifyUpload, RETRY_DELAYS_MS, isRetryable, classifyFailure, geminiHttpStatus, BINARY_REFERENCE, DEFAULT_GEMINI_MODEL, FACT_SCHEMA, GeminiVideoError, MINIMUM_CONFIDENCE, analyzeVideo, diagnosticCode, normalizeFacts, privateVideoPath, safeProviderMessage };
