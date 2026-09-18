"use strict";
const { analyzeVideo, GeminiVideoError } = require("./geminiVideoAnalysis");

function validateConfiguration(provider = "developer", vertex = {}) {
  if (!["developer", "vertex"].includes(provider)) throw new GeminiVideoError("gemini_invalid_configuration", "Select a supported Gemini provider on the server.");
  if (provider === "vertex" && (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(vertex.project || "")
    || !/^(global|[a-z]+(?:-[a-z]+)+[0-9])$/.test(vertex.location || "")
    || !/^[a-z0-9][a-z0-9_-]{1,220}[a-z0-9]$/.test(vertex.bucket || "")
    || !/^gemini-[a-z0-9][a-z0-9.-]{1,100}$/.test(vertex.model || ""))) {
    throw new GeminiVideoError("gemini_invalid_configuration", "Vertex video analysis requires a project, location, private bucket and supported model configured on the server.");
  }
}

function readConfiguration(env = process.env) {
  const provider = env.GEMINI_PROVIDER || "developer";
  const vertex = Object.freeze({ project: env.GEMINI_VERTEX_PROJECT || env.GOOGLE_CLOUD_PROJECT || "", location: env.GEMINI_VERTEX_LOCATION || env.GOOGLE_CLOUD_LOCATION || "",
    bucket: env.GEMINI_VERTEX_BUCKET || "", model: env.GEMINI_VERTEX_MODEL || "" });
  let configured = false;
  try { validateConfiguration(provider, vertex); configured = provider === "vertex" || Boolean(env.GEMINI_API_KEY); } catch {}
  // Configured means fields present, not proof of IAM, billing or live access.
  return Object.freeze({ provider, vertex, configured });
}

async function analyzeConfiguredVideo(options) {
  validateConfiguration(options.provider, options.vertex);
  if ((options.provider || "developer") === "developer") return analyzeVideo(options);
  return require("./geminiVertexVideoAnalysis").analyzeVertexVideo(options);
}

module.exports = { validateConfiguration, readConfiguration, analyzeConfiguredVideo };
