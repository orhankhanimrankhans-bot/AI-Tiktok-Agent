export function instagramNodeDefaults() { return { operation: "Publish Reel", credentialId: "", binaryProperty: "data", caption: "{{ $json.socialCaption }}", shareToFeed: true, publishConsent: false }; }
export function buildInstagramRequest(config, item, resolve = value => value) {
  if (!/^[a-f0-9]{64}$/.test(config?.credentialId || "")) throw new Error("Select a connected Instagram account.");
  if (config.publishConsent !== true) throw new Error("Authorize publishing in the Instagram node.");
  return { operation: "Publish Reel", credentialId: config.credentialId, publishConsent: true, binaryProperty: config.binaryProperty || "data", binary: item?.binary,
    caption: resolve(config.caption || "", item), shareToFeed: config.shareToFeed !== false, fileName: item?.fileName, sourceFileId: item?.sourceFileId || item?.fileId, sourceFileName: item?.sourceFileName || item?.fileName };
}
