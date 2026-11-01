import { saved, persist } from "../infrastructure/storage.js";
import { isCompacting } from "../domain/compaction.js";
export function createAppState() {
  let state = {
    auth: null,
    authError: "",
    connected: false,
    booting: true,
    serverVersion: null,
    threads: [],
    archived: false,
    search: "",
    current: null,
    items: [],
    turns: {},
    turnTimings: {},
    active: {},
    unreadCompletions: {},
    compactions: saved("cx-compactions", {}),
    questions: [],
    models: [],
    model: "",
    effort: "",
    serviceTier: undefined,
    mode: "default",
    cwd: saved("cx-cwd", ""),
    defaultCwd: "",
    projectless: saved("cx-projectless", false),
    projectlessCwd: null,
    projectlessRoot: "",
    projects: saved("cx-projects", []),
    projectOrder: null,
    projectlessDirectories: {},
    pins: saved("cx-pins", []),
    theme: saved("cx-theme", "system"),
    draft: "",
    attachments: [],
    skills: [],
    account: null,
    usage: null,
    usageLoading: false,
    usageError: "",
    tokenUsage: {},
    diffs: {},
    turnDiffs: {},
    undoneFiles: saved("cx-undone-files", {}),
    plans: {},
    busy: false,
    loading: false,
    threadAccess: null,
    error: "",
    notice: "",
    panel: null,
    panelFile: null,
    panelAgent: null,
    contextOpen: false,
    terminalOpen: false,
    terminals: {},
    sidebar: false,
    modal: null,
  };

  let { draft: initialDraft, ...sharedState } = state;
  const sharedListeners = new Set();
  const draftListeners = new Set();
  const subscribe = (listeners, listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  function set(patch) {
    if (patch.active) {
      const unreadCompletions = {
        ...(patch.unreadCompletions ?? state.unreadCompletions),
      };
      for (const id of Object.keys(patch.active)) delete unreadCompletions[id];
      patch = { ...patch, unreadCompletions };
    }
    if (patch.contextOpen === false)
      patch = { ...patch, panel: null, panelAgent: null };
    else if (patch.panel && patch.contextOpen === undefined)
      patch = { ...patch, contextOpen: true };
    if (patch.cwd) persist("cx-cwd", patch.cwd);
    if (patch.projectless !== undefined)
      persist("cx-projectless", patch.projectless);
    if (patch.compactions)
      persist(
        "cx-compactions",
        Object.fromEntries(
          Object.entries(patch.compactions).filter(([, entry]) =>
            isCompacting(entry),
          ),
        ),
      );
    const previousDraft = state.draft;
    state = { ...state, ...patch };
    // 输入草稿单独订阅，避免每次输入重新渲染历史、侧栏与文件面板。
    const { draft, ...sharedPatch } = patch;
    const sharedChanged = Object.keys(sharedPatch).some(
      (key) => !Object.is(sharedState[key], sharedPatch[key]),
    );
    if (sharedChanged) sharedState = { ...sharedState, ...sharedPatch };
    if (sharedChanged) for (const fn of sharedListeners) fn();
    if (!Object.is(previousDraft, state.draft))
      for (const fn of draftListeners) fn();
  }
  return {
    get: () => state,
    set,
    sharedSnapshot: () => sharedState,
    draftSnapshot: () => state.draft,
    subscribe: (listener) => subscribe(sharedListeners, listener),
    subscribeDraft: (listener) => subscribe(draftListeners, listener),
  };
}
