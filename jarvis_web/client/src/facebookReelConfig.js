import { resolveExpression } from "./expressionResolver.js";

export const FACEBOOK_OPERATION_READ = "Graph API Request";
export const FACEBOOK_OPERATION_PUBLISH_REEL = "Publish Reel";

export function facebookNodeDefaults() {
  return { operation: FACEBOOK_OPERATION_READ, credentialId: "", method: "GET", apiVersion: "", endpoint: "",
    queryParameters: [], headers: [], bodyParameters: [], sendBinaryData: false, binaryProperty: "data",
    title: "{{ $json.title }}", description: "{{ $json.socialCaption }}", waitForProcessing: true, pageVideo: { pageId: "", description: "", published: false } };
}

export function buildFacebookReelRequest(config, item) {
  if (!config?.credentialId) throw new Error("Select a connected Facebook credential.");
  const binaryProperty = String(config.binaryProperty || "data").trim();
  if (!/^[A-Za-z_$][\w$]{0,63}$/.test(binaryProperty)) throw new Error("Enter a valid Binary Property.");
  if (!item || typeof item !== "object" || item.binary?.property !== binaryProperty || !item.binary?.referenceId) {
    throw new Error(`Binary property ${binaryProperty} does not contain a downloaded video reference.`);
  }
  if (String(item.mimeType || "").toLowerCase() !== "video/mp4" || !/\.mp4$/i.test(String(item.fileName || ""))) {
    throw new Error("Publish Reel requires an MP4 video from the previous node.");
  }
  return { credentialId: config.credentialId, binaryProperty, binary: { property: item.binary.property,
    referenceId: item.binary.referenceId, size: item.binary.size }, fileName: item.fileName, mimeType: item.mimeType,
    title: String(resolveExpression(config.title || "", item) ?? ""),
    description: String(resolveExpression(config.description || "", item) ?? ""), waitForProcessing: config.waitForProcessing !== false };
}
