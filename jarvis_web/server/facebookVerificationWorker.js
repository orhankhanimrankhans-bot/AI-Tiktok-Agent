"use strict";
const { FacebookGraphError } = require("./facebookGraph");
const { verificationFromStatus } = require("./facebookReels");

function createFacebookVerificationWorker({ store, credentialStore, graphServiceFactory, intervalMs = 60_000, logger = console }) {
  let timer = null; let running = false;
  async function tick() {
    if (running) return false; running = true;
    try { for (const job of store.due()) {
      const publication = store.get(job.video_id); const owner = { ownerType: job.owner_type || publication?.ownerType, ownerId: job.owner_id || publication?.ownerId };
      try {
        const credential = credentialStore.get(publication.credentialId, { includeTokens: true, owner });
        if (!credential) throw new FacebookGraphError(404, "credential_disconnected", "Facebook credential was not found or is disconnected.");
        const token = credential.authMode === "manual_access_token" ? credential.tokens.pageAccessToken : credential.tokens.pageAccessTokens?.[publication.expectedPageId];
        if (!token) throw new FacebookGraphError(404, "credential_disconnected", "Facebook Page authorization is unavailable.");
        const response = await graphServiceFactory().reelStatus(token, publication.videoId, "facebook_delayed_verify");
        store.completeCheck(publication.videoId, job.checkpoint_minutes, verificationFromStatus(response));
      } catch (error) {
        const unavailable = error instanceof FacebookGraphError && [400, 404].includes(error.statusCode) && ["meta_100", "meta_803", "meta_404"].includes(error.code);
        store.completeCheck(publication.videoId, job.checkpoint_minutes, { status: unavailable ? "unavailable_after_publish" : "verification_failed",
          metaVerification: unavailable ? "unavailable" : "failed", diagnostic: error?.diagnostic || { stage: "facebook_delayed_verify", httpStatus: error?.statusCode } });
        logger.warn?.("Facebook delayed verification did not verify", { videoId: publication.videoId, checkpointMinutes: job.checkpoint_minutes, code: error?.code || "verification_error" });
      }
    } return true; } finally { running = false; }
  }
  return Object.freeze({ tick, start() { if (!timer) timer = setInterval(tick, intervalMs); timer?.unref?.(); }, stop() { if (timer) clearInterval(timer); timer = null; } });
}
module.exports = { createFacebookVerificationWorker };
