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
