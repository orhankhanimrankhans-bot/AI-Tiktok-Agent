import { resolveExpression } from "./expressionResolver.js";

export const ARCHIVE_AFTER_PUBLISH_ERROR = "Facebook Reel published successfully, but the source video could not be moved to the Done folder.";

export function preservePublishedSource(publication, sourceItem) {
  if (publication?.success !== true) return publication;
  return { ...publication, sourceFileId: sourceItem?.fileId, sourceFileName: sourceItem?.fileName };
}

export function buildArchiveMoveRequest(config, publication) {
  if (publication?.success !== true || publication?.status !== "published") {
    throw new Error("Move File requires a successfully published Facebook Reel result.");
  }
  const fileId = String(resolveExpression(config?.fileId || "", publication) || "").trim();
  const destinationFolderId = String(config?.destinationFolderId || "").trim();
  if (!config?.credentialId) throw new Error("Select a Google Drive credential before executing.");
  if (!fileId) throw new Error("The published Reel result is missing its source Google Drive file ID.");
  if (!destinationFolderId) throw new Error("Enter the Google Drive Done folder ID.");
  return { credentialId: config.credentialId, fileId, destinationFolderId };
}
