"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { analyzeVertexVideo, vertexClientOptions } = require("./geminiVertexVideoAnalysis");
const { readConfiguration, analyzeConfiguredVideo } = require("./geminiProvider");
const { createExecutionServices } = require("./executionServices");
const { prepareContent } = require("./openaiPrepareContent");
const vertex = { project: "corex-test-project", location: "global", bucket: "corex-private-video", model: "gemini-2.5-flash" };
const facts = { primaryObject: "car", secondaryObject: "", action: "driving", scene: "road", visibleDetails: ["wheels"], confidence: 0.9 };
test("existing Google Cloud project/location settings are reused only with explicit Vertex selection", () => {
  const env = { GOOGLE_CLOUD_PROJECT: vertex.project, GOOGLE_CLOUD_LOCATION: vertex.location,
    GEMINI_VERTEX_MODEL: vertex.model, GEMINI_VERTEX_BUCKET: vertex.bucket };
  assert.equal(readConfiguration(env).provider, "developer");
  assert.equal(readConfiguration(env).configured, false);
  const configured = readConfiguration({ ...env, GEMINI_PROVIDER: "vertex" });
  assert.equal(configured.configured, true); assert.deepEqual(configured.vertex, vertex);
  const explicit = readConfiguration({ ...env, GEMINI_PROVIDER: "vertex", GEMINI_VERTEX_PROJECT: "explicit-project", GEMINI_VERTEX_LOCATION: "us-central1" });
  assert.equal(explicit.vertex.project, "explicit-project"); assert.equal(explicit.vertex.location, "us-central1");
  // A script's Express key alone is not ADC/GCS authorization or activation.
  assert.equal(readConfiguration({ GEMINI_PROVIDER: "vertex", GOOGLE_CLOUD_API_KEY: "inert" }).configured, false);
});
function fixture(t, generate) {
  const binaryDir = fs.mkdtempSync(path.join(os.tmpdir(), "corex-vertex-"));
  const binary = { referenceId: "bin_1234567890123456", property: "video", size: 4 };
  fs.writeFileSync(path.join(binaryDir, binary.referenceId), "MP4!");
  t.after(() => fs.rmSync(binaryDir, { recursive: true, force: true }));
  const uploads = [], requests = [], deletes = [], delays = [], logs = [];
  const storage = { buckets: { get: async () => ({ data: { iamConfiguration: { publicAccessPrevention: "enforced", uniformBucketLevelAccess: { enabled: true } } } }) }, objects: {
    insert: async req => { uploads.push(req); let body = ""; for await (const chunk of req.media.body) body += chunk; assert.equal(body, "MP4!"); return { data: { generation: "123" } }; },
    delete: async req => { deletes.push(req); },
  } };
  const client = { models: { generateContent: async req => { requests.push(req); return generate ? generate(req, requests.length) : { text: JSON.stringify(facts) }; } } };
  return { binaryDir, binary, mimeType: "video/mp4", vertex, provider: "vertex", apiKey: "unused-developer-secret",
    logger: { info: (...args) => logs.push(args) }, sleep: async ms => delays.push(ms), cooldown: { wait: async () => {}, record() {} },
    createClientsImpl: async () => ({ storage, client }), storage, uploads, requests, deletes, delays, logs };
}

