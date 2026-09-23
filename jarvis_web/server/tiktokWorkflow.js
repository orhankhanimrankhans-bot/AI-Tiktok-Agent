"use strict";
const fs = require("node:fs/promises"), path = require("node:path"), crypto = require("node:crypto");
const { TikTokApi, TikTokError, configFromEnv, MAX_VIDEO_BYTES, validateVideo } = require("./tiktokApi");
const { hash } = require("./tiktokStore");

function createTikTokWorkflowService({ store, binaryDirectory, requireMedia, authorizeOwner, config = configFromEnv(), api = new TikTokApi(config), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const configHash = hash(JSON.stringify([config.clientKey, config.clientSecret, config.redirectUri]));
  const fail = (code, message, status = 400) => { throw new TikTokError(`tiktok_${code}`, message, status); };
  function connected(owner, accountRef) {
    authorizeOwner(owner);
    if (!config.configured) fail("not_configured", "TikTok app credentials must be configured on the server.", 503);
    const value = store.account(owner);
    if (!value || value.configHash !== configHash || accountRef !== hash(value.openId + configHash)) fail("account_changed", "Select the connected TikTok account again and authorize inbox uploads.", 409);
    return value;
  }
  async function uploadVideo(request, owner) {
    let account = connected(owner, request?.credentialId);
    if (request?.operation !== "Upload to Inbox" || request?.uploadConsent !== true) fail("consent_required", "Open the TikTok node and authorize sending its videos to your TikTok inbox.");
    const reference = String(request.binary?.referenceId || ""), property = String(request.binaryProperty || "data");
    if (!/^bin_[A-Za-z0-9_-]{22}$/.test(reference) || !/^[A-Za-z_$][\w$]{0,63}$/.test(property) || request.binary?.property !== property) fail("missing_binary", "TikTok requires the downloaded video's binary reference.");
    await requireMedia(reference, owner);
    if (!store.lock(owner)) fail("busy", "Another TikTok operation is running. Check its status before retrying.", 409);
    const deadline = Date.now() + 240000;
    try {
      const target = path.join(binaryDirectory, reference);
      const stat = await fs.lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_VIDEO_BYTES) fail("invalid_video", "TikTok supports downloaded videos up to 32 MiB.");
      const bytes = await fs.readFile(target);
      const mimeType = request.mimeType || "video/mp4"; validateVideo(bytes, mimeType);
      account = await api.access(account); store.save(owner, account);
      const fingerprint = hash(bytes), existing = store.duplicate(owner, account.openId, fingerprint);
      let id = existing?.id;
      if (!id) {
        id = crypto.randomUUID(); store.createJob(owner, account.openId, fingerprint, id);
        try {
          const result = await api.request("post/publish/inbox/video/init/", { token: account.accessToken, body: { source_info: {
            source: "FILE_UPLOAD", video_size: bytes.length, chunk_size: bytes.length, total_chunk_count: 1,
          } } });
          if (!result.data?.publish_id || !result.data?.upload_url) fail("invalid_response", "TikTok did not return upload tracking details.");
          store.updateJob(owner, id, "TRANSFERRING", result.data.publish_id);
          await api.transfer(result.data.upload_url, bytes, mimeType);
          store.updateJob(owner, id, "PROCESSING_UPLOAD");
        } catch (error) {
          store.updateJob(owner, id, "OUTCOME_UNCERTAIN");
          throw error;
        }
      }
      let job = store.job(owner, id);
      const accepted = status => ["SEND_TO_USER_INBOX", "PUBLISH_COMPLETE"].includes(status);
      if (!job.publish_id) fail("outcome_uncertain", "An earlier upload has an uncertain outcome. Check TikTok inbox and Corex TikTok status; no duplicate was sent.", 409);
      for (let attempt = 0; attempt < 10 && !accepted(job.status); attempt++) {
        if (Date.now() + 30000 >= deadline) break;
        const result = await api.request("post/publish/status/fetch/", { token: account.accessToken, body: { publish_id: job.publish_id } });
        const status = result.data?.status;
        if (!["PROCESSING_UPLOAD", "PROCESSING_DOWNLOAD", "SEND_TO_USER_INBOX", "PUBLISH_COMPLETE", "FAILED"].includes(status)) fail("unknown_status", "TikTok returned an unknown status. Source video retained.", 502);
        store.updateJob(owner, id, status); job = { ...job, status };
        if (status === "FAILED") fail("upload_failed", "TikTok could not process the upload. Source video retained; check your TikTok account.", 502);
        if (!accepted(status) && attempt < 9) await sleep(2000);
      }
      if (!accepted(job.status)) fail("processing", "TikTok is still processing. Check status in Corex TikTok; the source was not moved. A retry checks the existing upload.", 409);
      return { success: true, provider: "tiktok", status: "inbox_uploaded", inboxStatus: job.status, uploadId: id,
        published: job.status === "PUBLISH_COMPLETE", accountName: account.displayName,
        sourceFileId: request.sourceFileId || "", sourceFileName: request.sourceFileName || request.fileName || "",
        message: "Video delivered to TikTok inbox. Open TikTok to edit caption, choose settings, and finish posting." };
    } catch (error) {
      if (error instanceof TikTokError) { if (!error.code.startsWith("tiktok_")) error.code = `tiktok_${error.code}`; throw error; }
      fail("upload_error", "TikTok upload could not be completed. Check upload status before retrying.", 502);
    } finally { store.unlock(owner); }
  }
  return { uploadVideo, connected };
}
module.exports = { createTikTokWorkflowService };
