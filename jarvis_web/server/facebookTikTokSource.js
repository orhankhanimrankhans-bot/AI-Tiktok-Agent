"use strict";
const { credentialPageToken } = require("./facebookGraph");
const { MAX_VIDEO_BYTES, validateVideo } = require("./tiktokApi");

class CrosspostError extends Error {
  constructor(message, statusCode = 400) { super(message); this.statusCode = statusCode; }
}
function mediaUrl(value) {
  let url; try { url = new URL(value); } catch { throw new CrosspostError("Facebook did not provide a downloadable video."); }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")
    || !["fbcdn.net", "fbsbx.com"].some(domain => url.hostname.endsWith(`.${domain}`))) {
    throw new CrosspostError("Facebook returned an unsupported video host. No download was attempted.");
  }
  return url;
}
async function boundedBytes(response, maximum) {
  if (!response.ok || !response.body) throw new CrosspostError("The provider could not return this video or listing.", 502);
  if (Number(response.headers.get("content-length")) > maximum) { await response.body.cancel(); throw new CrosspostError("The response exceeds the supported size."); }
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maximum) throw new CrosspostError("The response exceeds the supported size.");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
function createFacebookTikTokSource({ credentialStore, graphServiceFactory, fetchImpl = fetch }) {
  function credential(owner, id, pageId) {
    const value = credentialStore.get(id, { owner, includeTokens: true });
    if (!value || !/^\d{3,30}$/.test(pageId || "") || value.pageId !== pageId) throw new CrosspostError("Select a connected Facebook Page in this workspace.", 403);
    const graph = graphServiceFactory(owner, value); // checks the existing workspace Meta configuration
    return { token: credentialPageToken(value, pageId), base: graph.baseUrl };
  }
  async function graph(context, node, params) {
    if (!/^https:\/\/graph\.facebook\.com\/v\d+\.\d+$/.test(context.base)) throw new CrosspostError("Meta API configuration is unavailable.", 503);
    const url = new URL(`${context.base}/${node}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    let data;
    try {
      const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${context.token}` }, redirect: "error", signal: AbortSignal.timeout(30000) });
      data = JSON.parse((await boundedBytes(response, 2 * 1024 * 1024)).toString());
    } catch { throw new CrosspostError("Facebook could not return Page videos. Check the existing Page connection and read permissions.", 502); }
    if (data.error) throw new CrosspostError("Facebook denied video access. Check Page ownership and pages_read_engagement permission.", 403);
    return data;
  }
  return {
    validate: credential,
    async list(owner, id, pageId) {
      const context = credential(owner, id, pageId), videos = [], seen = new Set(); let after;
      for (let batch = 0; batch < 5; batch++) {
        const data = await graph(context, `${pageId}/videos`, { fields: "id,description,created_time,permalink_url", type: "uploaded", limit: "100", ...(after ? { after } : {}) });
        if (!Array.isArray(data.data)) throw new CrosspostError("Facebook returned an invalid video list.", 502);
        for (const video of data.data) if (/^\d{3,30}$/.test(video?.id || "")) videos.push({ id: video.id, caption: String(video.description || "").slice(0, 2200), createdAt: Date.parse(video.created_time) || 0 });
        if (!data.paging?.next) return { videos, limited: false };
        after = data.paging?.cursors?.after;
        if (typeof after !== "string" || after.length > 4096 || seen.has(after)) throw new CrosspostError("Facebook pagination could not be completed.", 502);
        seen.add(after);
      }
      return { videos, limited: true };
    },
    async download(owner, id, pageId, videoId) {
      const context = credential(owner, id, pageId);
      if (!/^\d{3,30}$/.test(videoId)) throw new CrosspostError("Invalid source video.");
      const data = await graph(context, videoId, { fields: "id,from,source" });
      if (data.id !== videoId || String(data.from?.id) !== pageId) throw new CrosspostError("This video does not belong to the selected Page.", 403);
      let bytes;
      try { bytes = await boundedBytes(await fetchImpl(mediaUrl(data.source), { redirect: "error", signal: AbortSignal.timeout(60000) }), MAX_VIDEO_BYTES); }
      catch (error) { if (error instanceof CrosspostError) throw error; throw new CrosspostError("Facebook video download failed. Refresh the source and try again.", 502); }
      validateVideo(bytes, "video/mp4");
      return bytes;
    }
  };
}
module.exports = { createFacebookTikTokSource, CrosspostError, mediaUrl, boundedBytes };
