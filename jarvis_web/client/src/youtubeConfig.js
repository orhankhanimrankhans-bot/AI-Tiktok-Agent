import { resolveExpression } from "./expressionResolver.js";

export const YOUTUBE_OPERATION_UPLOAD = "Upload Video";
export const YOUTUBE_PRIVACY_STATUSES = ["private", "unlisted", "public"];

export function youtubeNodeDefaults() {
  return { operation: YOUTUBE_OPERATION_UPLOAD, credentialId: "", binaryProperty: "data",
    title: "{{ $json.title }}", description: "{{ $json.socialCaption }}", privacyStatus: "private",
    madeForKids: false, tags: "", categoryId: "" };
}

export function youtubeCredentialLabel(credential) {
  const identity = credential?.accountEmail || credential?.accountName || "YouTube account";
  return `${identity} · YouTube`;
}

export function buildYouTubeUploadRequest(config, item) {
  if (!config?.credentialId) throw new Error("Select a connected YouTube credential.");
  const binaryProperty = String(config.binaryProperty || "data").trim();
  if (!/^[A-Za-z_$][\w$]{0,63}$/.test(binaryProperty)) throw new Error("Enter a valid Binary Property.");
  if (!item || typeof item !== "object" || item.binary?.property !== binaryProperty || !item.binary?.referenceId) {
    throw new Error(`Binary property ${binaryProperty} does not contain a downloaded video reference.`);
  }
  const privacyStatus = String(config.privacyStatus || "private").toLowerCase();
  if (!YOUTUBE_PRIVACY_STATUSES.includes(privacyStatus)) throw new Error("Choose a valid YouTube privacy status.");
  return { credentialId: config.credentialId, binaryProperty,
    binary: { property: item.binary.property, referenceId: item.binary.referenceId, size: item.binary.size },
    fileName: item.fileName, mimeType: item.mimeType,
    title: String(resolveExpression(config.title || "", item) ?? ""),
    description: String(resolveExpression(config.description || "", item) ?? ""),
    privacyStatus, madeForKids: config.madeForKids === true || config.madeForKids === "yes",
    tags: String(resolveExpression(config.tags || "", item) ?? ""),
    categoryId: String(resolveExpression(config.categoryId || "", item) ?? ""),
    sourceFileId: item.sourceFileId || item.fileId, sourceFileName: item.sourceFileName || item.fileName };
}
