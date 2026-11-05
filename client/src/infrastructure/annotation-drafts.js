const listeners = new Set();
const draftKey = (threadId) => `cx-annotation-drafts-${threadId}`;

export function subscribeAnnotationDrafts(listener) {
  listeners.add(listener);
  globalThis.addEventListener?.("storage", listener);
  return () => {
    listeners.delete(listener);
    globalThis.removeEventListener?.("storage", listener);
  };
}

export function readAnnotationDrafts(threadId) {
  return parseDrafts(localStorage.getItem(draftKey(threadId)));
}

export function parseDrafts(raw) {
  try {
    const entries = JSON.parse(raw);
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

export function writeAnnotationDrafts(threadId, entries) {
  if (entries.length)
    localStorage.setItem(draftKey(threadId), JSON.stringify(entries));
  else localStorage.removeItem(draftKey(threadId));
  for (const listener of listeners) listener();
}

export function removeSentAnnotations(threadId, sent) {
  writeAnnotationDrafts(
    threadId,
    readAnnotationDrafts(threadId).filter(
      (entry) =>
        !sent.some((old) => JSON.stringify(old) === JSON.stringify(entry)),
    ),
  );
}

export function migrateAnnotationDraft(threadId, messageId) {
  const key = `cx-annotation-${threadId}-${messageId}`;
  const raw = localStorage.getItem(key);
  if (!raw) return;
  try {
    const entry = JSON.parse(raw);
    if (entry?.text) {
      const entries = readAnnotationDrafts(threadId);
      const id = `legacy-${messageId}`;
      if (!entries.some((entry) => entry.id === id))
        writeAnnotationDrafts(threadId, [...entries, { ...entry, id }]);
      localStorage.removeItem(key);
    }
  } catch {
    // 保留无法解析的旧草稿，避免迁移时丢失本地内容。
  }
}

export const annotationDraftSnapshot = (threadId) =>
  localStorage.getItem(draftKey(threadId));
