const fs = require("fs");
const path = require("path");
const { FacebookGraphError } = require("./facebookGraph");

const BINARY_REFERENCE = /^bin_[A-Za-z0-9_-]{22}$/;
const UPLOAD_HOST = "rupload.facebook.com";

function reelError(statusCode, code, message) { return new FacebookGraphError(statusCode, code, message); }

function validateUploadUrl(value) {
  let url; try { url = new URL(String(value || "")); } catch { throw reelError(502, "invalid_upload_url", "Meta returned an invalid Reel upload destination."); }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== UPLOAD_HOST || url.port || url.username || url.password) {
    throw reelError(502, "invalid_upload_url", "Meta returned an untrusted Reel upload destination.");
  }
  return url;
}

function resolveBinaryReference({ binaryDir, binary, binaryProperty = "data", fileName, mimeType }) {
  if (!binary || binary.property !== binaryProperty || !BINARY_REFERENCE.test(String(binary.referenceId || ""))) {
    throw reelError(400, "missing_binary_reference", `Binary property ${binaryProperty} does not contain a valid downloaded file reference.`);
  }
  if (String(mimeType || "").toLowerCase() !== "video/mp4" || !/\.mp4$/i.test(String(fileName || ""))) {
    throw reelError(415, "unsupported_reel_file", "Publish Reel requires an MP4 video file.");
  }
  const root = path.resolve(binaryDir); const filePath = path.resolve(root, binary.referenceId);
  if (path.dirname(filePath) !== root) throw reelError(400, "invalid_binary_reference", "The downloaded file reference is invalid.");
  let stat; try { stat = fs.lstatSync(filePath); } catch { throw reelError(404, "binary_not_found", "The downloaded video is missing or has expired."); }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size < 1) throw reelError(400, "invalid_binary_file", "The downloaded video is not a usable file.");
  return { filePath, size: stat.size, fileName: path.basename(String(fileName)) };
}

function cleanText(value, field, limit) {
  if (value == null) return "";
  if (typeof value !== "string") throw reelError(400, `invalid_${field}`, `${field} must be text.`);
  if (value.length > limit) throw reelError(400, `${field}_too_long`, `${field} is too long.`);
  return value;
}

async function pageContext(service, credential) {
  if (!credential || !["manual_access_token", "oauth"].includes(credential.authMode)) {
    throw reelError(400, "unsupported_credential", "Select a supported Facebook credential.");
  }
  let token;
  if (credential?.authMode === "manual_access_token") token = credential?.tokens?.pageAccessToken;
  else {
    const stored = Object.values(credential?.tokens?.pageAccessTokens || {}).filter(Boolean);
    if (stored.length === 1) token = stored[0];
    else {
      const discovered = await service.pages(credential?.tokens?.userAccessToken);
      const discoveredTokens = Object.values(discovered.pageTokens || {}).filter(Boolean);
      if (discoveredTokens.length !== 1) throw reelError(409, "ambiguous_oauth_page", "Managed Meta OAuth publishing requires a credential with exactly one available Facebook Page.");
      token = discoveredTokens[0];
    }
  }
  if (!token) throw reelError(404, "credential_disconnected", "Facebook credential was not found or is disconnected.");
  const page = await service.pageIdentity(token);
  if (!/^\d{3,30}$/.test(String(page.id || "")) || !String(page.name || "").trim()) throw reelError(400, "wrong_token_type", "The credential did not identify a usable Facebook Page.");
  return { token, pageId: String(page.id), pageName: String(page.name) };
}

async function uploadVideo({ fetchImpl, uploadUrl, token, filePath, size, timeoutMs = 120000 }) {
  const url = validateUploadUrl(uploadUrl); const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  const body = fs.createReadStream(filePath); let response;
  try {
    response = await fetchImpl(url, { method: "POST", redirect: "error", signal: controller.signal, duplex: "half",
      headers: { Authorization: `OAuth ${token}`, offset: "0", file_size: String(size), "Content-Type": "application/octet-stream" },
      body });
  } catch (error) {
    if (error?.name === "AbortError") throw reelError(504, "reel_upload_timeout", "Facebook Reel upload timed out.");
    throw reelError(502, "reel_upload_failed", "Facebook rejected or could not receive the Reel upload.");
  } finally { clearTimeout(timer); body.destroy(); }
  let data = {}; try { data = await response.json(); } catch { /* safe failure below */ }
  if (!response.ok || data.success !== true) throw reelError(response.status === 429 ? 429 : 502, "reel_upload_rejected", "Facebook rejected the Reel video upload.");
}

function phaseValue(status, phase, key = "status") { return String(status?.status?.[phase]?.[key] || "").toLowerCase(); }
function published(status) { return phaseValue(status, "processing_phase") === "complete" && phaseValue(status, "publishing_phase") === "complete" && phaseValue(status, "publishing_phase", "publish_status") === "published"; }
function processingFailed(status) {
  const values = ["uploading_phase", "processing_phase", "publishing_phase"].flatMap((phase) => Object.values(status?.status?.[phase] || {}));
  return values.some((value) => /failed|error|copyright|rejected/.test(String(value).toLowerCase()));
}

async function waitForPublished({ service, token, videoId, maxAttempts = 20, intervalMs = 3000, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const status = await service.reelStatus(token, videoId);
    if (published(status)) return status.status;
    if (processingFailed(status)) throw reelError(422, "reel_processing_failed", "Facebook reported that Reel processing or publishing failed.");
    if (attempt + 1 < maxAttempts) await sleep(intervalMs);
  }
  throw reelError(504, "reel_processing_timeout", "Facebook Reel processing did not complete before the timeout.");
}

async function publishPageReel(options) {
  const binaryProperty = String(options.request.binaryProperty || "data").trim() || "data";
  if (!/^[A-Za-z_$][\w$]{0,63}$/.test(binaryProperty)) throw reelError(400, "invalid_binary_property", "Binary Property is invalid.");
  const file = resolveBinaryReference({ binaryDir: options.binaryDir, binary: options.request.binary, binaryProperty,
    fileName: options.request.fileName, mimeType: options.request.mimeType });
  const title = cleanText(options.request.title, "title", 255); const description = cleanText(options.request.description, "description", 63206);
  const page = await pageContext(options.service, options.credential);
  const session = await options.service.startPageReelUpload(page.token);
  await uploadVideo({ fetchImpl: options.uploadFetch || fetch, uploadUrl: session.uploadUrl, token: page.token,
    filePath: file.filePath, size: file.size, timeoutMs: options.uploadTimeoutMs });
  await options.service.finishPageReelUpload(page.token, { videoId: session.videoId, title, description });
  const wait = options.request.waitForProcessing !== false;
  if (wait) await waitForPublished({ service: options.service, token: page.token, videoId: session.videoId,
    maxAttempts: options.maxAttempts, intervalMs: options.intervalMs, sleep: options.sleep });
  return { success: true, videoId: session.videoId, pageId: page.pageId, pageName: page.pageName,
    fileName: file.fileName, status: wait ? "published" : "submitted" };
}

module.exports = { pageContext, processingFailed, publishPageReel, resolveBinaryReference, uploadVideo, validateUploadUrl, waitForPublished };
