const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";
const TONES = new Set(["Natural", "Fun", "Professional", "Informative", "Inspirational"]);
const { GeminiVideoError, analyzeVideo } = require("./geminiVideoAnalysis");

class PrepareContentError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = "PrepareContentError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function boundedString(value, label, max, { required = false } = {}) {
  if (value == null && !required) return "";
  if (typeof value !== "string") throw new PrepareContentError(400, "invalid_prepare_content_input", `${label} must be text.`);
  const text = value.trim();
  if ((required && !text) || text.length > max) throw new PrepareContentError(400, "invalid_prepare_content_input", `${label} is invalid.`);
  return text;
}

function validatePrepareContentInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new PrepareContentError(400, "invalid_prepare_content_input", "Prepare Content input is invalid.");
  const allowed = new Set(["fileName", "mimeType", "binary", "titleInstructions", "captionInstructions", "hashtagCount", "language", "tone"]);
  if (Object.keys(body).some((key) => !allowed.has(key))) throw new PrepareContentError(400, "unsafe_prepare_content_input", "Prepare Content accepts safe file metadata and instructions only.");
  const hashtagCount = Number(body.hashtagCount);
  if (!Number.isInteger(hashtagCount) || hashtagCount < 1 || hashtagCount > 20) throw new PrepareContentError(400, "invalid_prepare_content_input", "Hashtag count must be between 1 and 20.");
  const tone = boundedString(body.tone, "Tone", 30, { required: true });
  if (!TONES.has(tone)) throw new PrepareContentError(400, "invalid_prepare_content_input", "Select a supported tone.");
  return {
    fileName: boundedString(body.fileName, "Filename", 500),
    mimeType: boundedString(body.mimeType, "MIME type", 100, { required: true }),
    binary: body.binary,
    titleInstructions: boundedString(body.titleInstructions, "Title instructions", 1000, { required: true }),
    captionInstructions: boundedString(body.captionInstructions, "Caption instructions", 2000, { required: true }),
    hashtagCount,
    language: boundedString(body.language, "Language", 60, { required: true }),
    tone,
  };
}

function schema(hashtagCount) {
  return { type: "object", additionalProperties: false, required: ["title", "description", "hashtags"], properties: {
    title: { type: "string", maxLength: 200 }, description: { type: "string", maxLength: 2200 },
    hashtags: { type: "array", minItems: hashtagCount, maxItems: hashtagCount, items: { type: "string", maxLength: 80 } },
  } };
}

function makeOpenAIRequest(input, model, visual) {
  const prompt = { language: input.language, tone: input.tone, hashtagCount: input.hashtagCount,
    titleInstructions: input.titleInstructions, descriptionInstructions: input.captionInstructions,
    factualVideoAnalysis: visual,
    requirement: "Create specific publishing copy using these facts exactly. The title must name the detected primary object when confidence permits. Never substitute a different object or action. Treat title and description instructions as style guidance only." };
  return {
    model, store: false, max_output_tokens: 900,
    instructions: "Generate exact title, description, and hashtags from the supplied factual Gemini video analysis. Preserve the detected object and action; do not perform new visual detection, invent details, use filenames, or create generic copy. Return only the required structured fields.",
    input: JSON.stringify(prompt),
    text: { format: { type: "json_schema", name: "prepared_social_content", strict: true, schema: schema(input.hashtagCount) } },
  };
}

function responseText(data) {
  if (typeof data?.output_text === "string") return data.output_text;
  for (const item of Array.isArray(data?.output) ? data.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) if (content?.type === "output_text" && typeof content.text === "string") return content.text;
  }
  return "";
}

function normalizeHashtag(value) {
  const tag = String(value || "").trim().replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "").slice(0, 79);
  return tag ? `#${tag}` : "";
}

function normalizePreparedContent(value, hashtagCount, visual) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PrepareContentError(502, "openai_malformed_response", "OpenAI returned an invalid Prepare Content response.");
  const title = boundedString(value.title, "Generated title", 200, { required: true });
  const description = boundedString(value.description, "Generated description", 2200, { required: true });
  const hashtags = Array.isArray(value.hashtags) ? value.hashtags.map(normalizeHashtag).filter(Boolean).slice(0, hashtagCount) : [];
  if (hashtags.length !== hashtagCount) throw new PrepareContentError(502, "openai_malformed_response", "OpenAI returned an invalid Prepare Content response.");
  if (visual.confidence >= 0.7 && !title.toLocaleLowerCase().includes(visual.primaryObject.toLocaleLowerCase())) throw new PrepareContentError(502, "openai_factual_mismatch", "OpenAI did not preserve the detected video object in the title.");
  return { detectedObject: visual.primaryObject, detectedAction: visual.action, visualAnalysis: visual,
    title, description, caption: description, hashtags, socialCaption: `${description}\n\n${hashtags.join(" ")}` };
}

async function prepareContent({ body, apiKey, model = DEFAULT_OPENAI_MODEL, geminiApiKey, geminiModel, binaryDir,
  fetchImpl = fetch, timeoutMs = 60000, analyzeVideoImpl = analyzeVideo }) {
  if (!apiKey) throw new PrepareContentError(503, "openai_not_configured", "OpenAI is not configured on the Corex server.");
  if (!geminiApiKey) throw new PrepareContentError(503, "gemini_not_configured", "Gemini video analysis is not configured on the Corex server.");
  const input = validatePrepareContentInput(body);
  let visual;
  try { visual = await analyzeVideoImpl({ binaryDir, binary: input.binary, mimeType: input.mimeType, apiKey: geminiApiKey, model: geminiModel }); }
  catch (error) {
    if (error instanceof GeminiVideoError) throw new PrepareContentError(422, error.code, error.message);
    if (/^(gemini_|visual_analysis_)/.test(String(error?.code || ""))) throw new PrepareContentError(422, error.code, "COREX could not analyze the downloaded video.");
    throw new PrepareContentError(422, "visual_analysis_failed", "COREX could not analyze the downloaded video.");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(OPENAI_RESPONSES_URL, { method: "POST", redirect: "error", signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(makeOpenAIRequest(input, model, visual)) });
  } catch (error) {
    if (error?.name === "AbortError") throw new PrepareContentError(504, "openai_timeout", "OpenAI did not respond in time.");
    throw new PrepareContentError(502, "openai_unavailable", "Corex could not reach OpenAI.");
  } finally { clearTimeout(timer); }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new PrepareContentError(502, "openai_authentication_failed", "The Corex OpenAI configuration could not be authenticated.");
    if (response.status === 429) throw new PrepareContentError(429, "openai_rate_limited", "OpenAI is temporarily rate limited. Try again shortly.");
    throw new PrepareContentError(502, "openai_request_failed", "OpenAI could not prepare content right now.");
  }
  let data;
  try { data = await response.json(); } catch { throw new PrepareContentError(502, "openai_malformed_response", "OpenAI returned an invalid Prepare Content response."); }
  let parsed;
  try { parsed = JSON.parse(responseText(data)); } catch { throw new PrepareContentError(502, "openai_malformed_response", "OpenAI returned an invalid Prepare Content response."); }
  return normalizePreparedContent(parsed, input.hashtagCount, visual);
}

module.exports = { DEFAULT_OPENAI_MODEL, OPENAI_RESPONSES_URL, PrepareContentError, makeOpenAIRequest, normalizePreparedContent, prepareContent, validatePrepareContentInput };
