import { resolveExpression } from "./expressionResolver.js";

export const PREPARE_CONTENT_TONES = ["Natural", "Fun", "Professional", "Informative", "Inspirational"];

export function prepareContentDefaults() {
  return { inputSource: "Previous Item Metadata", fileName: "{{ $json.fileName }}",
    titleInstructions: "Create a concise, engaging social media title based only on the filename and metadata.",
    captionInstructions: "Create a natural social media caption based only on the filename and metadata. Do not claim to have viewed the video.",
    hashtagCount: 5, language: "English", tone: "Natural", preserveInput: true };
}

export function buildPrepareContentRequest(config, item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Prepare Content requires item input.");
  const hashtagCount = Number(config?.hashtagCount);
  if (!Number.isInteger(hashtagCount) || hashtagCount < 1 || hashtagCount > 20) throw new Error("Hashtag count must be between 1 and 20.");
  if (!PREPARE_CONTENT_TONES.includes(config?.tone)) throw new Error("Select a supported tone.");
  return {
    fileName: String(resolveExpression(config.fileName || "{{ $json.fileName }}", item) ?? ""),
    mimeType: typeof item.mimeType === "string" ? item.mimeType : "",
    titleInstructions: String(config.titleInstructions || ""), captionInstructions: String(config.captionInstructions || ""),
    hashtagCount, language: String(config.language || "English"), tone: config.tone,
  };
}

export function mergePreparedContent(item, generated, preserveInput = true) {
  const fields = { title: generated.title, caption: generated.caption, hashtags: generated.hashtags, socialCaption: generated.socialCaption };
  return preserveInput ? { ...item, ...fields } : fields;
}
