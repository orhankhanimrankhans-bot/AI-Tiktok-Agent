export const TIKTOK_OPERATION = "Upload to Inbox";
export function tiktokNodeDefaults() {
  return { operation: TIKTOK_OPERATION, credentialId: "", binaryProperty: "data", uploadConsent: false };
}
export function buildTikTokUploadRequest(config, item) {
  if (!/^[a-f0-9]{64}$/.test(config?.credentialId || "")) throw new Error("Select a connected TikTok account.");
  if (config?.uploadConsent !== true) throw new Error("Authorize inbox uploads in the TikTok node.");
  const binaryProperty = String(config.binaryProperty || "data");
  if (!/^[A-Za-z_$][\w$]{0,63}$/.test(binaryProperty) || item?.binary?.property !== binaryProperty || !/^bin_[A-Za-z0-9_-]{22}$/.test(item?.binary?.referenceId || "")) throw new Error("TikTok requires a downloaded video binary reference.");
  return { operation: TIKTOK_OPERATION, credentialId: config.credentialId, uploadConsent: true, binaryProperty,
    binary: { property: binaryProperty, referenceId: item.binary.referenceId }, mimeType: item.mimeType, fileName: item.fileName,
    sourceFileId: item.sourceFileId || item.fileId, sourceFileName: item.sourceFileName || item.fileName };
}
