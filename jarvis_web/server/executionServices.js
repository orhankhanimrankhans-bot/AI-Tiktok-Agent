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
    google: { ...google, searchFiles: (request, owner) => executeDriveSearch({ request, owner, ...google, logger }),
      downloadFile: (request, owner) => executeDriveDownload({ request, owner, ...google, binaryDir: required("binaryDirectory", input.binaryDirectory) }),
      moveFile: (request, owner) => executeDriveMove({ request, owner, ...google }) },
    facebook: { graphRequest: (request, owner) => required("facebookExecutionContext", input.facebookExecutionContext).graphRequest(request, owner),
      publishReel: (request, owner) => required("facebookExecutionContext", input.facebookExecutionContext).publishReel(request, owner) },
    youtube: { uploadVideo: (request, owner) => executeYouTubeUpload({ request, owner, credentialStore: google.credentialStore,
      createOAuthClient: google.createOAuthClient, createYouTubeClient: required("createYouTubeClient", input.createYouTubeClient),
      binaryDir: required("binaryDirectory", input.binaryDirectory), logger }) },
    binary: { directory: required("binaryDirectory", input.binaryDirectory) },
    openAI: { prepare: (request) => required("prepareContent", input.prepareContent)({ ...request, binaryDir: required("binaryDirectory", input.binaryDirectory),
      geminiApiKey: input.geminiApiKey || "", geminiModel: input.geminiModel, logger }),
      apiKey: required("openAIApiKey", input.openAIApiKey), model: required("openAIModel", input.openAIModel) },
    history: { store: required("executionStore", input.executionStore) },
    logger,
  };
  Object.defineProperty(services, "publicCapabilities", { enumerable: true, value: Object.freeze({ google: true, facebook: true, youtube: true, binaryReferences: true, prepareContent: true, executionHistory: true }) });
  return Object.freeze(services);
}

module.exports = { createExecutionServices };
