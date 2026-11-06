export function newDraftKey(backendId = "codex") {
  return backendId === "codex" ? "cx-draft-new" : `cx-draft-new-${backendId}`;
}
