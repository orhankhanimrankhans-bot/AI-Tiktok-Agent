"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const { OPENAI_RESPONSES_URL, PrepareContentError, makeOpenAIRequest, prepareContent, validatePrepareContentInput } = require("./openaiPrepareContent");

const KEY = "test-openai-key-never-log";
const GEMINI_KEY = "test-gemini-key-never-log";
const input = { fileName: "misleading-filename.mp4", mimeType: "video/mp4", binary: { property: "data", referenceId: "bin_1234567890123456" }, titleInstructions: "Create a concise title.", captionInstructions: "Create an engaging description.", hashtagCount: 5, language: "English", tone: "Natural" };
const visual = { primaryObject: "electric scooter", secondaryObject: "industrial twin-shaft shredder", action: "industrial shredder crushing an electric scooter", scene: "scrap and recycling environment", visibleDetails: ["electric scooter", "industrial shredder"], confidence: 0.94 };
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
const success = { output: [{ content: [{ type: "output_text", text: JSON.stringify({ title: "Industrial Shredder Crushes an Electric Scooter", description: "An electric scooter is pulled into an industrial shredder and crushed.", hashtags: ["IndustrialShredder", "ScooterCrush", "Crushing", "Recycling", "Satisfying"] }) }] }] };
const options = (extra = {}) => ({ body: input, apiKey: KEY, geminiApiKey: GEMINI_KEY, binaryDir: "C:/private", analyzeVideoImpl: async () => visual, ...extra });

test("Gemini facts alone reach OpenAI structured metadata generation", async () => {
  let seen;
  const result = await prepareContent(options({ fetchImpl: async (url, request) => { seen = { url, request, body: JSON.parse(request.body) }; return response(success); } }));
  assert.equal(seen.url, OPENAI_RESPONSES_URL); assert.equal(seen.request.headers.Authorization, `Bearer ${KEY}`); assert.equal(seen.body.store, false);
  assert.equal(seen.body.text.format.type, "json_schema"); assert.equal(seen.body.text.format.strict, true);
  const handoff = JSON.parse(seen.body.input); assert.deepEqual(handoff.factualVideoAnalysis, visual);
  assert.doesNotMatch(JSON.stringify(seen.body), /misleading-filename|referenceId|test-gemini-key|access.?token/i);
  assert.deepEqual(result, { detectedObject: "electric scooter", detectedAction: "industrial shredder crushing an electric scooter", visualAnalysis: visual, title: "Industrial Shredder Crushes an Electric Scooter", description: "An electric scooter is pulled into an industrial shredder and crushed.", caption: "An electric scooter is pulled into an industrial shredder and crushed.", hashtags: ["#IndustrialShredder", "#ScooterCrush", "#Crushing", "#Recycling", "#Satisfying"], socialCaption: "An electric scooter is pulled into an industrial shredder and crushed.\n\n#IndustrialShredder #ScooterCrush #Crushing #Recycling #Satisfying", socialCaptionWithHashtags: "An electric scooter is pulled into an industrial shredder and crushed.\n\n#IndustrialShredder #ScooterCrush #Crushing #Recycling #Satisfying" });
});

test("downloaded binary reaches Gemini before OpenAI and filename is never visual evidence", async () => {
  const calls = []; let request;
  await prepareContent(options({ analyzeVideoImpl: async (value) => { calls.push("gemini"); assert.equal(value.binary.referenceId, input.binary.referenceId); assert.equal(value.mimeType, "video/mp4"); assert.equal(value.apiKey, GEMINI_KEY); assert.equal("fileName" in value, false); return visual; }, fetchImpl: async (_url, value) => { calls.push("openai"); request = JSON.parse(value.body); return response(success); } }));
  assert.deepEqual(calls, ["gemini", "openai"]); assert.doesNotMatch(JSON.stringify(request), /misleading-filename/);
});

