import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { ARCHIVE_AFTER_PUBLISH_ERROR, buildArchiveMoveRequest, preservePublishedSource } from "./postPublishArchive.js";

const config = { credentialId: "gcred_1234567890123456789012", fileId: "{{ $json.sourceFileId }}", destinationFolderId: "done_folder_1" };

test("Facebook published output preserves the exact original Drive file ID safely", () => {
  const output = preservePublishedSource({ success: true, status: "published", videoId: "video_1", pageId: "page_1" },
    { fileId: "source_file_1", fileName: "clip.mp4", binary: { referenceId: "bin_private" } });
  assert.deepEqual(output, { success: true, status: "published", videoId: "video_1", pageId: "page_1",
    sourceFileId: "source_file_1", sourceFileName: "clip.mp4" });
  assert.doesNotMatch(JSON.stringify(output), /referenceId|Authorization|access.?token/i);
});

test("archive request uses configured Done folder and gates on confirmed Facebook publication", () => {
  assert.deepEqual(buildArchiveMoveRequest(config, { success: true, status: "published", sourceFileId: "source_file_1" }), {
    credentialId: config.credentialId, fileId: "source_file_1", destinationFolderId: "done_folder_1",
  });
  assert.throws(() => buildArchiveMoveRequest(config, { success: false, status: "error", sourceFileId: "source_file_1" }), /successfully published/);
  assert.throws(() => buildArchiveMoveRequest(config, { success: true, status: "submitted", sourceFileId: "source_file_1" }), /successfully published/);
  assert.throws(() => buildArchiveMoveRequest({ ...config, destinationFolderId: "" }, { success: true, status: "published", sourceFileId: "source_file_1" }), /Done folder ID/);
});

test("post-publish archive failure message distinguishes publishing from moving", () => {
  assert.equal(ARCHIVE_AFTER_PUBLISH_ERROR, "Facebook Reel published successfully, but the source video could not be moved to the Done folder.");
});

test("Move File node exposes Folder ID configuration and the real move route", () => {
  const source = fs.readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  assert.match(source, /nodeId === "google-move"[\s\S]{0,250}destinationFolderId/);
  assert.match(source, /Destination Folder ID/); assert.match(source, /\/api\/google\/drive\/\$\{action\}/);
  assert.match(source, /buildArchiveMoveRequest/); assert.match(source, /preservePublishedSource/);
});
