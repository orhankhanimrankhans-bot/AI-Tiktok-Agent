"use strict";
const { executeDriveSearch: productionDriveSearch } = require("./driveSearch");
const { executeDriveDownload: productionDriveDownload, executeDriveMove: productionDriveMove } = require("./driveFiles");
const { executeYouTubeUpload: productionYouTubeUpload } = require("./youtubeUpload");

function required(name, value) {
  if (!value) throw new Error(`Execution service dependency is required: ${name}`);
  return value;
}

function createExecutionServices(dependencies) {
  const input = dependencies || {};
  const logger = input.logger || console;
  const google = { credentialStore: required("credentialStore", input.credentialStore), createOAuthClient: required("createOAuthClient", input.createOAuthClient), createDriveClient: required("createDriveClient", input.createDriveClient) };
  const executeDriveSearch = input.executeDriveSearch || productionDriveSearch;
  const executeDriveDownload = input.executeDriveDownload || productionDriveDownload;
  const executeDriveMove = input.executeDriveMove || productionDriveMove;
  const executeYouTubeUpload = input.executeYouTubeUpload || productionYouTubeUpload;
  const services = {
    videoSelection: input.videoSelection,
    google: { ...google, searchFiles: (request, owner) => executeDriveSearch({ request, owner, ...google, logger }),
      downloadFile: async (request, owner) => {
        const result = await executeDriveDownload({ request, owner, ...google, binaryDir: required("binaryDirectory", input.binaryDirectory) });
        return input.prepareContentPolicy ? input.prepareContentPolicy.register(result, owner) : result;
      },
      moveFile: (request, owner) => executeDriveMove({ request, owner, ...google }) },
    facebook: { graphRequest: (request, owner) => required("facebookExecutionContext", input.facebookExecutionContext).graphRequest(request, owner),
      publishReel: (request, owner) => required("facebookExecutionContext", input.facebookExecutionContext).publishReel(request, owner) },
    youtube: { uploadVideo: (request, owner) => executeYouTubeUpload({ request, owner, credentialStore: google.credentialStore,
      createOAuthClient: google.createOAuthClient, createYouTubeClient: required("createYouTubeClient", input.createYouTubeClient),
      binaryDir: required("binaryDirectory", input.binaryDirectory), logger }) },
    instagram: { publishReel: (request, owner) => required("instagramService", input.instagramService).publishReel(request, owner) },
    tiktok: { uploadVideo: (request, owner) => required("tiktokWorkflowService", input.tiktokWorkflowService).uploadVideo(request, owner) },
    binary: { directory: required("binaryDirectory", input.binaryDirectory) },
    openAI: { prepare: async (request, owner) => {
      const run = () => required("prepareContent", input.prepareContent)({ ...request, binaryDir: required("binaryDirectory", input.binaryDirectory),
        geminiApiKey: input.geminiApiKey || "", geminiModel: input.geminiModel, geminiProvider: input.geminiProvider || "developer", geminiVertex: input.geminiVertex, logger });
      if (!input.prepareContentPolicy) return run();
      const sleep = input.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
      for (let attempt = 0; ; attempt++) {
        try { return await input.prepareContentPolicy.run(request.body?.binary?.referenceId, owner, run); }
        catch (error) {
          // Admission failures consume no daily attempt and have no publishing side effects.
          if (error.code !== "prepare_content_busy" || attempt >= 12) throw error;
          await sleep(5000);
        }
      }
    },
      apiKey: required("openAIApiKey", input.openAIApiKey), model: required("openAIModel", input.openAIModel) },
    history: { store: required("executionStore", input.executionStore) },
    logger,
  };
  Object.defineProperty(services, "publicCapabilities", { enumerable: true, value: Object.freeze({ google: true, facebook: true, youtube: true, binaryReferences: true, prepareContent: true, executionHistory: true }) });
  return Object.freeze(services);
}

module.exports = { createExecutionServices };
