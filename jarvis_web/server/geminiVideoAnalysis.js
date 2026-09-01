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
  constructor(code, message) { super(message); this.name = "GeminiVideoError"; this.code = code; }
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
  pollIntervalMs = 2000, createClient = (key) => new GoogleGenAI({ apiKey: key }), sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  if (!apiKey) throw new GeminiVideoError("gemini_not_configured", "Gemini video analysis is not configured on the Corex server.");
  const filePath = privateVideoPath(binaryDir, binary, mimeType);
  const client = createClient(apiKey);
  let remoteFile;
  const deadline = Date.now() + timeoutMs;
  try {
    try {
      remoteFile = await withTimeout(client.files.upload({ file: filePath, config: { mimeType } }), timeoutMs, "gemini_upload_timeout", "Gemini video upload timed out.");
    } catch (error) {
      if (error instanceof GeminiVideoError) throw error;
      throw new GeminiVideoError("gemini_upload_failed", "Gemini could not receive the downloaded video.");
    }
    if (!remoteFile?.name) throw new GeminiVideoError("gemini_upload_failed", "Gemini could not receive the downloaded video.");
    while (fileState(remoteFile) !== "ACTIVE") {
      if (fileState(remoteFile) === "FAILED") throw new GeminiVideoError("gemini_processing_failed", "Gemini could not process the downloaded video.");
      if (Date.now() >= deadline) throw new GeminiVideoError("gemini_processing_timeout", "Gemini video processing timed out.");
      await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
      try { remoteFile = await client.files.get({ name: remoteFile.name }); }
      catch { throw new GeminiVideoError("gemini_processing_failed", "Gemini could not process the downloaded video."); }
    }
    if (!remoteFile.uri) throw new GeminiVideoError("gemini_processing_failed", "Gemini did not provide a processed video reference.");
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
      if (error instanceof GeminiVideoError) throw error;
      throw new GeminiVideoError("gemini_analysis_failed", "Gemini could not understand the downloaded video.");
    }
    let parsed;
    try { parsed = JSON.parse(responseText(response)); }
    catch { throw new GeminiVideoError("gemini_invalid_analysis", "Gemini returned invalid video analysis."); }
    return normalizeFacts(parsed);
  } finally {
    if (remoteFile?.name) {
      try { await client.files.delete({ name: remoteFile.name }); } catch { /* Remote files expire automatically; never mask the analysis result. */ }
    }
  }
}

module.exports = { BINARY_REFERENCE, DEFAULT_GEMINI_MODEL, FACT_SCHEMA, GeminiVideoError, MINIMUM_CONFIDENCE, analyzeVideo, normalizeFacts, privateVideoPath };
