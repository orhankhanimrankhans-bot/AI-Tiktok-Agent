"use strict";
const { executeDriveSearch: productionDriveSearch } = require("./driveSearch");
const { executeDriveDownload: productionDriveDownload, executeDriveMove: productionDriveMove } = require("./driveFiles");

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
  const services = {
    google: { ...google, searchFiles: (request) => executeDriveSearch({ request, ...google, logger }),
      downloadFile: (request) => executeDriveDownload({ request, ...google, binaryDir: required("binaryDirectory", input.binaryDirectory) }),
      moveFile: (request) => executeDriveMove({ request, ...google }) },
    facebook: { graphRequest: required("facebookExecutionContext", input.facebookExecutionContext).graphRequest,
      publishReel: required("facebookExecutionContext", input.facebookExecutionContext).publishReel },
    binary: { directory: required("binaryDirectory", input.binaryDirectory) },
    openAI: { prepare: required("prepareContent", input.prepareContent), apiKey: required("openAIApiKey", input.openAIApiKey), model: required("openAIModel", input.openAIModel) },
    history: { store: required("executionStore", input.executionStore) },
    logger,
  };
  Object.defineProperty(services, "publicCapabilities", { enumerable: true, value: Object.freeze({ google: true, facebook: true, binaryReferences: true, prepareContent: true, executionHistory: true }) });
  return Object.freeze(services);
}

module.exports = { createExecutionServices };
