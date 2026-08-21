export function googleCredentialLabel(credential) {
  const identity = credential?.accountEmail || credential?.accountName || "Account";
  return `Google Drive - ${identity}`;
}

export function selectOAuthCredential(credentials, credentialId) {
  if (!credentialId || !Array.isArray(credentials)) return null;
  return credentials.find((credential) => credential.id === credentialId) || null;
}

export function assignCredentialToNode(nodes, nodeId, credentialId) {
  if (!nodeId || !credentialId) return nodes;
  return nodes.map((node) =>
    node.id === nodeId
      ? { ...node, config: { ...(node.config || {}), credentialId } }
      : node
  );
}

export function buildDriveSearchRequest(config = {}) {
  if (!config.credentialId) {
    throw new Error("Select a Google Drive credential before executing.");
  }
  if (config.searchMethod === "Search File/Folder Name" && !String(config.query || "").trim()) {
    throw new Error("Enter a file or folder name to search for.");
  }
  return {
    credentialId: config.credentialId,
    query: String(config.query || "").trim(),
    folderId: String(config.folderId || "").trim(),
    mimeType: config.mimeType || "Any",
    returnAll: config.returnAll === true,
    limit: Number(config.limit) || 50,
    searchMethod: config.searchMethod || "Search File/Folder Name",
  };
}