test("unsafe input, missing keys, Gemini failure, and malformed OpenAI output fail closed", async () => {
  assert.throws(() => validatePrepareContentInput({ ...input, accessToken: "secret" }), (error) => error.code === "unsafe_prepare_content_input");
  await assert.rejects(() => prepareContent(options({ apiKey: "" })), (error) => error.code === "openai_not_configured");
  await assert.rejects(() => prepareContent(options({ geminiApiKey: "" })), (error) => error.code === "gemini_not_configured");
  let requested = false;
  await assert.rejects(() => prepareContent(options({ analyzeVideoImpl: async () => { const error = new Error("private path"); error.code = "gemini_processing_failed"; error.diagnosticCode = "GEMINI_PROCESSING_503"; throw error; }, fetchImpl: async () => { requested = true; return response(success); } })), (error) => error.code === "gemini_processing_failed" && error.diagnosticCode === "GEMINI_PROCESSING_503" && !/path/i.test(error.message));
  assert.equal(requested, false);
  await assert.rejects(() => prepareContent(options({ fetchImpl: async () => response({ output: [] }) })), (error) => error.code === "openai_malformed_response");
});

test("OpenAI cannot replace the high-confidence detected object", async () => {
  const generic = { output_text: JSON.stringify({ title: "You Won't Believe This Crush", description: "A machine crushes something.", hashtags: ["one", "two", "three", "four", "five"] }) };
  await assert.rejects(() => prepareContent(options({ fetchImpl: async () => response(generic) })), (error) => error.code === "openai_factual_mismatch");
});

test("OpenAI auth, rate limit, timeout, and network errors remain secret-safe", async () => {
  await assert.rejects(() => prepareContent(options({ fetchImpl: async () => response({}, 401) })), (error) => error.code === "openai_authentication_failed" && !error.message.includes(KEY));
  await assert.rejects(() => prepareContent(options({ fetchImpl: async () => response({}, 429) })), (error) => error.code === "openai_rate_limited");
  await assert.rejects(() => prepareContent(options({ fetchImpl: async () => { throw new Error(`network ${KEY}`); } })), (error) => error.code === "openai_unavailable" && !error.message.includes(KEY));
  await assert.rejects(() => prepareContent(options({ timeoutMs: 1, fetchImpl: (_url, request) => new Promise((_resolve, reject) => request.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))) })), (error) => error instanceof PrepareContentError && error.code === "openai_timeout");
});

test("OpenAI prompt performs metadata generation rather than visual detection", () => {
  const request = makeOpenAIRequest(input, "gpt-test", visual);
  assert.match(request.instructions, /supplied factual Gemini video analysis/i); assert.match(request.instructions, /do not perform new visual detection/i);
  assert.deepEqual(JSON.parse(request.input).factualVideoAnalysis, visual); assert.doesNotMatch(JSON.stringify(request), /misleading-filename|input_image/);
});

test("dedicated route accepts no browser keys and reports server configuration booleans", () => {
  const source = fs.readFileSync(require.resolve("./index.js"), "utf8");
  const route = source.slice(source.indexOf('app.post("/api/ai/prepare-content"'), source.indexOf('app.get("/api/facebook/credentials"'));
  assert.match(route, /executionServices\.openAI\.prepare\(\{ body: req\.body, apiKey: executionServices\.openAI\.apiKey, model: executionServices\.openAI\.model \}\)/);
  assert.doesNotMatch(route, /req\.body\.(apiKey|token|authorization)/i);
  assert.match(source, /openAIConfigured/); assert.match(source, /geminiConfigured/);
  assert.match(route, /diagnosticCode/);
});

test("publishing copy has normalized unique hashtags and a backwards-compatible combined caption", async () => {
  const copy = { title: "Electric scooter meets the shredder", description: "  An electric scooter is crushed.  ",
    hashtags: [" ##Scooter ", "#Recycling", "#Metal_Recycling", "#إعادة_التدوير", "#Shredder"] };
  const result = await prepareContent(options({ fetchImpl: async () => response({ output_text: JSON.stringify(copy) }) }));
  assert.equal(result.caption, "An electric scooter is crushed.");
  assert.deepEqual(result.hashtags, ["#Scooter", "#Recycling", "#Metal_Recycling", "#إعادة_التدوير", "#Shredder"]);
  assert.equal(result.socialCaptionWithHashtags, `${result.caption}\n\n${result.hashtags.join(" ")}`);
  assert.equal(result.socialCaptionWithHashtags, result.socialCaption);
  assert.deepEqual(result.visualAnalysis, visual);
  for (const tags of [["scooter", "#SCOOTER", "metal", "recycling", "shredder"], ["scooter", {}, "metal", "recycling", "shredder"]]) {
    await assert.rejects(prepareContent(options({ fetchImpl: async () => response({ output_text: JSON.stringify({ ...copy, hashtags: tags }) }) })),
      { code: "openai_malformed_response" });
  }
});

