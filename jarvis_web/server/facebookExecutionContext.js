"use strict";
const { containsForbiddenSecretFields, credentialPageToken, executeCredentialMe, executeCredentialPages, FacebookGraphError, validatePageId } = require("./facebookGraph");

function required(name, value) { if (!value) throw new Error(`Facebook execution dependency is required: ${name}`); return value; }

function graphRequestError(statusCode, code, message, responseBody = null) {
  const error = new FacebookGraphError(statusCode, code, message);
  error.publicBody = responseBody;
  return error;
}

function sourceMetadata(request) {
  const source = {};
  if (request?.sourceFileId !== undefined) {
    if (typeof request.sourceFileId !== "string" || !/^[A-Za-z0-9_-]{1,255}$/.test(request.sourceFileId)) {
      throw graphRequestError(400, "invalid_source_file_id", "Source file ID is invalid.");
    }
    source.sourceFileId = request.sourceFileId;
  }
  if (request?.sourceFileName !== undefined) {
    if (typeof request.sourceFileName !== "string" || !request.sourceFileName || request.sourceFileName.length > 255 || /[\\/\x00-\x1F]/.test(request.sourceFileName)) {
      throw graphRequestError(400, "invalid_source_file_name", "Source file name is invalid.");
    }
    source.sourceFileName = request.sourceFileName;
  }
  return source;
}

function toLegacyReelResponse(result) {
  const { sourceFileId, sourceFileName, ...legacy } = result || {};
  return legacy;
}

function validateGraphOperation({ credentialId, method, endpoint, body, query }, validateCredentialId) {
  if (method !== "POST") throw graphRequestError(405, "unsupported_graph_method", "Unsupported Facebook Graph method.");
  if (!Object.values(endpoint ? { endpoint } : {}).length || !["me", "pages", "page"].includes(endpoint)) {
    throw graphRequestError(400, "invalid_graph_endpoint", "Unsupported Facebook Graph endpoint.");
  }
  if (containsForbiddenSecretFields({ body, query })) {
    throw graphRequestError(400, "client_supplied_secret", "Facebook secrets must not be supplied by the client.", { error: "Facebook secrets must not be supplied by the client." });
  }
  if (!validateCredentialId(credentialId)) {
    throw graphRequestError(400, "invalid_credential_id", "Select a valid Facebook credential.", { error: "Select a valid Facebook credential." });
  }
  if (query && Object.keys(query).length) throw graphRequestError(400, "unsupported_graph_query", "Unsupported Facebook Graph query.");
}

function createFacebookExecutionContext({ credentialStore, graphServiceFactory, publishPageReel, binaryDirectory, binaryResolver, validateCredentialId = () => true, logger = console }) {
  required("credentialStore", credentialStore); required("graphServiceFactory", graphServiceFactory); required("publishPageReel", publishPageReel); required("binaryDirectory", binaryDirectory);
  function resolveBinaryReference(referenceId) {
    return binaryResolver ? binaryResolver(referenceId) : { referenceId, binaryDirectory };
  }
  async function graphRequest(request) {
    const input = request || {};
    validateGraphOperation(input, validateCredentialId);
    const credential = credentialStore.get(input.credentialId, { includeTokens: true });
    if (!credential?.tokens?.userAccessToken && !credential?.tokens?.pageAccessToken) {
      throw graphRequestError(404, "credential_disconnected", "Facebook credential was not found or is disconnected.", { error: "Facebook credential was not found or is disconnected." });
    }
    const service = graphServiceFactory();
    if (input.endpoint === "me") return executeCredentialMe(service, credential);
    if (input.endpoint === "pages") {
      const result = await executeCredentialPages(service, credential);
      credentialStore.save({ id: credential.id, accountId: credential.accountId, accountName: credential.accountName,
        tokens: { ...credential.tokens, pageAccessTokens: result.pageTokens } });
      return { pages: result.pages };
    }
    return service.pageMetadata(validatePageId(input.body?.pageId), credentialPageToken(credential, input.body?.pageId));
  }
  async function publishReel(request) {
    const input = request || {};
    if (containsForbiddenSecretFields(input)) {
      throw graphRequestError(400, "client_supplied_secret", "Facebook secrets must not be supplied by the client.", { error: "Facebook secrets must not be supplied by the client." });
    }
    if (!validateCredentialId(input.credentialId)) {
      throw graphRequestError(400, "invalid_credential_id", "Select a valid Facebook credential.", { error: "Select a valid Facebook credential." });
    }
    const source = sourceMetadata(input);
    const credential = credentialStore.get(input.credentialId, { includeTokens: true });
    if (!credential?.tokens?.userAccessToken && !credential?.tokens?.pageAccessToken) {
      throw graphRequestError(404, "credential_disconnected", "Facebook credential was not found or is disconnected.", { error: "Facebook credential was not found or is disconnected." });
    }
    if (!input.binary?.referenceId) {
      const property = String(input.binaryProperty || "data").trim() || "data";
      throw graphRequestError(400, "missing_binary_reference", `Binary property ${property} does not contain a valid downloaded file reference.`);
    }
    const binary = resolveBinaryReference(input.binary?.referenceId);
    if (!binary || binary.referenceId !== input.binary?.referenceId) {
      throw graphRequestError(400, "missing_binary_reference", "Binary property data does not contain a valid downloaded file reference.");
    }
    const result = await publishPageReel({ request: input, service: graphServiceFactory(), credential,
      binaryDir: binary.binaryDirectory || binaryDirectory });
    return result?.success === true ? { ...result, ...source } : result;
  }
  return Object.freeze({
    resolveCredential(credentialId) { return credentialStore.get(credentialId, { includeTokens: true }); },
    createGraphService() { return graphServiceFactory(); },
    graphRequest,
    publishReel,
    publishPageReel,
    resolveBinaryReference,
    logger,
  });
}

module.exports = { createFacebookExecutionContext, toLegacyReelResponse };