test("provider selection defaults to Developer, explicit Vertex requires complete configuration", async () => {
  assert.equal(readConfiguration({ GEMINI_API_KEY: "key" }).provider, "developer");
  assert.equal(readConfiguration({ GEMINI_PROVIDER: "vertex", GEMINI_API_KEY: "key" }).configured, false);
  await assert.rejects(analyzeConfiguredVideo({ provider: "unknown", apiKey: "key" }), { code: "gemini_invalid_configuration" });
  await assert.rejects(analyzeConfiguredVideo({ provider: "vertex", apiKey: "key", vertex: {} }), { code: "gemini_invalid_configuration" });
});
test("Vertex SDK configuration pins ADC, v1 and regional/global Vertex endpoint", () => {
  const auth = {}, opts = vertexClientOptions(vertex, auth);
  assert.equal(opts.vertexai, true); assert.equal(opts.apiKey, undefined); assert.equal(opts.apiVersion, "v1");
  assert.equal(opts.googleAuthOptions.authClient, auth);
  assert.equal(opts.httpOptions.baseUrl, "https://aiplatform.googleapis.com");
  assert.equal(vertexClientOptions({ ...vertex, location: "us-central1" }, auth).httpOptions.baseUrl, "https://us-central1-aiplatform.googleapis.com");
});
for (const developerKey of ["inert-developer-key", ""]) test(`installed SDK uses ADC with Developer key ${developerKey ? "present" : "absent"}`, async t => {
  const { GoogleGenAI } = require("@google/genai");
  const originalFetch = global.fetch;
  const keys = ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_VERTEX_BASE_URL", "GOOGLE_GENAI_USE_VERTEXAI"];
  const saved = keys.map(key => [key, process.env[key]]);
  t.after(() => { global.fetch = originalFetch; for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  process.env.GEMINI_API_KEY = developerKey; process.env.GOOGLE_API_KEY = "";
  process.env.GOOGLE_VERTEX_BASE_URL = "https://invalid.example.test"; process.env.GOOGLE_GENAI_USE_VERTEXAI = "false";
  let calls = 0, authCalls = 0;
  global.fetch = async (input, init) => {
    calls++;
    const url = new URL(String(input));
    assert.equal(url.host, "aiplatform.googleapis.com");
    assert.equal(url.pathname, "/v1/projects/corex-test-project/locations/global/publishers/google/models/gemini-2.5-flash:generateContent");
    assert.equal(url.search, "");
    assert.equal(new Headers(init.headers).has("x-goog-api-key"), false);
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer inert-test-token");
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(facts) }] }, finishReason: "STOP" }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const client = new GoogleGenAI(vertexClientOptions(vertex, { getRequestHeaders: async () => { authCalls++; return new Headers({ authorization: "Bearer inert-test-token" }); } }));
  await client.models.generateContent({ model: vertex.model, contents: [{ fileData: { fileUri: "gs://inert-test/video", mimeType: "video/mp4" } }] });
  assert.equal(calls, 1); assert.equal(authCalls, 1);
});
test("execution service overrides caller provider fields with server-only Vertex configuration", async () => {
  let received;
  const services = createExecutionServices({ credentialStore: {}, createOAuthClient() {}, createDriveClient() {}, binaryDirectory: "private",
    prepareContent: async input => { received = input; }, openAIApiKey: "inert", openAIModel: "test", executionStore: {},
    geminiProvider: "vertex", geminiVertex: vertex });
  await services.openAI.prepare({ geminiProvider: "developer", geminiVertex: { bucket: "foreign" } });
  assert.equal(received.geminiProvider, "vertex"); assert.equal(received.geminiVertex, vertex);
  assert.doesNotMatch(JSON.stringify(services.publicCapabilities), /corex-private|vertex|inert/);
});
test("Vertex uses one private GCS object, original facts schema, and generation-scoped cleanup", async t => {
  const f = fixture(t); const original = structuredClone(f.binary);
  assert.deepEqual(await analyzeConfiguredVideo(f), facts);
  assert.equal(f.uploads.length, 1); assert.equal(f.requests.length, 1);
  assert.equal(f.uploads[0].ifGenerationMatch, "0");
  assert.equal(f.requests[0].contents[0].fileData.fileUri, `gs://${vertex.bucket}/${f.uploads[0].name}`);
  assert.equal(f.deletes[0].object, f.uploads[0].name); assert.equal(f.deletes[0].ifGenerationMatch, "123");
  assert.deepEqual(f.binary, original); assert.equal(fs.existsSync(path.join(f.binaryDir, f.binary.referenceId)), true);
  assert.doesNotMatch(JSON.stringify(f.logs), /unused-developer-secret|gs:\/\/|bin_|MP4!|corex-private-video/);
});
test("four inference attempts reuse the upload and honor provider delay", async t => {
  const f = fixture(t, (_req, n) => { if (n < 4) throw { status: 429, headers: { "retry-after": "46" } }; return { text: JSON.stringify(facts) }; });
  assert.deepEqual(await analyzeVertexVideo(f), facts);
  assert.equal(f.requests.length, 4); assert.equal(f.uploads.length, 1); assert.deepEqual(f.delays, [46000, 46000, 46000]);
  assert.equal(new Set(f.requests.map(r => r.contents[0].fileData.fileUri)).size, 1);
});
test("retry exhaustion remains four; permanent errors stop immediately and clean up", async t => {
  for (const status of [429, 503, 400, 401, 403, 404]) {
    const f = fixture(t, () => { throw { status }; });
    await assert.rejects(analyzeVertexVideo(f));
    assert.equal(f.requests.length, [429, 503].includes(status) ? 4 : 1);
    assert.equal(f.uploads.length, 1); assert.equal(f.deletes.length, 1);
  }
});
test("public or nonuniform bucket fails closed before upload", async t => {
  const f = fixture(t); f.storage.buckets.get = async () => ({ data: { iamConfiguration: { publicAccessPrevention: "inherited" } } });
  await assert.rejects(analyzeVertexVideo(f), { code: "gemini_vertex_bucket_not_private" });
  assert.equal(f.uploads.length, 0); assert.equal(f.requests.length, 0);
});
test("upload failure never invokes inference, no blind duplicate upload, cleanup attempted", async t => {
  const f = fixture(t); let count = 0;
  f.storage.objects.insert = async () => { count++; throw { status: 403 }; };
  await assert.rejects(analyzeVertexVideo(f), { code: "gemini_permission_denied" });
  assert.equal(count, 1); assert.equal(f.requests.length, 0); assert.equal(f.deletes.length, 1);
});
test("concurrent executions use different objects and never delete each other's video", async t => {
  const a = fixture(t), b = fixture(t);
  await Promise.all([analyzeVertexVideo(a), analyzeVertexVideo(b)]);
  assert.notEqual(a.uploads[0].name, b.uploads[0].name);
  assert.equal(a.deletes[0].object, a.uploads[0].name); assert.equal(b.deletes[0].object, b.uploads[0].name);
});
test("Vertex Prepare Content requires no Developer key and preserves title/caption/social outputs", async t => {
  const f = fixture(t); let calls = 0;
  const body = { fileName: "video.mp4", mimeType: f.mimeType, binary: f.binary, titleInstructions: "Title", captionInstructions: "Caption", hashtagCount: 2, language: "English", tone: "Natural" };
  const result = await prepareContent({ body, apiKey: "openai-key", geminiProvider: "vertex", geminiVertex: vertex, binaryDir: f.binaryDir,
    analyzeVideoImpl: async options => { calls++; assert.equal(options.provider, "vertex"); assert.equal(options.vertex, vertex); return analyzeConfiguredVideo({ ...f, ...options }); },
    fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: JSON.stringify({ title: "Car driving", description: "A car drives down the road.", hashtags: ["car", "road"] }) }) }) });
  assert.equal(calls, 1); assert.equal(f.uploads.length, 1);
  assert.equal(result.title, "Car driving"); assert.equal(result.caption, "A car drives down the road.");
  assert.deepEqual(result.hashtags, ["#car", "#road"]);
  assert.equal(result.socialCaptionWithHashtags, result.socialCaption);
  assert.equal(body.binary, f.binary);
});
