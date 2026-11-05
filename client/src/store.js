import { useSyncExternalStore } from "react";
import { createApplication } from "./application/create-application.js";
export {
  uid,
  basename,
  titleOf,
  b64decode,
  b64encode,
} from "./domain/format.js";
export { persist } from "./infrastructure/storage.js";
const application = createApplication();
export const {
  setReadingThread,
  openSubAgent,
  selectModel,
  selectEffort,
  syncProjectModels,
  onEvent,
  report,
  notice,
  listThreads,
  rpc,
  refreshUsage,
  setCompletionNotifications,
  startNotifications,
  respond,
  loadThreads,
  setDraft,
  setProjectDirectory,
  newChat,
  openThread,
  refreshThreadAccess,
  loadHistory,
  ensureThread,
  sendMessage,
  stop,
  rename,
  archive,
  deleteThread,
  fork,
  compact,
  refreshCompaction,
  review,
  loadSkills,
  pin,
  addProject,
  toggleProjectPin,
  addAttachment,
  attachFile,
  cancelMessageEdit,
  setTheme,
  copy,
  applySession,
  checkSession,
  login,
  logout,
} = application;
export const { get, set } = application.store;
export function useStore() {
  return useSyncExternalStore(
    application.store.subscribe,
    application.store.sharedSnapshot,
  );
}
export function useDraft() {
  return useSyncExternalStore(
    application.store.subscribeDraft,
    application.store.draftSnapshot,
  );
}
