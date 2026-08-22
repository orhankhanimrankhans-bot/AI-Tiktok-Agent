import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { executePerItem } from "./expressionResolver.js";
import { buildFacebookReelRequest, FACEBOOK_OPERATION_PUBLISH_REEL, facebookNodeDefaults } from "./facebookReelConfig.js";
import { executeWithLifecycle } from "./workflowExecution.js";

const item = { fileId: "drive-1", fileName: "clip.mp4", mimeType: "video/mp4", binary: { property: "data", referenceId: "bin_1234567890123456789012", size: 42 } };

test("Publish Reel defaults and request preserve only the binary reference", () => {
  const defaults = facebookNodeDefaults(); assert.equal(defaults.binaryProperty, "data"); assert.equal(defaults.waitForProcessing, true);
  const request = buildFacebookReelRequest({ ...defaults, operation: FACEBOOK_OPERATION_PUBLISH_REEL, credentialId: "fcred_1234567890123456789012",
    title: "Reel {{ $json.fileId }}", description: "Video {{ $json.fileName }}" }, item);
  assert.equal(request.title, "Reel drive-1"); assert.equal(request.description, "Video clip.mp4"); assert.equal(request.binary.referenceId, item.binary.referenceId);
  assert.deepEqual(Object.keys(request.binary).sort(), ["property", "referenceId", "size"]); assert.doesNotMatch(JSON.stringify(request), /access.?token|Authorization|video-bytes/i);
});

test("Publish Reel rejects missing binary reference and unsupported files", () => {
  const config = { ...facebookNodeDefaults(), credentialId: "fcred_1234567890123456789012" };
  assert.throws(() => buildFacebookReelRequest(config, {}), /downloaded video reference/i);
  assert.throws(() => buildFacebookReelRequest(config, { ...item, fileName: "clip.mov", mimeType: "video/quicktime" }), /requires an MP4/i);
});

test("Facebook editor renders Reel controls and dispatcher uses the Reel endpoint", () => {
  const source = fs.readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  const configSource = fs.readFileSync(new URL("./facebookReelConfig.js", import.meta.url), "utf8");
  assert.match(configSource, /Publish Reel/);
  for (const label of ["Binary Property", "Title", "Description / Caption", "Wait for Processing"]) assert.match(source, new RegExp(label.replace("/", "\\/")));
  assert.match(source, /buildFacebookReelRequest\(node\.config, item\)/);
  assert.match(source, /api\/facebook\/reels\/publish/);
  assert.match(source, /executePerItem\(input/);
});

test("multiple Reel items execute sequentially with one safe result per input", async () => {
  const order = []; const items = [item, { ...item, fileId: "drive-2", fileName: "second.mp4", binary: { ...item.binary, referenceId: "bin_0000000000000000000000" } }];
  const results = await executePerItem(items, async (current) => { order.push(current.fileId); return { success: true, videoId: current.fileId, status: "published" }; });
  assert.deepEqual(order, ["drive-1", "drive-2"]); assert.deepEqual(results.map((result) => result.videoId), order);
});

test("Publish Reel uses shared running, success, and error lifecycle states", async () => {
  const successStates = []; const success = await executeWithLifecycle({ node: { id: "facebook", name: "Facebook Graph API" }, input: item,
    executor: async () => ({ success: true, status: "published" }), onTransition: (node) => successStates.push(node.status) });
  assert.deepEqual(successStates, ["running", "success"]); assert.equal(success.output.status, "published");
  const errorStates = []; const failed = await executeWithLifecycle({ node: { id: "facebook", name: "Facebook Graph API" }, input: item,
    executor: async () => { throw new Error("Facebook Reel processing failed."); }, onTransition: (node) => errorStates.push(node.status) });
  assert.deepEqual(errorStates, ["running", "error"]); assert.match(failed.error, /processing failed/i);
});
