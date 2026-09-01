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
  constructor(code, message, diagnosticCode = "") { super(message); this.name = "GeminiVideoError"; this.code = code; this.diagnosticCode = diagnosticCode; }
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
  const status = providerStatus(error);
  if (status) return `GEMINI_${label}_${status}`;
  const providerCode = String(error?.code || "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  return `GEMINI_${label}_${providerCode || "FAILED"}`;
}

function logFailure({ logger, stage, model, error, apiKey, state, mimeType, fileSize, startedAt }) {
  const diagnostic = diagnosticCode(stage, error);
  logger?.error?.("[GeminiVideoAnalysis]", {
    stage, model, ...(providerStatus(error) ? { status: providerStatus(error) } : {}), ...(providerCode(error) ? { providerCode: providerCode(error) } : {}),
    errorName: String(error?.name || "Error").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80) || "Error",
    message: safeProviderMessage(error, apiKey), ...(state ? { fileState: String(state).slice(0, 40) } : {}),
    mimeType: String(mimeType || "").slice(0, 100), fileSize, elapsedMs: Math.max(0, Date.now() - startedAt), diagnosticCode: diagnostic,
  });
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
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new GeminiVideoError("gemini_invalid_analysis", "Gemini returned invalid video analysis.");
  const primaryObject = boundedFact(value.primaryObject, 200, true);
  const secondaryObject = boundedFact(value.secondaryObject, 200);
  const action = boundedFact(value.action, 300, true);
  const scene = boundedFact(value.scene, 300);
  const visibleDetails = Array.isArray(value.visibleDetails) ? value.visibleDetails.map((item) => boundedFact(item, 200)).filter(Boolean).slice(0, 20) : null;
  const confidence = Number(value.confidence);
  if (!primaryObject || secondaryObject === null || !action || scene === null || !visibleDetails || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new GeminiVideoError("gemini_invalid_analysis", "Gemini returned invalid video analysis.");
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
    return await Promise.race([operation, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new GeminiVideoError(code, message)), timeoutMs); })]);
  } finally { clearTimeout(timer); }
}

async function analyzeVideo({ binaryDir, binary, mimeType, apiKey, model = DEFAULT_GEMINI_MODEL, timeoutMs = 120000,
  pollIntervalMs = 2000, createClient = (key) => new GoogleGenAI({ apiKey: key }), sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), logger = console }) {
  if (!apiKey) throw new GeminiVideoError("gemini_not_configured", "Gemini video analysis is not configured on the Corex server.");
  const filePath = privateVideoPath(binaryDir, binary, mimeType);
  const fileSize = fs.statSync(filePath).size;
  const startedAt = Date.now();
  const client = createClient(apiKey);
  let remoteFile;
  const deadline = Date.now() + timeoutMs;
  try {
    try {
      remoteFile = await withTimeout(client.files.upload({ file: filePath, config: { mimeType } }), timeoutMs, "gemini_upload_timeout", "Gemini video upload timed out.");
    } catch (error) {
      const diagnostic = logFailure({ logger, stage: "upload", model, error, apiKey, mimeType, fileSize, startedAt });
      if (error instanceof GeminiVideoError) { error.diagnosticCode = diagnostic; throw error; }
      throw new GeminiVideoError("gemini_upload_failed", "Gemini could not receive the downloaded video.", diagnostic);
    }
    if (!remoteFile?.name) { const error = new Error("Gemini upload returned no file resource name."); const diagnostic = logFailure({ logger, stage: "upload", model, error, apiKey, mimeType, fileSize, startedAt }); throw new GeminiVideoError("gemini_upload_failed", "Gemini could not receive the downloaded video.", diagnostic); }
    while (fileState(remoteFile) !== "ACTIVE") {
      if (fileState(remoteFile) === "FAILED") { const providerError = Object.assign(new Error(remoteFile?.error?.message || "Gemini file processing failed."), { code: remoteFile?.error?.code }); const diagnostic = logFailure({ logger, stage: "processing", model, error: providerError, apiKey, state: fileState(remoteFile), mimeType, fileSize, startedAt }); throw new GeminiVideoError("gemini_processing_failed", "Gemini could not process the downloaded video.", diagnostic); }
      if (Date.now() >= deadline) { const error = new GeminiVideoError("gemini_processing_timeout", "Gemini video processing timed out."); error.diagnosticCode = logFailure({ logger, stage: "processing", model, error, apiKey, state: fileState(remoteFile), mimeType, fileSize, startedAt }); throw error; }
      await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
      try { remoteFile = await client.files.get({ name: remoteFile.name }); }
      catch (error) { const diagnostic = logFailure({ logger, stage: "processing", model, error, apiKey, state: fileState(remoteFile), mimeType, fileSize, startedAt }); throw new GeminiVideoError("gemini_processing_failed", "Gemini could not process the downloaded video.", diagnostic); }
    }
    if (!remoteFile.uri) { const error = new Error("Processed Gemini file has no usable URI."); const diagnostic = logFailure({ logger, stage: "processing", model, error, apiKey, state: fileState(remoteFile), mimeType, fileSize, startedAt }); throw new GeminiVideoError("gemini_processing_failed", "Gemini did not provide a processed video reference.", diagnostic); }
    let response;
    try {
      response = await withTimeout(client.models.generateContent({
        model,
        contents: [
          { fileData: { fileUri: remoteFile.uri, mimeType: remoteFile.mimeType || mimeType } },
          { text: "Inspect the entire short video and return factual visual analysis only. Identify the real primary object, any important secondary object, the actual action, the scene, and concrete visible details. Ignore the filename completely. Do not create a title, caption, hashtags, or marketing copy. Do not guess; use broader terminology when uncertain and lower confidence." },
        ],
        config: { temperature: 0, maxOutputTokens: 700, responseMimeType: "application/json", responseJsonSchema: FACT_SCHEMA },
      }), Math.max(1, deadline - Date.now()), "gemini_analysis_timeout", "Gemini video understanding timed out.");
    } catch (error) {
      const diagnostic = logFailure({ logger, stage: "generateContent", model, error, apiKey, state: fileState(remoteFile), mimeType, fileSize, startedAt });
      if (error instanceof GeminiVideoError) { error.diagnosticCode = diagnostic; throw error; }
      throw new GeminiVideoError("gemini_analysis_failed", "Gemini could not understand the downloaded video.", diagnostic);
    }
    try { return normalizeFacts(JSON.parse(responseText(response))); }
    catch (error) { const diagnostic = logFailure({ logger, stage: "structuredParse", model, error, apiKey, state: fileState(remoteFile), mimeType, fileSize, startedAt }); throw new GeminiVideoError(error?.code === "gemini_low_confidence" ? error.code : "gemini_invalid_analysis", error?.code === "gemini_low_confidence" ? error.message : "Gemini returned invalid video analysis.", diagnostic); }
  } finally {
    if (remoteFile?.name) {
      try { await client.files.delete({ name: remoteFile.name }); }
      catch (error) { logFailure({ logger, stage: "cleanup", model, error, apiKey, state: fileState(remoteFile), mimeType, fileSize, startedAt }); }
    }
  }
}

module.exports = { BINARY_REFERENCE, DEFAULT_GEMINI_MODEL, FACT_SCHEMA, GeminiVideoError, MINIMUM_CONFIDENCE, analyzeVideo, diagnosticCode, normalizeFacts, privateVideoPath, safeProviderMessage };
