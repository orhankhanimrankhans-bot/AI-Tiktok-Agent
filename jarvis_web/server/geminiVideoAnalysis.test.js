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
  assert.equal(calls.at(-1)[0], "delete"); assert.equal(calls.at(-1)[1].name, "files/private");
});

test("fails closed for missing key, failed processing, low confidence, and invalid structure", async (t) => {
  const input = fixture(t);
  await assert.rejects(() => analyzeVideo({ ...input, apiKey: "" }), (error) => error.code === "gemini_not_configured");
  const run = (result) => analyzeVideo({ ...input, apiKey: "key", sleep: async () => {}, logger: { error() {} }, createClient: () => ({ files: { upload: async () => ({ name: "files/one", uri: "uri", mimeType: "video/mp4", state: "ACTIVE" }), delete: async () => {} }, models: { generateContent: async () => ({ text: JSON.stringify(result) }) } }) });
  await assert.rejects(() => run({ primaryObject: "object", secondaryObject: "", action: "action", scene: "scene", visibleDetails: [], confidence: 0.2 }), (error) => error.code === "gemini_low_confidence");
  await assert.rejects(() => run({ title: "generic" }), (error) => error.code === "gemini_invalid_analysis");
  await assert.rejects(() => analyzeVideo({ ...input, apiKey: "key", sleep: async () => {}, logger: { error() {} }, createClient: () => ({ files: { upload: async () => ({ name: "files/one", state: "FAILED" }), delete: async () => {} }, models: {} }) }), (error) => error.code === "gemini_processing_failed");
});

