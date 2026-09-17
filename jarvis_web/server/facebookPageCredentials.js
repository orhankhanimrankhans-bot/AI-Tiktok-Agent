"use strict";
const { FacebookCredentialStore } = require("./facebookCredentialStore");
const { FacebookGraphError, validatePageId } = require("./facebookGraph");
const { publicMetaData, secretValues } = require("./metaPublicData");
const { requireWorkspace } = require("./metaAppConfigStore");

function createFacebookPageCredentials({ credentialStore, metaConfigStore, graphServiceFactory }) {
  function source(id, owner) {
    requireWorkspace(owner);
    if (!FacebookCredentialStore.isValidId(id)) throw new FacebookGraphError(400, "invalid_credential_id", "Select a valid Facebook credential.");
    const credential = credentialStore.get(id, { owner, includeTokens: true });
    if (!credential) throw new FacebookGraphError(404, "credential_not_found", "Facebook credential not found.");
    if (credential.authMode !== "oauth" || !credential.tokens?.userAccessToken) {
      throw new FacebookGraphError(409, "facebook_reconnect_required", "Connect a Facebook account with OAuth to discover its Pages.");
    }
    return credential;
  }
  async function discover(id, owner, assertActive = () => {}) {
    const credential = source(id, owner), config = metaConfigStore.require(owner, credential);
    let available;
    try { available = await graphServiceFactory(owner, credential).pages(credential.tokens.userAccessToken); }
    catch (error) {
      // Never return provider payloads (which can contain Page tokens) to the browser.
      if ([401, 403].includes(error.statusCode)) throw new FacebookGraphError(409, "facebook_reconnect_required", "Refresh authorization through Reconnect Facebook to access your Pages.");
      throw new FacebookGraphError(502, "facebook_pages_unavailable", "Could not load your Facebook Pages. Try Refresh Pages again.");
    }
    assertActive();
    const current = source(id, owner);
    if (metaConfigStore.require(owner, current).revision !== config.revision || current.updatedAt !== credential.updatedAt
      || current.tokens.userAccessToken !== credential.tokens.userAccessToken || current.appId !== credential.appId) {
      throw new FacebookGraphError(409, "facebook_authorization_changed", "Facebook authorization changed. Refresh Pages before adding a credential.");
    }
    const secrets = [...secretValues(current.tokens), ...Object.values(available.pageTokens || {})];
    available = { ...available, pages: publicMetaData(available.pages, secrets) };
    return { credential: current, available };
  }
  return {
    async list(id, owner, assertActive) {
      const { credential, available } = await discover(id, owner, assertActive);
      const credentials = credentialStore.list(owner);
      return { pages: available.pages.map(page => {
        const existing = credentials.find(c => c.pageId === String(page.id));
        return { id: String(page.id), name: String(page.name || "Facebook Page"), credentialId: existing?.id || null,
          connected: Boolean(existing), canAdd: !existing && Boolean(available.pageTokens?.[page.id]) };
      }) };
    },
    async add(id, pageId, owner, assertActive) {
      const target = validatePageId(pageId);
      const { credential, available } = await discover(id, owner, assertActive);
      const page = available.pages.find(p => String(p.id) === target), token = available.pageTokens?.[target];
      if (!page || !token) throw new FacebookGraphError(403, "facebook_page_unavailable", "This Page is not authorized. Refresh Pages or reconnect Facebook.");
      return credentialStore.addPageCredential(credential, page, token, owner);
    }
  };
}

function registerFacebookPageCredentialRoutes(app, { getStore, getMetaConfigStore, graphServiceFactory, workspaceForRequest }) {
  const handler = adding => async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    try {
      const owner = requireWorkspace(workspaceForRequest(req));
      if (Object.keys(req.query || {}).length || (adding && (!req.body || Array.isArray(req.body)
        || Object.keys(req.body).some(k => k !== "pageId")))) {
        throw new FacebookGraphError(400, "invalid_page_request", "Only a Page ID is accepted.");
      }
      const service = createFacebookPageCredentials({ credentialStore: getStore(), metaConfigStore: getMetaConfigStore(), graphServiceFactory });
      const assertActive = () => {
        const now = requireWorkspace(workspaceForRequest(req));
        if (now.ownerType !== owner.ownerType || now.ownerId !== owner.ownerId) throw new FacebookGraphError(401, "workspace_changed", "Sign in again to continue.");
      };
      const result = adding ? await service.add(req.params.credentialId, req.body.pageId, owner, assertActive)
        : await service.list(req.params.credentialId, owner, assertActive);
      return res.status(adding && result.created ? 201 : 200).json(result);
    } catch (error) {
      return res.status(error instanceof FacebookGraphError ? error.statusCode : 500).json({
        code: error instanceof FacebookGraphError ? error.code : "facebook_pages_failed",
        error: error instanceof FacebookGraphError ? error.message : "Facebook Page operation could not be completed." });
    }
  };
  app.get("/api/facebook/credentials/:credentialId/pages", handler(false));
  app.post("/api/facebook/credentials/:credentialId/pages", handler(true));
}
module.exports = { createFacebookPageCredentials, registerFacebookPageCredentialRoutes };
