import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { buildYouTubeUploadRequest, youtubeNodeDefaults } from "./youtubeConfig.js";

test("YouTube node defaults and expressions build one safe binary upload request", () => {
  const item = { fileId: "drive-1", fileName: "clip.mp4", mimeType: "video/mp4", title: "COREX title", socialCaption: "COREX description", binary: { property: "data", referenceId: "bin_private", size: 42 } };
  const request = buildYouTubeUploadRequest({ ...youtubeNodeDefaults(), credentialId: "gcred_youtube", privacyStatus: "unlisted", tags: "corex, video", categoryId: "22" }, item);
  assert.deepEqual(request, { credentialId: "gcred_youtube", binaryProperty: "data", binary: item.binary, fileName: "clip.mp4", mimeType: "video/mp4", title: "COREX title", description: "COREX description", privacyStatus: "unlisted", madeForKids: false, tags: "corex, video", categoryId: "22", sourceFileId: "drive-1", sourceFileName: "clip.mp4" });
});

test("YouTube node is discoverable and wired to OAuth, editor, and upload API", () => {
  const source = fs.readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  assert.match(source, /id:\s*"youtube-upload"[\s\S]*provider:\s*"YouTube"[\s\S]*name:\s*"YouTube"/);
  assert.match(source, /editingNode\?\.name === "YouTube"/); assert.match(source, /\/api\/youtube\/auth\/start/);
  assert.match(source, /\/api\/youtube\/credentials/); assert.match(source, /\/api\/youtube\/videos\/upload/);
  for (const field of ["Binary Property", "Title", "Description", "Privacy Status", "Made for Kids", "Tags", "Category ID"]) assert.match(source, new RegExp(field));
  assert.doesNotMatch(source, /youtube[^\n]*(accessToken|refreshToken)/i);
});

test("YouTube upload rejects a missing binary property safely", () => {
  assert.throws(() => buildYouTubeUploadRequest({ ...youtubeNodeDefaults(), credentialId: "gcred_youtube" }, { title: "x" }), /downloaded video reference/);
});
