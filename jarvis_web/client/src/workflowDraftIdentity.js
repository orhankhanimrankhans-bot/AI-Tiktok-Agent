export function workflowDraftKey(session) {
  if (!session) return null;
  const role = session.role === "owner" ? "admin" : session.role;
  if (!["admin", "additional", "child"].includes(role)) return null;
  const id = role === "additional" ? session.profileId : "primary";
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,255}$/.test(id)) return null;
  return `jarvis_workflow_v3:${role}:${id}`;
}
export function canStartNewDraft(source, nodes, dirty) {
  return !dirty && (source === "server" || !nodes?.length);
}
