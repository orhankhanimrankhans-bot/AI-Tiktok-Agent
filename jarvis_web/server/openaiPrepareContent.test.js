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
  await assert.rejects(() => prepareContent(options({ fetchImpl: async () => response(generic) })), (error) => error.code === "openai_title_repair_failed");
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
  let uploads = 0, generations = 0, cleanups = 0, repairs = 0;
  const config = prepareContentDefaults();
  const generate = (body) => prepareContent(options({ body, binaryDir, analyzeVideoImpl: async ({ binary }) => {
    assert.equal(binary.referenceId, downloaded.binary.referenceId);
    assert.deepEqual(fs.readFileSync(path.join(binaryDir, binary.referenceId)), bytes);
    let attempts = 0;
    return require("./geminiVideoAnalysis").analyzeVideo({ binaryDir, binary, mimeType: "video/mp4", apiKey: GEMINI_KEY,
      sleep: async () => {}, logger: {}, createClient: () => ({ files: {
        upload: async () => { uploads++; return { name: "files/handoff", uri: "uri", state: "ACTIVE" }; },
        delete: async () => { cleanups++; }
      }, models: { generateContent: async () => {
        generations++; if (++attempts === 1) throw Object.assign(new Error("busy"), { status: 503 });
        return { text: JSON.stringify(visual) };
      } } }) });
  }, fetchImpl: async (_url, request) => {
    if (JSON.parse(request.body).text.format.name === "repaired_video_title") { repairs++; return response({ output_text: JSON.stringify({ title: "Electric scooter meets the shredder" }) }); }
    return response({ output_text: JSON.stringify({ title: "An e-scooter meets the shredder", description: "An electric scooter is crushed.", hashtags: ["one", "two", "three", "four", "five"] }) });
  } }));
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
  assert.equal(repairs, 2); assert.equal(uploads, 2); assert.equal(generations, 4); assert.equal(cleanups, 2);
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

test("terminal readiness maps to a useful HTTP error without OpenAI generation", async () => {
 const { GeminiVideoError } = require("./geminiVideoAnalysis");
 await assert.rejects(prepareContent(options({ analyzeVideoImpl: async () => { throw new GeminiVideoError("gemini_file_not_ready", "Uploaded video is not ready.", "GEMINI_GENERATE_400"); }, fetchImpl: () => assert.fail("OpenAI must not run") })), { code: "gemini_file_not_ready", statusCode: 503, diagnosticCode: "GEMINI_GENERATE_400" });
});

test("normalized complete phrases accept benign typography without a repair", async () => {
  for (const title of ["ELECTRIC SCOOTER crushed", "Electric-scooter crushed", "Electric�scooter crushed", "Electric   scooter crushed", "An (electric) scooter is crushed"]) {
    let calls = 0;
    const result = await prepareContent(options({ fetchImpl: async () => { calls++; return response({ output_text: JSON.stringify({ title, description: "Unchanged caption", hashtags: ["one", "two", "three", "four", "five"] }) }); } }));
    assert.equal(calls, 1); assert.equal(result.title, title);
  }
});

test("plural variants, synonyms and substring collisions use one canonical title repair", async () => {
  for (const [primaryObject, initialTitle] of [["electric scooters", "An electric scooter is crushed"], ["electric scooter", "Electric scooters are crushed"], ["electric scooter", "An e-scooter is crushed"], ["car", "Cargo is loaded"]]) {
    let calls = 0, analyses = 0;
    const originalBinary = structuredClone(input.binary);
    const facts = { ...visual, primaryObject };
    const content = { title: initialTitle, description: "Original caption", hashtags: ["one", "two", "three", "four", "five"] };
    const result = await prepareContent(options({ analyzeVideoImpl: async ({ binary }) => { analyses++; assert.deepEqual(binary, originalBinary); return facts; }, fetchImpl: async (_url, request) => {
      const req = JSON.parse(request.body);
      if (++calls === 1) return response({ output_text: JSON.stringify(content) });
      assert.equal(calls, 2);
      assert.deepEqual(req.text.format.schema.required, ["title"]);
      assert.deepEqual(Object.keys(req.text.format.schema.properties), ["title"]);
      assert.match(req.instructions, /canonical detected object phrase explicitly, verbatim/);
      assert.equal(JSON.parse(req.input).canonicalDetectedObject, primaryObject);
      assert.doesNotMatch(req.input, /referenceId|Original caption|test-openai-key|test-gemini-key/);
      return response({ output_text: JSON.stringify({ title: `${primaryObject} in action` }) });
    } }));
    assert.equal(calls, 2); assert.equal(analyses, 1);
    assert.equal(result.title, `${primaryObject} in action`);
    assert.equal(result.caption, content.description); assert.equal(result.description, content.description);
    assert.deepEqual(result.hashtags, content.hashtags.map(tag => `#${tag}`));
    assert.equal(result.socialCaption, 'Original caption\n\n#one #two #three #four #five');
    assert.equal(result.socialCaptionWithHashtags, result.socialCaption);
    assert.deepEqual(input.binary, originalBinary);
  }
});

test("invalid repair is classified and never loops or replaces other fields", async () => {
  for (const repair of [{ title: "Still unrelated" }, { title: "" }, { title: "Electric scooter", description: "replacement" }, {}, null]) {
    let calls = 0, analyses = 0;
    await assert.rejects(prepareContent(options({ analyzeVideoImpl: async () => { analyses++; return visual; }, fetchImpl: async () => {
      calls++;
      return response({ output_text: JSON.stringify(calls === 1 ? { title: "Unrelated", description: "Original", hashtags: ["one", "two", "three", "four", "five"] } : repair) });
    } })), { code: "openai_title_repair_failed", statusCode: 502 });
    assert.equal(calls, 2); assert.equal(analyses, 1);
  }
});

test("repair service failures retain existing safe error classifications", async () => {
  let calls = 0;
  await assert.rejects(prepareContent(options({ fetchImpl: async () => ++calls === 1 ? response({ output_text: JSON.stringify({ title: "Unrelated", description: "Original", hashtags: ["one", "two", "three", "four", "five"] }) }) : response({}, 429) })), { code: "openai_rate_limited" });
  assert.equal(calls, 2);
});
