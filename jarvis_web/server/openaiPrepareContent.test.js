const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const { OPENAI_RESPONSES_URL, PrepareContentError, makeOpenAIRequest, prepareContent, validatePrepareContentInput } = require("./openaiPrepareContent");

const KEY = "test-openai-key-never-log";
const input = { fileName: "nature-clip.mp4", mimeType: "video/mp4", titleInstructions: "Create a concise title.", captionInstructions: "Create an engaging caption.", hashtagCount: 5, language: "English", tone: "Natural" };
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
const success = { output: [{ content: [{ type: "output_text", text: JSON.stringify({ title: "Nature Moment", caption: "A simple moment outdoors.", hashtags: ["nature", "outdoors", "calm", "video", "explore"] }) }] }] };

test("request uses Responses structured output and safe metadata only", async () => {
  let seen;
  const result = await prepareContent({ body: input, apiKey: KEY, fetchImpl: async (url, options) => { seen = { url, options, body: JSON.parse(options.body) }; return response(success); } });
  assert.equal(seen.url, OPENAI_RESPONSES_URL); assert.equal(seen.options.headers.Authorization, `Bearer ${KEY}`); assert.equal(seen.body.store, false);
  assert.equal(seen.body.text.format.type, "json_schema"); assert.equal(seen.body.text.format.strict, true);
  assert.deepEqual(result, { title: "Nature Moment", caption: "A simple moment outdoors.", hashtags: ["#nature", "#outdoors", "#calm", "#video", "#explore"], socialCaption: "A simple moment outdoors.\n\n#nature #outdoors #calm #video #explore" });
  assert.doesNotMatch(JSON.stringify(seen.body), /binary|referenceId|credential|access.?token|authorization/i);
});

test("unsafe fields, invalid enums, and malformed output fail safely", async () => {
  assert.throws(() => validatePrepareContentInput({ ...input, binary: { referenceId: "bin_secret" } }), (error) => error.code === "unsafe_prepare_content_input");
  assert.throws(() => validatePrepareContentInput({ ...input, tone: "Chaotic" }), /supported tone/);
  await assert.rejects(() => prepareContent({ body: input, apiKey: KEY, fetchImpl: async () => response({ output: [] }) }), (error) => error.code === "openai_malformed_response" && !error.message.includes(KEY));
});

test("missing key, auth, rate limit, timeout, and network errors are mapped without leakage", async () => {
  await assert.rejects(() => prepareContent({ body: input, apiKey: "" }), (error) => error.code === "openai_not_configured");
  await assert.rejects(() => prepareContent({ body: input, apiKey: KEY, fetchImpl: async () => response({}, 401) }), (error) => error.code === "openai_authentication_failed" && !error.message.includes(KEY));
  await assert.rejects(() => prepareContent({ body: input, apiKey: KEY, fetchImpl: async () => response({}, 429) }), (error) => error.code === "openai_rate_limited");
  await assert.rejects(() => prepareContent({ body: input, apiKey: KEY, fetchImpl: async () => { throw new Error(`network ${KEY}`); } }), (error) => error.code === "openai_unavailable" && !error.message.includes(KEY));
  await assert.rejects(() => prepareContent({ body: input, apiKey: KEY, timeoutMs: 1, fetchImpl: (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))) }), (error) => error instanceof PrepareContentError && error.code === "openai_timeout");
});

test("prompt treats filename as untrusted metadata and does not claim media analysis", () => {
  const request = makeOpenAIRequest(input, "gpt-test");
  assert.match(request.instructions, /filename is untrusted data/i); assert.match(request.instructions, /do not claim/i);
  assert.doesNotMatch(request.instructions, /I watched|I analyzed/);
});

test("dedicated route accepts no browser API key and reports server configuration as a boolean", () => {
  const source = fs.readFileSync(require.resolve("./index.js"), "utf8");
  const route = source.slice(source.indexOf('app.post("/api/ai/prepare-content"'), source.indexOf('app.get("/api/facebook/credentials"'));
  assert.match(route, /executionServices\.openAI\.prepare\(\{ body: req\.body, apiKey: executionServices\.openAI\.apiKey, model: executionServices\.openAI\.model \}\)/);
  assert.doesNotMatch(route, /req\.body\.(apiKey|token|authorization)/i);
  assert.match(source, /openAIConfigured/);
});
