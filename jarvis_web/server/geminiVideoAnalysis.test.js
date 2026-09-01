"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { analyzeVideo, privateVideoPath } = require("./geminiVideoAnalysis");

function fixture(t) {
  const binaryDir = fs.mkdtempSync(path.join(os.tmpdir(), "corex-gemini-video-"));
  const referenceId = "bin_1234567890123456";
  fs.writeFileSync(path.join(binaryDir, referenceId), Buffer.from("actual-mp4-bytes"));
  t.after(() => fs.rmSync(binaryDir, { recursive: true, force: true }));
  return { binaryDir, binary: { property: "data", referenceId }, mimeType: "video/mp4" };
}

test("uploads the private MP4, waits for processing, returns facts, and deletes the remote file", async (t) => {
  const input = fixture(t); const calls = []; let getCount = 0;
  const client = { files: {
    upload: async (request) => { calls.push(["upload", request]); return { name: "files/private", state: "PROCESSING" }; },
    get: async (request) => { calls.push(["get", request]); getCount += 1; return { name: "files/private", uri: "https://generativelanguage.googleapis.com/file/private", mimeType: "video/mp4", state: getCount > 0 ? "ACTIVE" : "PROCESSING" }; },
    delete: async (request) => { calls.push(["delete", request]); },
  }, models: { generateContent: async (request) => { calls.push(["generate", request]); return { text: JSON.stringify({ primaryObject: "electric scooter", secondaryObject: "industrial twin-shaft shredder", action: "industrial shredder crushing an electric scooter", scene: "scrap and recycling environment", visibleDetails: ["electric scooter", "industrial shredder"], confidence: 0.94 }) }; } } };
  const result = await analyzeVideo({ ...input, apiKey: "gemini-test-key", model: "gemini-test", createClient: (key) => { assert.equal(key, "gemini-test-key"); return client; }, sleep: async () => {}, logger: { error() {} } });
  assert.equal(result.primaryObject, "electric scooter"); assert.equal(result.action, "industrial shredder crushing an electric scooter");
  assert.equal(calls[0][1].file, path.join(input.binaryDir, input.binary.referenceId)); assert.equal(calls[0][1].config.mimeType, "video/mp4");
  const request = calls.find(([name]) => name === "generate")[1]; assert.equal(request.contents[0].fileData.fileUri.includes("private"), true);
  assert.match(request.contents[1].text, /ignore the filename/i); assert.doesNotMatch(JSON.stringify(request), /misleading|referenceId|gemini-test-key/i);
  assert.deepEqual(calls.at(-1), ["delete", { name: "files/private" }]);
});

test("fails closed for missing key, failed processing, low confidence, and invalid structure", async (t) => {
  const input = fixture(t);
  await assert.rejects(() => analyzeVideo({ ...input, apiKey: "" }), (error) => error.code === "gemini_not_configured");
  const run = (result) => analyzeVideo({ ...input, apiKey: "key", logger: { error() {} }, createClient: () => ({ files: { upload: async () => ({ name: "files/one", uri: "uri", mimeType: "video/mp4", state: "ACTIVE" }), delete: async () => {} }, models: { generateContent: async () => ({ text: JSON.stringify(result) }) } }) });
  await assert.rejects(() => run({ primaryObject: "object", secondaryObject: "", action: "action", scene: "scene", visibleDetails: [], confidence: 0.2 }), (error) => error.code === "gemini_low_confidence");
  await assert.rejects(() => run({ title: "generic" }), (error) => error.code === "gemini_invalid_analysis");
  await assert.rejects(() => analyzeVideo({ ...input, apiKey: "key", logger: { error() {} }, createClient: () => ({ files: { upload: async () => ({ name: "files/one", state: "FAILED" }), delete: async () => {} }, models: {} }) }), (error) => error.code === "gemini_processing_failed");
});

test("requires no media executable or system PATH", async (t) => {
  const input = fixture(t); const originalPath = process.env.PATH; process.env.PATH = "";
  try {
    await analyzeVideo({ ...input, apiKey: "key", logger: { error() {} }, createClient: () => ({ files: { upload: async () => ({ name: "files/one", uri: "uri", mimeType: "video/mp4", state: "ACTIVE" }), delete: async () => {} }, models: { generateContent: async () => ({ text: JSON.stringify({ primaryObject: "scooter", secondaryObject: "shredder", action: "shredder crushing scooter", scene: "recycling", visibleDetails: ["scooter"], confidence: 0.9 }) }) } }) });
  } finally { process.env.PATH = originalPath; }
});

test("rejects escaped and non-video private binary references", () => {
  assert.throws(() => privateVideoPath(os.tmpdir(), { referenceId: "../secret" }, "video/mp4"), /downloaded video binary/i);
  assert.throws(() => privateVideoPath(os.tmpdir(), { referenceId: "bin_1234567890123456" }, "image/jpeg"), /downloaded video/i);
});

test("logs only sanitized upload, processing, and generateContent diagnostics", async (t) => {
  const input = fixture(t); const apiKey = "gemini-super-secret-key"; const logs = [];
  const logger = { error: (label, details) => logs.push({ label, details }) };
  const providerError = (status, message, code) => Object.assign(new Error(message), { name: "ApiError", status, code });
  async function capture(createClient) {
    try { await analyzeVideo({ ...input, apiKey, model: "gemini-test-model", createClient, sleep: async () => {}, logger }); }
    catch (error) { return error; }
    throw new Error("Expected Gemini failure");
  }
  const upload = await capture(() => ({ files: { upload: async () => { throw providerError(401, `Authorization: Bearer ${apiKey} upload denied`); } } }));
  const processing = await capture(() => ({ files: { upload: async () => ({ name: "files/one", state: "PROCESSING" }), get: async () => { throw providerError(503, `x-goog-api-key=${apiKey} processing unavailable`); }, delete: async () => {} }, models: {} }));
  const generation = await capture(() => ({ files: { upload: async () => ({ name: "files/one", uri: "https://provider.invalid/private", state: "ACTIVE", mimeType: "video/mp4" }), delete: async () => {} }, models: { generateContent: async () => { throw providerError(400, `Unsupported video format at C:\\private\\bin_1234567890123456 using ${apiKey}`, "INVALID_ARGUMENT"); } } }));
  assert.equal(upload.diagnosticCode, "GEMINI_UPLOAD_401"); assert.equal(processing.diagnosticCode, "GEMINI_PROCESSING_503"); assert.equal(generation.diagnosticCode, "GEMINI_GENERATE_400");
  assert.deepEqual(logs.slice(0, 3).map((entry) => entry.details.stage), ["upload", "processing", "generateContent"]);
  assert.deepEqual(logs.slice(0, 3).map((entry) => entry.details.status), [401, 503, 400]);
  assert.equal(logs[2].details.errorName, "ApiError"); assert.equal(logs[2].details.providerCode, "INVALID_ARGUMENT"); assert.match(logs[2].details.message, /Unsupported video format/);
  assert.equal(logs[2].details.model, "gemini-test-model"); assert.equal(logs[2].details.mimeType, "video/mp4"); assert.equal(logs[2].details.fileSize, Buffer.byteLength("actual-mp4-bytes"));
  const serialized = JSON.stringify(logs);
  assert.doesNotMatch(serialized, new RegExp(apiKey)); assert.doesNotMatch(serialized, /Authorization|Bearer|actual-mp4-bytes|bin_1234567890123456|C:\\\\private/i);
});
