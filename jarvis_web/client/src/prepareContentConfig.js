import { resolveExpression } from "./expressionResolver.js";

export const PREPARE_CONTENT_TONES = ["Natural", "Fun", "Professional", "Informative", "Inspirational"];

export function prepareContentDefaults() {
  return { inputSource: "Downloaded Video Frames", fileName: "{{ $json.fileName }}",
    titleInstructions: "Create a concise, specific title naming the real object and visible action.",
    captionInstructions: "Describe exactly what visibly happens in the video without unsupported claims.",
    hashtagCount: 5, language: "English", tone: "Natural", preserveInput: true };
}

export function buildPrepareContentRequest(config, item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Prepare Content requires item input.");
  const hashtagCount = Number(config?.hashtagCount);
  if (!Number.isInteger(hashtagCount) || hashtagCount < 1 || hashtagCount > 20) throw new Error("Hashtag count must be between 1 and 20.");
  if (!PREPARE_CONTENT_TONES.includes(config?.tone)) throw new Error("Select a supported tone.");
  return {
    fileName: String(resolveExpression(config.fileName || "{{ $json.fileName }}", item) ?? ""),
    mimeType: typeof item.mimeType === "string" ? item.mimeType : "", binary: item.binary,
    titleInstructions: String(config.titleInstructions || ""), captionInstructions: String(config.captionInstructions || ""),
    hashtagCount, language: String(config.language || "English"), tone: config.tone,
  };
}

export function mergePreparedContent(item, generated, preserveInput = true) {
  const fields = { detectedObject: generated.detectedObject, detectedAction: generated.detectedAction,
    title: generated.title, description: generated.description, caption: generated.caption,
    hashtags: generated.hashtags, socialCaption: generated.socialCaption };
  return preserveInput ? { ...item, ...fields } : fields;
}
