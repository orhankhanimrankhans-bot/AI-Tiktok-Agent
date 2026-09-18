"use strict";
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const { GoogleGenAI } = require("@google/genai");
const { google } = require("googleapis");
const { GeminiVideoError, privateVideoPath, FACT_SCHEMA, VISUAL_ANALYSIS_PROMPT, parseAnalysisResponse,
  withTimeout, RETRY_DELAYS_MS, classifyFailure } = require("./geminiVideoAnalysis");
const { validateConfiguration } = require("./geminiProvider");
const { createCooldown, guidance } = require("./geminiRetryDelay");
const inferenceDiagnostics = require("./geminiInferenceDiagnostics");
const vertexCooldown = createCooldown(); // Separate from Developer API quota/cooldown.

function vertexClientOptions(vertex, authClient) {
  // Omit apiKey entirely: an empty string is still a key to the SDK when no
  // Developer key exists in the environment, and suppresses ADC headers.
  return { vertexai: true, project: vertex.project, location: vertex.location, apiVersion: "v1",
    httpOptions: { baseUrl: vertex.location === "global" ? "https://aiplatform.googleapis.com" : `https://${vertex.location}-aiplatform.googleapis.com` },
    googleAuthOptions: { authClient, scopes: ["https://www.googleapis.com/auth/cloud-platform"] } };
}
async function createClients(vertex) {
  // ADC supports external-account federation or an out-of-repository credential file.
  const auth = new google.auth.GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const authClient = await auth.getClient();
  return { client: new GoogleGenAI(vertexClientOptions(vertex, authClient)), storage: google.storage({ version: "v1", auth: authClient }) };
}
function emit(logger, fields) { try { logger?.info?.("[VertexVideoAnalysis]", fields); } catch {} }

async function analyzeVertexVideo(options) {
  const { vertex, binaryDir, binary, mimeType, logger = console, timeoutMs = 120000,
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), cooldown = vertexCooldown,
    createClientsImpl = createClients } = options;
  validateConfiguration("vertex", vertex);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120000)
    throw new GeminiVideoError("gemini_invalid_configuration", "Gemini timeout configuration is invalid.");
  const filePath = privateVideoPath(binaryDir, binary, mimeType);
  let stat;
  try { stat = fs.statSync(filePath); fs.accessSync(filePath, fs.constants.R_OK); }
  catch { throw new GeminiVideoError("gemini_upload_local_read_failed", "The downloaded video could not be read for upload."); }
  if (!stat.isFile() || !stat.size) throw new GeminiVideoError("gemini_upload_invalid_file", "The downloaded video is empty or is not a readable file.");
  const correlationId = randomUUID(), object = `prepare-content/${randomUUID()}`;
  let client, storage;
  try { ({ client, storage } = await createClientsImpl(vertex)); }
  catch { throw new GeminiVideoError("gemini_authentication_failed", "Vertex credentials could not be initialized on the server."); }
  // Enforce private storage before transferring any user video. No public URL/ACL.
  try {
    const bucket = await storage.buckets.get({ bucket: vertex.bucket, fields: "iamConfiguration" },
      { timeout: 10000, retry: false, signal: AbortSignal.timeout(10000) });
    if (bucket.data?.iamConfiguration?.publicAccessPrevention !== "enforced"
      || bucket.data?.iamConfiguration?.uniformBucketLevelAccess?.enabled !== true)
      throw new GeminiVideoError("gemini_vertex_bucket_not_private", "Vertex video storage must enforce public access prevention and uniform bucket-level access.");
  } catch (error) { throw classifyFailure(error, "configuration"); }
  let generation, uploadStarted = false;
  try {
    const controller = new AbortController(), stream = fs.createReadStream(filePath);
    // Handle stream errors even if transport rejects before attaching its reader.
    stream.on("error", () => {});
    try {
      uploadStarted = true;
      const uploaded = await withTimeout(storage.objects.insert({ bucket: vertex.bucket, name: object,
        ifGenerationMatch: "0", requestBody: { contentType: mimeType }, media: { mimeType, body: stream } },
      { signal: controller.signal, timeout: timeoutMs, retry: false }), timeoutMs, "gemini_upload_timeout", "Vertex video upload timed out.");
      generation = uploaded?.data?.generation;
      if (!/^\d+$/.test(String(generation || ""))) throw new GeminiVideoError("gemini_upload_unconfirmed", "Vertex did not confirm the uploaded video.");
      emit(logger, { correlationId, stage: "upload", event: "success", sourceReady: true, byteSize: stat.size });
    } catch (error) { throw classifyFailure(error, "upload"); }
    finally { controller.abort(); stream.destroy(); }

    for (let attempt = 1; attempt <= RETRY_DELAYS_MS.length + 1; attempt++) {
      try { await cooldown.wait(sleep); }
      catch { throw new GeminiVideoError("gemini_cooldown_wait_timeout", "Gemini shared cooldown is still active. Try again later."); }
      const controller = new AbortController();
      let stage = "generateContent";
      try {
        // GCS object availability replaces Developer Files ACTIVE polling.
        emit(logger, { correlationId, stage, attempt, sourceReady: true, sourceKind: "private_gcs" });
        const response = await inferenceDiagnostics.observe({ logger, correlationId, attempt, model: vertex.model,
          fileActive: false, classify: e => classifyFailure(e, stage), maxAttempts: RETRY_DELAYS_MS.length + 1 },
        () => withTimeout(client.models.generateContent({ model: vertex.model,
          contents: [{ fileData: { fileUri: `gs://${vertex.bucket}/${object}`, mimeType } }, { text: VISUAL_ANALYSIS_PROMPT }],
          config: { abortSignal: controller.signal, httpOptions: { retryOptions: { attempts: 1 }, timeout: timeoutMs },
            temperature: 0, maxOutputTokens: 700, responseMimeType: "application/json", responseJsonSchema: FACT_SCHEMA } }),
        timeoutMs, "gemini_analysis_timeout", "Vertex video analysis timed out."));
        stage = "structuredParse";
        return await parseAnalysisResponse(response);
      } catch (error) {
        controller.abort();
        const failure = classifyFailure(error, stage), provider = failure.retryable ? guidance(error) : { delayMs: 0 };
        if (provider.requestQuota && provider.delayMs > 0) cooldown.record(provider.delayMs);
        if (!failure.retryable || attempt > RETRY_DELAYS_MS.length) throw failure;
        const delayMs = Math.max(RETRY_DELAYS_MS[attempt - 1], provider.delayMs);
        emit(logger, { correlationId, stage, attempt, event: "retry", delayMs, classificationCode: failure.code });
        await sleep(delayMs);
      } finally { controller.abort(); }
    }
  } finally {
    if (uploadStarted) {
      // Unique object names prevent cross-execution cleanup. Generation precondition
      // protects confirmed objects; bucket lifecycle covers late/orphaned uploads.
      try { await storage.objects.delete({ bucket: vertex.bucket, object,
        ...(generation ? { ifGenerationMatch: generation } : {}) },
      { signal: AbortSignal.timeout(10000), timeout: 10000, retry: false }); }
      catch { emit(logger, { correlationId, stage: "cleanup", event: "failed" }); }
    }
  }
}

module.exports = { analyzeVertexVideo, vertexClientOptions };