test("real Download output survives browser and server Prepare Content and resolves both Reel caption expressions", async (t) => {
  const path = require("node:path"), os = require("node:os"), { EventEmitter } = require("node:events");
  const { executeDriveDownload } = require("./driveFiles");
  const { resolveExpression: serverResolve, createWorkflowExecutor } = require("./workflowExecutor");
  const { resolveBinaryReference } = require("./facebookReels");
  const { buildPrepareContentRequest, mergePreparedContent, prepareContentDefaults } = await import("../client/src/prepareContentConfig.js");
  const { buildFacebookReelRequest, facebookNodeDefaults } = await import("../client/src/facebookReelConfig.js");
  const binaryDir = fs.mkdtempSync(path.join(os.tmpdir(), "corex-copy-handoff-"));
  t.after(() => fs.rmSync(binaryDir, { recursive: true, force: true }));
  const owner = { ownerType: "additional", ownerId: "test-profile" };
  const bytes = Buffer.from("synthetic video bytes; provider calls are mocked");
  const downloaded = await executeDriveDownload({ binaryDir, owner,
    request: { credentialId: "gcred_1234567890123456789012", fileId: "source-video", binaryProperty: "data" },
    credentialStore: { get: async (_id, scope) => { assert.equal(scope.owner, owner); return { tokens: {} }; } },
    createOAuthClient: () => Object.assign(new EventEmitter(), { setCredentials() {} }),
    createDriveClient: () => ({ files: { get: async (request) => ({ data: request.alt === "media" ? bytes : { name: "clip.mp4", mimeType: "video/mp4", size: String(bytes.length) } }) } }) });
  assert.equal(downloaded.title, undefined);
  const config = prepareContentDefaults();
  const generate = (body) => prepareContent(options({ body, binaryDir, analyzeVideoImpl: async ({ binary }) => {
    assert.equal(binary.referenceId, downloaded.binary.referenceId);
    assert.deepEqual(fs.readFileSync(path.join(binaryDir, binary.referenceId)), bytes);
    return visual;
  }, fetchImpl: async () => response(success) }));
  const browser = mergePreparedContent(downloaded, await generate(buildPrepareContentRequest(config, downloaded)));
  const nodes = [{ id: "t", name: "Schedule Trigger", config: {} }, { id: "d", name: "Download File", config: { credentialId: "test", fileId: "source-video" } }, { id: "p", name: "Prepare Content", config }, { id: "f", name: "Facebook Graph API", config: { operation: "Publish Reel", credentialId: "test-facebook", title: "{{ $json.title }}", description: "{{ $json.socialCaptionWithHashtags }}" } }];
  let publishedRequest;
  const execution = await createWorkflowExecutor({ executionServices: { google: { downloadFile: async () => downloaded }, openAI: { prepare: ({ body }) => generate(body) }, facebook: { publishReel: async (request) => { publishedRequest = request; return { success: true, status: "published" }; } } } }).execute({ workflowId: "handoff-test", nodes, connections: nodes.slice(1).map((node, i) => ({ source: nodes[i].id, target: node.id })) });
  assert.equal(execution.status, "success");
  const server = execution.nodes.find(node => node.nodeId === "p").output;
  assert.equal(publishedRequest.title, server.title);
  assert.equal(publishedRequest.description, server.socialCaptionWithHashtags);
  assert.deepEqual(publishedRequest.binary, downloaded.binary);
  assert.deepEqual(browser, server);
  for (const item of [browser, server]) {
    assert.deepEqual(item.binary, downloaded.binary);
    assert.equal(item.fileId, downloaded.fileId);
    assert.deepEqual(item.visualAnalysis, visual);
    assert.equal(item.hashtags.length, 5);
    for (const field of ["socialCaption", "socialCaptionWithHashtags"]) {
      const request = buildFacebookReelRequest({ ...facebookNodeDefaults(), credentialId: "test-facebook", description: `{{ $json.${field} }}` }, item);
      assert.equal(request.title, item.title);
      assert.equal(request.description, item.socialCaptionWithHashtags);
      assert.equal(serverResolve(`{{ $json.${field} }}`, item), request.description);
      assert.deepEqual(request.binary, downloaded.binary);
      const resolved = resolveBinaryReference({ ...request, binaryDir });
      assert.equal(resolved.size, bytes.length);
      assert.deepEqual(fs.readFileSync(resolved.filePath), bytes);
    }
  }
});