test("requires no media executable or system PATH", async (t) => {
  const input = fixture(t); const originalPath = process.env.PATH; process.env.PATH = "";
  try {
    await analyzeVideo({ ...input, apiKey: "key", sleep: async () => {}, logger: { error() {} }, createClient: () => ({ files: { upload: async () => ({ name: "files/one", uri: "uri", mimeType: "video/mp4", state: "ACTIVE" }), delete: async () => {} }, models: { generateContent: async () => ({ text: JSON.stringify({ primaryObject: "scooter", secondaryObject: "shredder", action: "shredder crushing scooter", scene: "recycling", visibleDetails: ["scooter"], confidence: 0.9 }) }) } }) });
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
  assert.deepEqual([...new Set(logs.map((entry) => entry.details.stage))], ["upload", "processing", "generateContent"]);
  assert.deepEqual([...new Set(logs.map(entry => entry.details.status))], [401, 503, 400]);
  assert.ok(logs.every(entry => Object.keys(entry.details).every(key => ["stage", "status", "diagnosticCode"].includes(key))));
  const serialized = JSON.stringify(logs);
  assert.doesNotMatch(serialized, new RegExp(apiKey)); assert.doesNotMatch(serialized, /Authorization|Bearer|actual-mp4-bytes|bin_1234567890123456|C:\\\\private/i);
});

const facts = { primaryObject: "scooter", secondaryObject: "", action: "moving", scene: "road", visibleDetails: [], confidence: 0.9 };

test("empty, truncated and recognized network failures recover without reupload", async t => {
  for (const mode of ["empty", "truncated", "network"]) {
    const calls = [], delays = []; let attempts = 0;
    const client = mockClient(async request => {
      assert.equal(request.config.httpOptions.retryOptions.attempts, 1);
      if (++attempts === 1) {
        if (mode === "network") throw Object.assign(new Error("private network detail"), { cause: { code: "ECONNRESET" } });
        return { text: "", ...(mode === "truncated" ? { candidates: [{ finishReason: "MAX_TOKENS" }] } : {}) };
      }
      return { text: JSON.stringify(facts) };
    }, calls);
    assert.deepEqual(await analyzeVideo({ ...fixture(t), apiKey: "key", logger: {}, createClient: () => client, sleep: async ms => delays.push(ms) }), facts);
    assert.equal(attempts, 2); assert.deepEqual(delays, [3000]); assert.deepEqual(calls, ["upload", "delete"]);
  }
});

test("upload completes before inference and temporary FAILED resource alone is replaced", async t => {
  let releaseUpload, notify; const pending = new Promise(r => { releaseUpload = r; }); const started = new Promise(r => { notify = r; });
  let generated = false;
  const client = mockClient(async () => { generated = true; return { text: JSON.stringify(facts) }; });
  client.files.upload = async () => { notify(); await pending; return { name: "files/ready", uri: "uri", state: "ACTIVE" }; };
  const run = analyzeVideo({ ...fixture(t), apiKey: "key", logger: {}, createClient: () => client });
  await started; assert.equal(generated, false); releaseUpload(); assert.deepEqual(await run, facts);
  for (const code of [13, 3, undefined]) {
    let uploads = 0, deletes = 0;
    const mock = mockClient(async () => ({ text: JSON.stringify(facts) }));
    mock.files.upload = async () => ++uploads === 1 ? { name: "files/failed", state: "FAILED", error: { code } } : { name: "files/ready", uri: "uri", state: "ACTIVE" };
    mock.files.delete = async () => { deletes++; };
    const result = analyzeVideo({ ...fixture(t), apiKey: "key", logger: {}, createClient: () => mock, sleep: async () => {} });
    if (code === 13) assert.deepEqual(await result, facts); else await assert.rejects(result, { code: "gemini_processing_failed" });
    assert.equal(uploads, code === 13 ? 2 : 1); assert.equal(deletes, uploads);
  }
});

test("hung inference exhausts four bounded attempts, aborts requests, and cleans once", async t => {
  const calls = [], signals = [], delays = [];
  const client = mockClient(request => { signals.push(request.config.abortSignal); return new Promise(() => {}); }, calls);
  await assert.rejects(analyzeVideo({ ...fixture(t), apiKey: "key", timeoutMs: 15, logger: {}, createClient: () => client,
    sleep: async ms => delays.push(ms) }), { code: "gemini_analysis_timeout" });
  assert.equal(signals.length, 4); assert.ok(signals.every(s => s.aborted));
  assert.deepEqual(delays, [3000, 8000, 15000]); assert.deepEqual(calls, ["upload", "delete"]);
});
function mockClient(generate, calls = []) { return { files: {
 upload: async () => { calls.push("upload"); return { name: "files/1", state: "ACTIVE", uri: "uri" }; },
 delete: async () => calls.push("delete") }, models: { generateContent: generate } }; }
test("retries transient generation with exact backoff and one reused upload until success", async (t) => {
  const calls = [], delays = []; let attempts = 0;
  const client = mockClient(async () => {
    attempts += 1;
    if (attempts < 4) throw Object.assign(new Error("temporarily unavailable"), { status: 503 });
    return { text: "```json\n" + JSON.stringify(facts) + "\n```" };
  }, calls);
  const result = await analyzeVideo({ ...fixture(t), apiKey: "key", createClient: () => client,
    sleep: async (ms) => delays.push(ms), logger: { error() {} } });
  assert.deepEqual(result, facts);  assert.equal(attempts, 4);
  assert.deepEqual(delays, [3000, 8000, 15000]); assert.deepEqual(calls, ["upload", "delete"]);
});

test("exhausts malformed responses and does not retry permanent HTTP errors", async (t) => {
  for (const status of [400, 401, 403, 404, 429, 500, 502, 503, 504, null]) {
    let attempts = 0;
    const client = mockClient(async () => { attempts += 1; if (status) throw Object.assign(new Error("failure"), { status }); return { text: "" }; });
    await assert.rejects(analyzeVideo({ ...fixture(t), apiKey: "key", createClient: () => client, sleep: async () => {}, logger: { error() {} } }));
    assert.equal(attempts, status && status < 429 ? 1 : 4);
  }
});

test("stale ACTIVE inference response re-polls the same upload before retrying", async (t) => {
  const calls = [], delays = []; let attempts = 0;
  const client = { files: {
    upload: async () => { calls.push("upload"); return { name: "files/same", uri: "private-uri", state: "ACTIVE" }; },
    get: async ({ name }) => { assert.equal(name, "files/same"); calls.push("get"); return { name, uri: "private-uri", state: "ACTIVE" }; },
    delete: async ({ name }) => { assert.equal(name, "files/same"); calls.push("delete"); }
  }, models: { generateContent: async (request) => {
    calls.push("generate"); assert.equal(request.contents[0].fileData.fileUri, "private-uri");
    if (++attempts === 1) throw Object.assign(new Error(JSON.stringify({ error: { message: "The video file is currently in a PROCESSING state" } })), { name: "ApiError", status: 400 });
    return { text: JSON.stringify(facts) };
  } } };
  assert.deepEqual(await analyzeVideo({ ...fixture(t), apiKey: "key", createClient: () => client,
    sleep: async ms => delays.push(ms), logger: {} }), facts);
  assert.deepEqual(calls, ["upload", "generate", "get", "generate", "delete"]);
  assert.deepEqual(delays, [3000, 2000]);
});

test("temporary status lookup failure resumes polling without another upload", async (t) => {
  const calls = []; let polls = 0;
  const client = mockClient(async () => { calls.push("generate"); return { text: JSON.stringify(facts) }; }, calls);
  client.files.upload = async () => { calls.push("upload"); return { name: "files/same", state: "PROCESSING" }; };
  client.files.get = async ({ name }) => {
    assert.equal(name, "files/same"); calls.push("get");
    if (++polls === 1) throw Object.assign(new Error("busy"), { status: 503 });
    return { name, state: "ACTIVE", uri: "uri" };
  };
  assert.deepEqual(await analyzeVideo({ ...fixture(t), apiKey: "key", createClient: () => client,
    sleep: async () => {}, logger: {} }), facts);
  assert.deepEqual(calls, ["upload", "get", "get", "generate", "delete"]);
});

test("readiness and empty-response exhaustion retain classified errors and clean once", async (t) => {
  for (const mode of ["readiness", "empty", "invalid-video", "blocked", "unknown"]) {
    const calls = []; let attempts = 0;
    const client = mockClient(async () => {
      attempts++;
      if (mode === "readiness") throw Object.assign(new Error("File is not ready yet; private-provider-detail"), { status: 400 });
      if (mode === "invalid-video") throw Object.assign(new Error("Unsupported video format"), { status: 400 });
      if (mode === "unknown") throw new Error("unclassified internal problem");
      if (mode === "blocked") return { promptFeedback: { blockReason: "SAFETY" } };
      return { text: "" };
    }, calls);
    client.files.get = async () => ({ name: "files/1", uri: "uri", state: "ACTIVE" });
    const expected = { readiness: "gemini_file_not_ready", empty: "gemini_invalid_analysis",
      "invalid-video": "gemini_processing_failed", blocked: "gemini_analysis_blocked", unknown: "gemini_analysis_failed" };
    await assert.rejects(analyzeVideo({ ...fixture(t), apiKey: "key", createClient: () => client,
      sleep: async () => {}, logger: {} }), error => {
      assert.equal(error.code, expected[mode]);
      assert.doesNotMatch(error.message, /could not understand|private-provider-detail|unclassified internal/);
      assert.ok(error.diagnosticCode); return true;
    });
    assert.equal(attempts, ["readiness", "empty"].includes(mode) ? 4 : 1);
    assert.deepEqual(calls, ["upload", "delete"]);
  }
});

test("concurrent executions never share uploaded files or cleanup targets", async (t) => {
  const files = [], deleted = [], calls = [0, 0];
  const outputs = await Promise.all([0, 1].map(i => analyzeVideo({ ...fixture(t), apiKey: "key", logger: {},
    sleep: async () => {}, createClient: () => ({ files: {
      upload: async () => ({ name: `files/user-${i}`, uri: `private-${i}`, state: "ACTIVE" }),
      delete: async ({ name }) => deleted.push(name)
    }, models: { generateContent: async request => {
      const uri = request.contents[0].fileData.fileUri; files.push(uri); assert.equal(uri, `private-${i}`);
      if (++calls[i] === 1) throw Object.assign(new Error("busy"), { status: 503 });
      return { text: JSON.stringify(facts) };
    } } }) })));
  assert.deepEqual(outputs, [facts, facts]);
  assert.equal(files.length, 4);
  assert.deepEqual(deleted.sort(), ["files/user-0", "files/user-1"]);
});
