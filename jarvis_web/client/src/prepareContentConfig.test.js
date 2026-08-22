import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { buildPrepareContentRequest, mergePreparedContent, prepareContentDefaults } from "./prepareContentConfig.js";
import { runLinearWorkflow } from "./workflowRunner.js";

test("Prepare Content defaults and request expose metadata only", () => {
  const item = { id: "file-1", fileName: "clip.mp4", mimeType: "video/mp4", binary: { property: "data", referenceId: "bin_private" }, accessToken: "never-send" };
  const request = buildPrepareContentRequest(prepareContentDefaults(), item);
  assert.deepEqual(Object.keys(request), ["fileName", "mimeType", "titleInstructions", "captionInstructions", "hashtagCount", "language", "tone"]);
  assert.equal(request.fileName, "clip.mp4"); assert.doesNotMatch(JSON.stringify(request), /bin_private|never-send|binary|accessToken/);
});

test("merge preserves original metadata and binary reference for Facebook", () => {
  const item = { fileName: "clip.mp4", binary: { property: "data", referenceId: "bin_123" } };
  const generated = { title: "Title", caption: "Caption", hashtags: ["#one"], socialCaption: "Caption\n\n#one" };
  assert.deepEqual(mergePreparedContent(item, generated, true), { ...item, ...generated });
  assert.deepEqual(mergePreparedContent(item, generated, false), generated);
});

test("workflow runner propagates Download through Prepare Content to Facebook per item", async () => {
  const nodes = [{ id: "schedule", name: "Schedule Trigger" }, { id: "download", name: "Download File" }, { id: "prepare", name: "Prepare Content" }, { id: "facebook", name: "Facebook Graph API" }];
  const connections = [{ source: "schedule", target: "download" }, { source: "download", target: "prepare" }, { source: "prepare", target: "facebook" }];
  let facebookInput;
  await runLinearWorkflow({ nodes, connections, executeNode: async (node, input) => {
    if (node.id === "schedule") return { triggered: true };
    if (node.id === "download") return [{ fileName: "a.mp4", binary: { property: "data", referenceId: "bin_a" } }, { fileName: "b.mp4", binary: { property: "data", referenceId: "bin_b" } }];
    if (node.id === "prepare") return input.map((item) => mergePreparedContent(item, { title: item.fileName, caption: "Caption", hashtags: ["#tag"], socialCaption: "Caption\n\n#tag" }));
    facebookInput = input; return input.map(() => ({ status: "published" }));
  } });
  assert.deepEqual(facebookInput.map((item) => [item.title, item.binary.referenceId, item.socialCaption]), [["a.mp4", "bin_a", "Caption\n\n#tag"], ["b.mp4", "bin_b", "Caption\n\n#tag"]]);
});

test("node picker, dispatcher, editor, and Facebook expression wiring are registered", () => {
  const source = fs.readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  assert.match(source, /name:\s*"Prepare Content"/); assert.match(source, /provider:\s*"Jarvis AI"/);
  for (const term of ["OpenAI", "Generate Content", "caption", "hashtags"]) assert.match(source, new RegExp(term, "i"));
  assert.match(source, /node\.name === "Prepare Content"/); assert.match(source, /\/api\/ai\/prepare-content/);
  assert.match(source, /editingNode\?\.name === "Prepare Content"/);
  const reelSource = fs.readFileSync(new URL("./facebookReelConfig.js", import.meta.url), "utf8");
  assert.match(reelSource, /\{\{ \$json\.socialCaption \}\}/);
});
