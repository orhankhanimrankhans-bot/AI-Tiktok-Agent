"use strict";

const fs = require("fs");
const path = require("path");
const { CredentialStore, YOUTUBE_PROVIDER } = require("./credentialStore");

const PRIVACY_STATUSES = new Set(["private", "unlisted", "public"]);
const BINARY_REFERENCE = /^bin_[A-Za-z0-9_-]{22}$/;

class YouTubeUploadError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = "YouTubeUploadError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function normalizeTags(value) {
  const tags = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(tags.map((tag) => String(tag).trim()).filter(Boolean))].slice(0, 50);
}

function normalizeUploadRequest(request = {}) {
  const credentialId = String(request.credentialId || "").trim();
  if (!CredentialStore.isValidId(credentialId)) throw new YouTubeUploadError(400, "invalid_credential_id", "Select a valid YouTube credential.");
  const binaryProperty = String(request.binaryProperty || "data").trim();
  if (!/^[A-Za-z_$][\w$]{0,63}$/.test(binaryProperty)) throw new YouTubeUploadError(400, "invalid_binary_property", "Enter a valid Binary Property.");
  const binary = request.binary;
  if (!binary || binary.property !== binaryProperty || !BINARY_REFERENCE.test(String(binary.referenceId || ""))) {
    throw new YouTubeUploadError(400, "missing_binary", `Binary property ${binaryProperty} does not contain a downloaded video reference.`);
  }
  const title = String(request.title || "").trim();
  if (!title || title.length > 100) throw new YouTubeUploadError(400, "invalid_title", "YouTube title is required and must be 100 characters or fewer.");
  const description = String(request.description || "");
  if (description.length > 5000) throw new YouTubeUploadError(400, "invalid_description", "YouTube description must be 5,000 characters or fewer.");
  const privacyStatus = String(request.privacyStatus || "private").toLowerCase();
  if (!PRIVACY_STATUSES.has(privacyStatus)) throw new YouTubeUploadError(400, "invalid_privacy_status", "Choose private, unlisted, or public privacy.");
  const mimeType = String(request.mimeType || "video/mp4").toLowerCase();
  if (!mimeType.startsWith("video/")) throw new YouTubeUploadError(400, "invalid_video", "YouTube upload requires a video file.");
  const categoryId = String(request.categoryId || "").trim();
  if (categoryId && !/^\d{1,6}$/.test(categoryId)) throw new YouTubeUploadError(400, "invalid_category", "Enter a valid numeric YouTube category ID.");
  return { credentialId, binaryProperty, binary, title, description, privacyStatus, mimeType,
    madeForKids: request.madeForKids === true || request.madeForKids === "yes", tags: normalizeTags(request.tags), categoryId,
    sourceFileId: String(request.sourceFileId || ""), sourceFileName: String(request.sourceFileName || request.fileName || "") };
}

function youtubeFailure(error) {
  if (error instanceof YouTubeUploadError) return error;
  const status = Number(error?.response?.status || error?.code || 0);
  const reason = String(error?.response?.data?.error?.errors?.[0]?.reason || "");
  if (status === 401) return new YouTubeUploadError(401, "invalid_youtube_credential", "The YouTube credential is expired or invalid. Reconnect it and try again.");
  if (status === 403 && /insufficientPermissions|insufficient_scope/i.test(reason)) return new YouTubeUploadError(403, "insufficient_youtube_scope", "The credential lacks YouTube upload permission. Reconnect it and grant access.");
  if (status === 403 && /quota/i.test(reason)) return new YouTubeUploadError(429, "youtube_quota_exceeded", "YouTube API upload quota is unavailable. Try again after quota resets.");
  if (status === 400) return new YouTubeUploadError(400, "youtube_rejected_upload", "YouTube rejected the video metadata or media file.");
  return new YouTubeUploadError(502, "youtube_upload_failed", "YouTube could not complete the video upload.");
}

async function executeYouTubeUpload({ request, owner, credentialStore, createOAuthClient, createYouTubeClient, binaryDir, logger = console }) {
  const params = normalizeUploadRequest(request);
  const credential = await credentialStore.get(params.credentialId, { includeTokens: true, owner, provider: YOUTUBE_PROVIDER });
  if (!credential) throw new YouTubeUploadError(404, "youtube_credential_not_found", "The selected YouTube credential was not found or is disconnected.");
  const auth = createOAuthClient();
  if (!auth) throw new YouTubeUploadError(503, "google_oauth_not_configured", "Google OAuth is not configured on the server.");
  auth.setCredentials(credential.tokens);
  let refreshed = null;
  auth.on("tokens", (tokens) => { refreshed = { ...(refreshed || {}), ...tokens }; });
  const filePath = path.resolve(binaryDir, params.binary.referenceId);
  const relative = path.relative(path.resolve(binaryDir), filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(filePath)) throw new YouTubeUploadError(404, "binary_not_found", "The downloaded video reference is unavailable. Download the file again.");
  const youtube = createYouTubeClient(auth);
  try {
    const inserted = await youtube.videos.insert({
      part: ["snippet", "status"],
      requestBody: { snippet: { title: params.title, description: params.description,
        ...(params.tags.length ? { tags: params.tags } : {}), ...(params.categoryId ? { categoryId: params.categoryId } : {}) },
      status: { privacyStatus: params.privacyStatus, selfDeclaredMadeForKids: params.madeForKids } },
      media: { mimeType: params.mimeType, body: fs.createReadStream(filePath) },
    });
    const videoId = String(inserted.data?.id || "");
    if (!videoId) throw new YouTubeUploadError(502, "youtube_missing_video_id", "YouTube accepted the upload without returning a video ID.");
    let details = inserted.data || {};
    try {
      const response = await youtube.videos.list({ part: ["snippet", "status", "processingDetails"], id: [videoId] });
      details = response.data?.items?.[0] || details;
    } catch (error) {
      logger.warn?.("YouTube processing status was unavailable", { videoId });
    }
    return { success: true, videoId, channelId: String(details.snippet?.channelId || inserted.data?.snippet?.channelId || ""),
      channelTitle: String(details.snippet?.channelTitle || inserted.data?.snippet?.channelTitle || credential.accountName || ""),
      title: String(details.snippet?.title || params.title), privacyStatus: String(details.status?.privacyStatus || params.privacyStatus),
      uploadStatus: String(details.status?.uploadStatus || inserted.data?.status?.uploadStatus || "uploaded"),
      ...(details.processingDetails?.processingStatus ? { processingStatus: String(details.processingDetails.processingStatus) } : {}),
      sourceFileId: params.sourceFileId, sourceFileName: params.sourceFileName,
      youtubeUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}` };
  } catch (error) {
    logger.error?.("YouTube upload failed safely", { code: error?.code || "youtube_upload_failed" });
    throw youtubeFailure(error);
  } finally {
    if (refreshed) await credentialStore.save({ id: credential.id, provider: YOUTUBE_PROVIDER, accountEmail: credential.accountEmail,
      accountName: credential.accountName, tokens: { ...credential.tokens, ...refreshed } }, owner);
  }
}

module.exports = { executeYouTubeUpload, normalizeUploadRequest, normalizeTags, YouTubeUploadError };
