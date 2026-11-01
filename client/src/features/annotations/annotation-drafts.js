import { useMemo, useSyncExternalStore } from "react";
import {
  subscribeAnnotationDrafts,
  parseDrafts,
  annotationDraftSnapshot,
} from "../../infrastructure/annotation-drafts.js";
export {
  readAnnotationDrafts,
  writeAnnotationDrafts,
  migrateAnnotationDraft,
  removeSentAnnotations,
} from "../../infrastructure/annotation-drafts.js";
export function useAnnotationDrafts(threadId) {
  const raw = useSyncExternalStore(subscribeAnnotationDrafts, () =>
    annotationDraftSnapshot(threadId),
  );
  return useMemo(() => parseDrafts(raw), [raw]);
}
