import { useSyncExternalStore } from "react";
import { fullAccessParams } from "./execution-policy";
import { modelServiceTiers, resolveServiceTier } from "./service-tier";
import { compatibleEffort } from "./model-preferences";
import { inputRequestItem } from "./question-state";
import { readThreadHistory } from "./thread-history";
import { isCompacting, recoverCompaction } from "./compaction";
import { annotationMessage } from "./annotations";
import { fileReferenceInput, parseUserMessage } from "./user-message.js";
import { mergeUsageUpdate } from "./account-usage.js";
import { nextForkTitle } from "./fork-title.js";
import {
  readAnnotationDrafts,
  removeSentAnnotations,
  writeAnnotationDrafts,
} from "./annotation-drafts";
import {
  createThreadOrdering,
  projectGroups,
  sortThreads,
  threadGroupPath,
  PROJECTLESS_SOURCE,
} from "./thread-order";

const listeners = new Set(),
  eventListeners = new Set(),
  pending = new Map();
const checkingCompactions = new Map();
let defaultModelSelection = { model: "", effort: "" };
let modelSelectionRevision = 0;
let projectModelsRemote = false;
let projectModelsSupported = false;
let projectModelsWriting = null;
let compactionTracking = false;
const saved = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
export const basename = (path) =>
  path?.split("/").filter(Boolean).at(-1) || "本机";
export const titleOf = (t) => t?.name?.trim() || t?.preview || "新对话";
export const b64decode = (text) =>
  new TextDecoder().decode(Uint8Array.from(atob(text), (c) => c.charCodeAt(0)));
export const b64encode = (text) => {
  const bytes = new TextEncoder().encode(text);
  let raw = "";
  for (let i = 0; i < bytes.length; i += 8192)
    raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(raw);
};
let state = {
  connected: false,
  booting: true,
  serverVersion: null,
  threads: [],
  threadCursor: null,
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
const { draft: initialDraft, ...initialSharedState } = state;
let sharedState = initialSharedState;
function subscribe(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}
export function set(patch) {
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
  state = { ...state, ...patch };
  // 输入草稿单独订阅，避免每次输入重新渲染历史、侧栏与文件面板。
  const { draft, ...sharedPatch } = patch;
  if (
    Object.keys(sharedPatch).some(
      (key) => !Object.is(sharedState[key], sharedPatch[key]),
    )
  )
    sharedState = { ...sharedState, ...sharedPatch };
  for (const fn of listeners) fn();
}
export function get() {
  return state;
}
let readingThreadId = null;
export function setReadingThread(id) {
  readingThreadId =
    state.current?.id === id &&
    !state.loading &&
    state.threadAccess?.status !== "loadError"
      ? id
      : null;
  if (!readingThreadId || !state.unreadCompletions[id]) return;
  const unreadCompletions = { ...state.unreadCompletions };
  delete unreadCompletions[id];
  set({ unreadCompletions });
}
export function openSubAgent(agent) {
  set({
    panel: "agent",
    panelAgent: { ...agent, parentId: state.current?.id },
    contextOpen: true,
  });
}
export function selectModel(model) {
  const tier = resolveServiceTier(state.serviceTier, model);
  const previous = state.models.find((entry) => entry.model === state.model);
  set({
    model: model.model,
    effort: compatibleEffort(
      state.effort || previous?.defaultReasoningEffort,
      model,
    ),
    serviceTier: modelServiceTiers(model).some((option) => option.id === tier)
      ? tier
      : null,
  });
  rememberModelSelection();
}
export function selectEffort(effort) {
  set({ effort });
  rememberModelSelection();
}
function rememberModelSelection() {
  if (!state.model) return;
  modelSelectionRevision++;
  const key = state.projectless ? "" : state.cwd;
  const model = state.models.find((entry) => entry.model === state.model);
  const selection = {
    model: state.model,
    effort: state.effort || model?.defaultReasoningEffort || "",
  };
  persist("cx-project-models", {
    ...saved("cx-project-models", {}),
    [key]: selection,
  });
  persist("cx-project-models-pending", {
    ...saved("cx-project-models-pending", {}),
    [key]: { selection, id: uid() },
  });
  flushProjectModels().catch(report);
}
function mergeProjectModels(projects) {
  const pending = saved("cx-project-models-pending", {});
  persist("cx-project-models", {
    ...projects,
    ...Object.fromEntries(
      Object.entries(pending).map(([key, entry]) => [key, entry.selection]),
    ),
  });
}
function flushProjectModels() {
  if (!projectModelsRemote || !state.connected) return Promise.resolve();
  if (projectModelsWriting) return projectModelsWriting;
  projectModelsWriting = (async () => {
    while (state.connected) {
      const [entry] = Object.entries(saved("cx-project-models-pending", {}));
      if (!entry) return;
      const [cwd, pending] = entry;
      const result = await rpc("lan/projectModels/set", {
        cwd,
        ...pending.selection,
        ifAbsent: pending.ifAbsent || false,
      });
      const remaining = saved("cx-project-models-pending", {});
      if (remaining[cwd]?.id === pending.id) delete remaining[cwd];
      persist("cx-project-models-pending", remaining);
      mergeProjectModels(result.projects);
    }
  })()
    .catch((error) => {
      throw new Error("项目模型设置保存失败：" + error.message);
    })
    .finally(() => {
      projectModelsWriting = null;
    });
  return projectModelsWriting;
}
export async function syncProjectModels() {
  const connection = socket;
  const result = await rpc("lan/projectModels/read");
  if (connection !== socket) return;
  projectModelsRemote = Boolean(result.projects);
  if (!projectModelsRemote) return;
  const pending = saved("cx-project-models-pending", {});
  for (const [key, selection] of Object.entries(saved("cx-project-models", {})))
    if (
      !Object.hasOwn(result.projects, key) &&
      !Object.hasOwn(pending, key) &&
      selection.model
    )
      pending[key] = { selection, id: uid(), ifAbsent: true };
  persist("cx-project-models-pending", pending);
  mergeProjectModels(result.projects);
  await flushProjectModels();
}
function projectModelSelection(
  cwd,
  projectless,
  fallback,
  models = state.models,
) {
  const preferences = saved("cx-project-models", {});
  const key = projectless ? "" : cwd;
  const selection = Object.hasOwn(preferences, key)
    ? preferences[key]
    : fallback;
  const model = models.find((entry) => entry.model === selection.model);
  return {
    model: selection.model,
    effort: compatibleEffort(selection.effort, model),
  };
}
export function useStore() {
  return useSyncExternalStore(subscribe, () => sharedState);
}
export function useDraft() {
  return useSyncExternalStore(subscribe, () => state.draft);
}
export function onEvent(fn) {
  eventListeners.add(fn);
  return () => eventListeners.delete(fn);
}
export function report(error) {
  if (error?.archivedThreadId) return;
  set({ error: error?.message || String(error) });
}
export function notice(text) {
  set({ notice: text });
  setTimeout(() => {
    if (state.notice === text) set({ notice: "" });
  }, 4000);
}
export function persist(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}
let socket,
  seq = 1,
  opening = 0,
  bootRevision = 0,
  initialized = false;
let pendingForks = saved("cx-pending-forks", []);
const deletedThreads = new Set();
const turnRevisions = new Map();
const threadNames = new Map();
let nameRevision = 0;
let accountRevision = 0,
  usageRevision = 0,
  usageRequest = null;
function preserveThreadName(thread, revision) {
  const update = threadNames.get(thread.id);
  return update?.revision > revision
    ? { ...thread, name: update.name }
    : thread;
}
function updateThreadName(threadId, name) {
  threadNames.set(threadId, { name, revision: ++nameRevision });
  set({
    threads: state.threads.map((thread) =>
      thread.id === threadId ? { ...thread, name } : thread,
    ),
    current:
      state.current?.id === threadId
        ? { ...state.current, name }
        : state.current,
  });
}
const threadOrdering = createThreadOrdering(rpc);
let listing = 0;
export const listThreads = (params) => threadOrdering.list(params);
export function rpc(method, params = {}, timeout = 120000) {
  return new Promise((resolve, reject) => {
    if (!state.connected || socket?.readyState !== WebSocket.OPEN)
      return reject(new Error("与电脑的连接尚未就绪，正在自动重连。"));
    const id = seq++;
    const message = JSON.stringify({
      id,
      method,
      params: fullAccessParams(method, params),
    });
    if (new TextEncoder().encode(message).byteLength > 64 * 1024 * 1024)
      return reject(
        new Error("单次消息过大（最多 64 MiB），请减少附件后重试。"),
      );
    const timer = timeout
      ? setTimeout(() => {
          pending.delete(id);
          reject(new Error("请求等待超时，请刷新会话查看任务状态。"));
        }, timeout)
      : null;
    pending.set(id, {
      method,
      resolve,
      reject,
      timer,
      threadId: params.threadId,
      opening,
    });
    socket.send(message);
  });
}
export function refreshUsage() {
  if (!state.connected || (state.account && state.account.type !== "chatgpt"))
    return Promise.resolve();
  const connection = socket;
  if (usageRequest?.connection === connection) return usageRequest.promise;
  const revision = usageRevision;
  const request = { connection };
  usageRequest = request;
  const current = () =>
    socket === connection && state.connected && revision === usageRevision;
  set({ usageLoading: true });
  request.promise = rpc("account/rateLimits/read", {}, 20000)
    .then((usage) => {
      if (current()) set({ usage, usageError: "" });
    })
    .catch((error) => {
      if (current()) set({ usageError: error.message });
    })
    .finally(() => {
      if (usageRequest === request) {
        usageRequest = null;
        set({ usageLoading: false });
      }
    });
  return request.promise;
}
export function respond(request, result, error) {
  try {
    if (!state.connected || socket.readyState !== WebSocket.OPEN)
      throw new Error("连接尚未就绪，请等待重连后提交回答。");
    if (!state.questions.some((q) => String(q.id) === String(request.id)))
      throw new Error("此请求已结束，请查看最新消息。");
    socket.send(
      JSON.stringify({ id: request.id, ...(error ? { error } : { result }) }),
    );
    recordInputRequest(request, error ? undefined : result?.answers);
    set({
      questions: state.questions.filter(
        (q) => String(q.id) !== String(request.id),
      ),
    });
    return true;
  } catch (error) {
    report(error);
    return false;
  }
}
function connect() {
  const connection = new WebSocket(
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/rpc`,
  );
  socket = connection;
  connection.onmessage = async (e) => {
    if (socket !== connection) return;
    const m = JSON.parse(e.data);
    if (m.method === "lan/projectModels/updated") {
      mergeProjectModels(m.params.projects);
      return;
    }
    if (m.method === "lan/state") {
      projectModelsSupported = m.params.projectModels === true;
      const was = state.connected;
      if (!m.params.ready || !was) {
        usageRevision++;
        usageRequest = null;
      }
      compactionTracking = Object.hasOwn(m.params, "compactions");
      const undoneFiles = { ...state.undoneFiles };
      for (const file of m.params.undoneFiles || [])
        undoneFiles[JSON.stringify([file.threadId, file.turnId, file.path])] =
          true;
      persist("cx-undone-files", undoneFiles);
      for (const request of state.questions)
        if (
          !m.params.questions.some(
            (next) => String(next.id) === String(request.id),
          )
        )
          recordInputRequest(request);
      set({
        undoneFiles,
        ...(!state.cwd && m.params.defaultCwd
          ? { cwd: m.params.defaultCwd }
          : {}),
        defaultCwd: m.params.defaultCwd,
        projectlessRoot: m.params.projectlessRoot || "",
        connected: m.params.ready,
        ...(!m.params.ready && { usageLoading: false }),
        serverVersion: m.params.version || null,
        active: m.params.activeTurns,
        compactions: { ...state.compactions, ...m.params.compactions },
        questions: m.params.questions,
        terminals: m.params.terminals || {},
      });
      const terminalId = localStorage.getItem("cx-terminal");
      if (m.params.terminals?.[terminalId]?.running === false)
        closeTerminal(terminalId);
      for (const fn of eventListeners) fn(m);
      if (m.params.ready)
        for (const [threadId, entry] of Object.entries(state.compactions))
          if (isCompacting(entry)) refreshCompaction(threadId).catch(() => {});
      if (m.params.ready && !was) boot();
      return;
    }
    if (m.id !== undefined && !m.method) {
      const p = pending.get(m.id);
      if (p) {
        clearTimeout(p.timer);
        pending.delete(m.id);
        if (m.error) {
          const error = new Error(m.error.message);
          error.code = m.error.code;
          const archived = /^(?:session|thread)\s+(\S+)\s+is archived\b/i.exec(
            error.message,
          );
          if (p.threadId && archived?.[1] === p.threadId) {
            error.archivedThreadId = p.threadId;
            if (
              p.opening === opening ||
              (state.threadAccess?.threadId || state.current?.id) !== p.threadId
            )
              syncArchivedThread(p.threadId);
          }
          p.reject(error);
        } else {
          if (p.method === "thread/turns/list" && m.result?.data)
            recordTurnTimings(p.threadId, m.result.data);
          p.resolve(m.result);
        }
      }
      return;
    }
    if (m.id !== undefined && m.method) {
      set({
        questions: [
          ...state.questions.filter((q) => String(q.id) !== String(m.id)),
          m,
        ],
      });
      return;
    }
    handle(m);
    for (const fn of eventListeners) fn(m);
  };
  connection.onclose = () => {
    if (socket !== connection) return;
    projectModelsRemote = false;
    bootRevision++;
    usageRevision++;
    usageRequest = null;
    set({
      connected: false,
      usageLoading: false,
      compactions: Object.fromEntries(
        Object.entries(state.compactions).map(([id, entry]) => [
          id,
          isCompacting(entry)
            ? {
                ...entry,
                status: "reconnecting",
                error: "连接中断，重连后将核对整理结果。",
              }
            : entry,
        ]),
      ),
    });
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("连接中断，正在重连；已提交的任务会在电脑上继续。"));
    }
    pending.clear();
    setTimeout(() => {
      if (socket === connection && !state.connected) connect();
    }, 1500);
  };
  connection.onerror = () => {};
}
async function boot() {
  const revision = ++bootRevision;
  const accountEpoch = accountRevision;
  const epoch = opening;
  const id = state.current?.id || localStorage.getItem("cx-current");
  const current = () => revision === bootRevision && state.connected;
  try {
    const [models, account, config] = await Promise.all([
      rpc("model/list"),
      rpc("account/read", { refreshToken: false }),
      rpc("config/read", { includeLayers: false }),
      projectModelsSupported
        ? syncProjectModels().catch(report)
        : Promise.resolve(),
    ]);
    if (!current()) return;
    const cfg = config.config || {};
    defaultModelSelection = {
      model: cfg.model || models.data.find((m) => m.isDefault)?.model || "",
      effort: cfg.model_reasoning_effort || "",
    };
    set({
      models: models.data,
      ...(accountEpoch === accountRevision && { account: account.account }),
      ...projectModelSelection(
        state.cwd,
        state.projectless,
        {
          model: state.model || defaultModelSelection.model,
          effort: state.effort || defaultModelSelection.effort,
        },
        models.data,
      ),
      serviceTier:
        state.serviceTier === undefined
          ? (cfg.service_tier ?? null)
          : state.serviceTier,
      booting: false,
    });
    await loadThreads(false);
    if (!current()) return;
    // 初始化只恢复启动时的选择，保留期间新建、发送和切换的对话。
    if (epoch === opening && !state.busy) {
      if (id && state.current?.id === id && !state.loading)
        await Promise.all([
          loadHistory(epoch),
          refreshThreadAccess({ background: true }),
        ]);
      else if (id) await openThread(id);
      else if (!state.current)
        set({ draft: localStorage.getItem("cx-draft-new") || "" });
    }
    if (!current()) return;
    if (!initialized) {
      initialized = true;
      loadSkills().catch(() => {});
    }
  } catch (e) {
    if (!current()) return;
    set({ booting: false });
    if (epoch === opening) report(e);
  }
}
export async function loadThreads(more = false) {
  const epoch = ++listing;
  const revision = nameRevision;
  const limit = Math.max(60, state.threads.length + (more ? 60 : 0));
  const [data, projectless] = await Promise.all([
    listThreads({
      archived: state.archived,
      ...(state.search ? { searchTerm: state.search } : {}),
    }),
    rpc("lan/projectless/read").catch(() => ({ directories: {} })),
  ]);
  if (epoch !== listing) return;
  pendingForks = pendingForks.filter((id) => !data.some((t) => t.id === id));
  persist("cx-pending-forks", pendingForks);
  const extra = await Promise.all(
    pendingForks.map((id) =>
      rpc("thread/read", { threadId: id, includeTurns: false })
        .then((r) => r.thread)
        .catch(() => null),
    ),
  );
  const visible = extra.filter(
    (t) =>
      t &&
      !deletedThreads.has(t.id) &&
      Boolean(t.path?.includes("/archived_sessions/")) === state.archived &&
      (!state.search || titleOf(t).includes(state.search)),
  );
  const threads = [...visible, ...data];
  if (
    state.current &&
    !state.archived &&
    !state.search &&
    !threads.some((t) => t.id === state.current.id)
  )
    threads.unshift(state.current);
  const hydrated = await threadOrdering.hydrate(
    [...new Map(threads.map((t) => [t.id, t])).values()].filter(
      (thread) => !deletedThreads.has(thread.id),
    ),
  );
  if (epoch !== listing) return;
  const sorted = hydrated.map((thread) => preserveThreadName(thread, revision));
  set({
    projectlessDirectories: projectless.directories,
    projectOrder: [
      ...projectGroups(
        sorted,
        state.projects,
        state.pins,
        projectless.directories,
        state.projectlessRoot,
      )
        .map(([path]) => path)
        .filter((path) => !state.projectOrder?.includes(path)),
      ...(state.projectOrder || []),
    ],
    threads: sorted.filter((t) => !deletedThreads.has(t.id)).slice(0, limit),
    threadCursor: sorted.length > limit ? String(limit) : null,
    current: state.current
      ? sorted.find((t) => t.id === state.current.id) || state.current
      : null,
  });
}
export function setDraft(draft) {
  set({ draft });
  localStorage.setItem("cx-draft-" + (state.current?.id || "new"), draft);
}
export function setProjectDirectory(cwd) {
  if (!state.loading) rememberModelSelection();
  set({
    cwd,
    projectless: false,
    projectlessCwd: null,
    ...projectModelSelection(cwd, false, defaultModelSelection),
  });
}
export function newChat(
  cwd = state.projectless ? "" : state.cwd,
  { reuseDirectory = false } = {},
) {
  const sameProject = (state.projectless ? "" : state.cwd) === (cwd || "");
  const selection =
    state.model && !state.loading
      ? {
          model: state.model,
          effort: compatibleEffort(
            state.effort,
            state.models.find((model) => model.model === state.model),
          ),
        }
      : null;
  if (!state.loading) rememberModelSelection();
  const projectlessCwd =
    reuseDirectory &&
    state.projectless &&
    (state.current || state.projectlessCwd)
      ? state.cwd
      : null;
  opening++;
  localStorage.removeItem("cx-current");
  set({
    current: null,
    items: [],
    cwd: cwd || projectlessCwd || state.defaultCwd,
    projectless: !cwd,
    projectlessCwd,
    ...(sameProject && selection
      ? selection
      : projectModelSelection(cwd, !cwd, defaultModelSelection)),
    draft: localStorage.getItem("cx-draft-new") || "",
    attachments: [],
    error: "",
    loading: false,
    threadAccess: null,
    sidebar: false,
    contextOpen: false,
    panelFile: null,
  });
}
export async function openThread(id, { preserveServiceTier = false } = {}) {
  if (state.current && !state.loading) rememberModelSelection();
  const epoch = ++opening;
  const revision = nameRevision;
  set({
    loading: true,
    error: "",
    threadAccess: { threadId: id, status: "loading" },
    sidebar: false,
    ...(state.current?.id !== id && {
      attachments: [],
      contextOpen: false,
      panelFile: null,
    }),
  });
  try {
    const r = await rpc("thread/read", { threadId: id, includeTurns: false });
    if (epoch !== opening || deletedThreads.has(id)) return;
    const [hydrated] = await threadOrdering.hydrate([r.thread]);
    if (epoch !== opening || deletedThreads.has(id)) return;
    const thread = preserveThreadName(hydrated, revision);
    const projectless = !threadGroupPath(
      thread,
      state.projects,
      state.projectlessDirectories,
      state.projectlessRoot,
    );
    set({
      threads: state.threads.some((t) => t.id === id)
        ? state.threads.map((t) =>
            t.id === id ? { ...t, name: thread.name } : t,
          )
        : sortThreads([thread, ...state.threads]),
      current: thread,
      cwd: r.cwd || r.thread.cwd,
      projectless,
      projectlessCwd: null,
      ...projectModelSelection(r.cwd || thread.cwd, projectless, {
        model: thread.model || defaultModelSelection.model,
        effort: thread.reasoningEffort || "",
      }),
      items: [],
      draft: localStorage.getItem("cx-draft-" + id) || "",
    });
    localStorage.setItem("cx-current", id);
    await loadHistory(epoch);
    if (epoch !== opening || deletedThreads.has(id)) return;
    set({ loading: false });
    await refreshThreadAccess({ preserveServiceTier });
  } catch (e) {
    if (epoch === opening)
      set({
        threadAccess: { threadId: id, status: "loadError", message: e.message },
      });
  } finally {
    if (epoch === opening) set({ loading: false });
  }
}
export async function refreshThreadAccess({
  preserveServiceTier = true,
  background = false,
} = {}) {
  if (
    state.loading ||
    (state.threadAccess?.status === "checking" && !background)
  )
    return false;
  if (state.threadAccess?.status === "loadError")
    return openThread(state.threadAccess.threadId, { preserveServiceTier });
  const id = state.current?.id;
  if (!id) return false;
  const epoch = opening;
  const connection = socket;
  const revision = bootRevision;
  const turnRevision = turnRevisions.get(id);
  const selectionRevision = modelSelectionRevision;
  const selection = {
    model: state.model,
    effort: state.effort,
    serviceTier: state.serviceTier,
  };
  const checking = {
    threadId: id,
    status: "checking",
    background:
      background &&
      (state.threadAccess?.status === "ready" ||
        state.threadAccess?.background === true),
  };
  const current = () =>
    epoch === opening &&
    connection === socket &&
    revision === bootRevision &&
    state.connected &&
    state.threadAccess === checking;
  set({ threadAccess: checking, error: "" });
  let resumed = false;
  try {
    const settings = await rpc("thread/resume", {
      threadId: id,
      excludeTurns: true,
    });
    if (!current()) return false;
    resumed = true;
    const modelSelection = projectModelSelection(state.cwd, state.projectless, {
      model: settings.model || state.model,
      effort: settings.reasoningEffort || "",
    });
    set({
      threadAccess: { threadId: id, status: "ready" },
      ...(selectionRevision === modelSelectionRevision &&
        state.model === selection.model &&
        state.effort === selection.effort &&
        modelSelection),
      ...(!preserveServiceTier &&
        state.serviceTier === selection.serviceTier && {
          serviceTier: settings.serviceTier ?? null,
        }),
    });
  } catch (error) {
    if (!current()) return false;
    set({
      threadAccess: {
        threadId: id,
        status:
          turnRevisions.get(id) !== turnRevision
            ? "ready"
            : /already has an active writer/i.test(error.message)
              ? "blocked"
              : "error",
        message: error.message,
      },
    });
  }
  const access = state.threadAccess;
  rpc("thread/turns/list", { threadId: id, limit: 20, itemsView: "summary" })
    .then((page) => {
      if (
        epoch !== opening ||
        connection !== socket ||
        revision !== bootRevision ||
        !state.connected ||
        state.threadAccess !== access
      )
        return;
      const active = { ...state.active };
      const running = page.data.find((t) => t.status === "inProgress");
      if (turnRevisions.get(id) === turnRevision) {
        if (resumed && running) active[id] = running.id;
        else delete active[id];
      }
      set({ turns: { ...state.turns, [id]: page.data }, active });
    })
    .catch(() => {});
  return access.status === "ready";
}
export async function loadHistory(epoch = opening) {
  if (!state.current) return;
  const id = state.current.id;
  const connection = socket;
  const revision = bootRevision;
  const previous = new Map(state.items.map((item) => [item.id, item]));
  const current = () =>
    epoch === opening &&
    state.current?.id === id &&
    connection === socket &&
    revision === bootRevision &&
    state.connected;
  const history = await readThreadHistory(rpc, id, { current });
  if (!current()) return;
  const map = new Map(history.map((item) => [item.id, item]));
  // 历史补齐断线期间的更新，读取期间收到的实时记录继续优先。
  for (const item of state.items)
    if (!map.has(item.id) || previous.get(item.id) !== item)
      map.set(item.id, item);
  set({ items: [...map.values()] });
}
function put(item) {
  const index = state.items.findIndex((i) => i.id === item.id);
  const items = state.items.slice();
  if (index >= 0 && item.type === "userMessage") {
    const content = [...(items[index].content || []), ...(item.content || [])];
    item = {
      ...item,
      content: [
        ...new Map(content.map((c) => [JSON.stringify(c), c])).values(),
      ],
    };
  }
  if (index < 0) items.push(item);
  else items[index] = { ...items[index], ...item };
  set({ items });
}
function recordInputRequest(request, answers) {
  if (
    request.method !== "item/tool/requestUserInput" ||
    request.params.threadId !== state.current?.id
  )
    return;
  const item = inputRequestItem(request, answers);
  const previous = state.items.find((entry) => entry.id === item.id);
  put({ ...item, answers: answers || previous?.answers });
}
function closeTerminal(processId) {
  if (localStorage.getItem("cx-terminal") !== processId) return;
  localStorage.removeItem("cx-terminal");
  set({ terminalOpen: false });
}
function recordTurnTimings(threadId, turns) {
  if (deletedThreads.has(threadId)) return;
  const timings = { ...state.turnTimings[threadId] };
  for (const turn of turns) {
    const previous = timings[turn.id];
    timings[turn.id] = {
      status: turn.status ?? previous?.status,
      startedAt: turn.startedAt ?? previous?.startedAt ?? null,
      completedAt: turn.completedAt ?? previous?.completedAt ?? null,
      durationMs: turn.durationMs ?? previous?.durationMs ?? null,
    };
  }
  set({ turnTimings: { ...state.turnTimings, [threadId]: timings } });
}
function recordThreadActivity(threadId, turn) {
  if (deletedThreads.has(threadId)) return;
  threadOrdering.observe(threadId, turn);
  const update = (thread) =>
    thread?.id === threadId ? threadOrdering.apply(thread) : thread;
  set({
    threads: sortThreads(state.threads.map(update)),
    current: update(state.current),
  });
}
function handle({ method, params: p = {} }) {
  if (method === "account/rateLimits/updated" && p.rateLimits) {
    usageRevision++;
    set({ usage: mergeUsageUpdate(state.usage, p.rateLimits), usageError: "" });
    return;
  }
  if (method === "account/updated") {
    const revision = ++accountRevision;
    usageRevision++;
    usageRequest = null;
    const connection = socket;
    set({ account: null, usage: null, usageLoading: false, usageError: "" });
    rpc("account/read", { refreshToken: false })
      .then((result) => {
        if (
          socket !== connection ||
          !state.connected ||
          revision !== accountRevision
        )
          return;
        set({ account: result.account });
        return refreshUsage();
      })
      .catch(() => {});
    return;
  }
  if (method === "lan/compaction") {
    if (!deletedThreads.has(p.threadId))
      set({
        compactions: { ...state.compactions, [p.threadId]: p.compaction },
      });
    return;
  }
  if (method === "turn/started" || method === "turn/completed")
    turnRevisions.set(p.threadId, (turnRevisions.get(p.threadId) || 0) + 1);
  if (method === "thread/deleted") {
    forgetThread(p.threadId);
    return;
  }
  if (method === "thread/archived") {
    syncArchivedThread(p.threadId);
    return;
  }
  if (method === "thread/unarchived") {
    loadThreads().catch(() => {});
    return;
  }
  if (method === "lan/terminalStarted")
    set({
      terminals: {
        ...state.terminals,
        [p.processId]: { buffer: "", running: true },
      },
    });
  if (method === "command/exec/outputDelta" && state.terminals[p.processId]) {
    const t = state.terminals[p.processId];
    set({
      terminals: {
        ...state.terminals,
        [p.processId]: {
          ...t,
          buffer: (t.buffer + b64decode(p.deltaBase64)).slice(-200000),
        },
      },
    });
  }
  if (method === "lan/terminalExit") {
    set({
      terminals: {
        ...state.terminals,
        [p.processId]: { ...state.terminals[p.processId], running: false },
      },
    });
    closeTerminal(p.processId);
  }
  if (
    method === "lan/questionResolved" ||
    method === "serverRequest/resolved"
  ) {
    const id = method === "serverRequest/resolved" ? p.requestId : p.id;
    const request = state.questions.find((q) => String(q.id) === String(id));
    if (request) recordInputRequest(request);
    set({
      questions: state.questions.filter((q) => String(q.id) !== String(id)),
    });
    return;
  }
  if (method === "turn/started") {
    const entry = state.compactions[p.threadId];
    if (entry?.status === "starting" && !entry.turnId)
      set({
        compactions: {
          ...state.compactions,
          [p.threadId]: { ...entry, status: "running", turnId: p.turn.id },
        },
      });
    const turn = {
      ...p.turn,
      startedAt:
        p.turn.startedAt ??
        state.turnTimings[p.threadId]?.[p.turn.id]?.startedAt ??
        Date.now() / 1000,
    };
    recordTurnTimings(p.threadId, [turn]);
    recordThreadActivity(p.threadId, turn);
    set({ active: { ...state.active, [p.threadId]: p.turn.id } });
  }
  if (method === "turn/completed") {
    const observedTurn = state.active[p.threadId] === p.turn.id;
    refreshUsage();
    const entry = state.compactions[p.threadId];
    if (isCompacting(entry) && entry.turnId === p.turn.id)
      set({
        compactions: {
          ...state.compactions,
          [p.threadId]: {
            ...entry,
            status:
              p.turn.status === "completed"
                ? "completed"
                : p.turn.status === "interrupted"
                  ? "interrupted"
                  : "failed",
            completedAt: p.turn.completedAt ?? Date.now() / 1000,
            error: p.turn.error?.message,
          },
        },
      });
    recordTurnTimings(p.threadId, [
      { ...p.turn, completedAt: p.turn.completedAt ?? Date.now() / 1000 },
    ]);
    recordThreadActivity(p.threadId, p.turn);
    const active = { ...state.active };
    if (active[p.threadId] === p.turn.id) delete active[p.threadId];
    const unreadCompletions = { ...state.unreadCompletions };
    if (
      observedTurn &&
      p.turn.status === "completed" &&
      !(
        readingThreadId === p.threadId &&
        state.current?.id === p.threadId &&
        !state.loading
      )
    )
      unreadCompletions[p.threadId] = p.turn.id;
    set({
      active,
      unreadCompletions,
    });
    if (state.current?.id === p.threadId) {
      if (p.turn.error) report(p.turn.error);
      if (p.turn.status === "interrupted") notice("任务已停止");
      set({
        turns: {
          ...state.turns,
          [p.threadId]: [
            p.turn,
            ...(state.turns[p.threadId] || []).filter(
              (t) => t.id !== p.turn.id,
            ),
          ],
        },
      });
    }
    loadThreads().catch(() => {});
  }
  if (method === "thread/name/updated") {
    updateThreadName(p.threadId, p.threadName ?? p.name ?? null);
  }
  if (method === "thread/tokenUsage/updated")
    set({ tokenUsage: { ...state.tokenUsage, [p.threadId]: p.tokenUsage } });
  if (method === "turn/diff/updated")
    set({
      diffs: { ...state.diffs, [p.threadId]: p.diff },
      turnDiffs: {
        ...state.turnDiffs,
        [p.threadId]: { ...state.turnDiffs[p.threadId], [p.turnId]: p.diff },
      },
    });
  if (method === "lan/files/undone") {
    const undoneFiles = {
      ...state.undoneFiles,
      [JSON.stringify([p.threadId, p.turnId, p.path])]: true,
    };
    persist("cx-undone-files", undoneFiles);
    set({ undoneFiles });
  }
  if (method === "turn/plan/updated")
    set({ plans: { ...state.plans, [p.threadId]: p } });
  if (p.threadId !== state.current?.id) return;
  if (method === "thread/settings/updated")
    set({ serviceTier: p.threadSettings.serviceTier ?? null });
  if (method === "error") report(p.error || p.message || "任务失败");
  if (method === "item/started" || method === "item/completed") {
    if (p.item.type === "contextCompaction") {
      p.item = {
        ...p.item,
        status: method === "item/started" ? "inProgress" : "completed",
      };
      const entry = state.compactions[p.threadId];
      if (isCompacting(entry) && !entry.turnId)
        set({
          compactions: {
            ...state.compactions,
            [p.threadId]: { ...entry, turnId: p.turnId, status: "running" },
          },
        });
    }
    let questionId;
    if (p.item.type === "userMessage") {
      const text = (p.item.content || [])
        .filter((content) => content.type === "text")
        .map((content) => content.text)
        .join("\n");
      questionId = state.items.find(
        (item) =>
          item.optimistic &&
          item.questionId &&
          item.content
            .filter((content) => content.type === "text")
            .map((content) => content.text)
            .join("\n") === text,
      )?.questionId;
      set({ items: state.items.filter((i) => !i.optimistic) });
    }
    put({ ...p.item, turnId: p.turnId, ...(questionId ? { questionId } : {}) });
  }
  if (method === "item/agentMessage/delta") {
    const i = state.items.find((i) => i.id === p.itemId) || {
      id: p.itemId,
      type: "agentMessage",
      text: "",
      turnId: p.turnId,
    };
    put({ ...i, text: i.text + p.delta });
  }
  if (method === "item/commandExecution/outputDelta") {
    const i = state.items.find((i) => i.id === p.itemId);
    if (i)
      put({ ...i, aggregatedOutput: (i.aggregatedOutput || "") + p.delta });
  }
  if (method === "item/reasoning/summaryTextDelta") {
    const i = state.items.find((i) => i.id === p.itemId) || {
      id: p.itemId,
      type: "reasoning",
      summary: [],
    };
    const summary = [...(i.summary || [])];
    summary[p.summaryIndex] = (summary[p.summaryIndex] || "") + p.delta;
    put({ ...i, summary });
  }
}
export async function ensureThread() {
  if (state.current) return state.current;
  const epoch = opening;
  const { projectless, model, serviceTier } = state;
  let cwd = state.cwd;
  if (projectless) {
    if (!state.projectlessCwd) {
      const workspace = await rpc("lan/projectless/prepare");
      if (epoch !== opening)
        throw new Error("对话已切换，请在当前对话重新发送消息。");
      set({
        cwd: workspace.cwd,
        projectlessCwd: workspace.cwd,
        projectlessRoot: workspace.root,
      });
    }
    cwd = state.projectlessCwd;
  }
  const r = await rpc("thread/start", {
    cwd,
    model: model || undefined,
    serviceTier: resolveServiceTier(
      serviceTier,
      state.models.find((m) => m.model === model),
    ),
    ...(projectless ? { threadSource: PROJECTLESS_SOURCE } : {}),
  });
  if (epoch !== opening)
    throw new Error("对话已切换，请在当前对话重新发送消息。");
  localStorage.setItem("cx-draft-" + r.thread.id, state.draft);
  localStorage.removeItem("cx-draft-new");
  set({ current: r.thread });
  localStorage.setItem("cx-current", r.thread.id);
  return r.thread;
}
export async function sendMessage(
  text = state.draft,
  attachments = state.attachments,
  { clearDraft = true, questionId, questionAnswers, annotations = [] } = {},
) {
  if (
    (!text.trim() && !attachments.length && !annotations.length) ||
    state.busy ||
    state.loading ||
    isCompacting(state.compactions[state.current?.id]) ||
    (state.threadAccess &&
      state.threadAccess.threadId === state.current?.id &&
      state.threadAccess.status !== "ready")
  )
    return false;
  const epoch = opening;
  set({ busy: true, error: "" });
  let thread;
  try {
    thread = await ensureThread();
    const input = [
      ...(text.trim() || annotations.length
        ? [
            {
              type: "text",
              text: annotations.length
                ? annotationMessage(annotations, text)
                : text,
              text_elements: [],
            },
          ]
        : []),
      ...attachments.map((a) => a.input),
    ];
    const running = state.active[thread.id];
    put({
      id: "optimistic-" + uid(),
      type: "userMessage",
      turnId: running,
      content: input,
      optimistic: true,
      ...(questionId ? { questionId } : {}),
    });
    const params = {
      threadId: thread.id,
      input,
      model: state.model || undefined,
      effort: state.effort || undefined,
      serviceTier: resolveServiceTier(
        state.serviceTier,
        state.models.find((m) => m.model === state.model),
      ),
      collaborationMode: {
        mode: state.mode,
        settings: {
          model: state.model,
          reasoning_effort: state.effort || null,
        },
      },
    };
    if (!running) rememberModelSelection();
    const startedAt = Date.now() / 1000;
    if (state.compactions[thread.id]?.status === "completed") {
      const compactions = { ...state.compactions };
      delete compactions[thread.id];
      set({ compactions });
    }
    const r = await rpc(
      running ? "turn/steer" : "turn/start",
      running
        ? { threadId: thread.id, expectedTurnId: running, input }
        : params,
    );
    if (r.turn) {
      const turn = {
        ...r.turn,
        startedAt:
          r.turn.startedAt ??
          state.turnTimings[thread.id]?.[r.turn.id]?.startedAt ??
          startedAt,
      };
      recordTurnTimings(thread.id, [turn]);
      recordThreadActivity(thread.id, turn);
    }
    if (clearDraft) {
      const draftKey = "cx-draft-" + thread.id;
      if (localStorage.getItem(draftKey) === text)
        localStorage.removeItem(draftKey);
      if (state.current?.id === thread.id)
        set({
          ...(state.draft === text ? { draft: "" } : {}),
          attachments: state.attachments.filter(
            (entry) => !attachments.includes(entry),
          ),
        });
    }
    if (annotations.length) {
      removeSentAnnotations(thread.id, annotations);
      if (
        state.annotationEditor?.threadId === thread.id &&
        !readAnnotationDrafts(thread.id).some(
          (entry) => entry.id === state.annotationEditor.id,
        )
      )
        set({ annotationEditor: null });
    }
    if (questionId && state.current?.id === thread.id) {
      const question = state.items.find((item) => item.id === questionId);
      if (question) put({ ...question, questionAnswers });
    }
    if (r.turn?.status === "inProgress")
      set({ active: { ...state.active, [thread.id]: r.turn.id } });
    if (state.current?.id === thread.id)
      set({ threadAccess: { threadId: thread.id, status: "ready" } });
    loadThreads().catch(() => {});
    return true;
  } catch (e) {
    if (state.current?.id === thread?.id)
      set({ items: state.items.filter((i) => !i.optimistic) });
    if (/already has an active writer/i.test(e.message)) {
      if (state.current?.id === thread?.id)
        set({
          threadAccess: { threadId: thread.id, status: "blocked" },
          error: "",
        });
    } else if (epoch === opening) report(e);
    return false;
  } finally {
    set({ busy: false });
  }
}
export async function stop() {
  const id = state.current?.id;
  if (id && state.active[id])
    await rpc("turn/interrupt", { threadId: id, turnId: state.active[id] });
}
export async function rename(thread, name) {
  await rpc("thread/name/set", { threadId: thread.id, name });
  updateThreadName(thread.id, name);
  await loadThreads();
}
export async function archive(thread) {
  const restoring = state.archived;
  await rpc(restoring ? "thread/unarchive" : "thread/archive", {
    threadId: thread.id,
  });
  if (state.current?.id === thread.id) newChat();
  if (restoring) {
    pendingForks = [...new Set([...pendingForks, thread.id])];
    persist("cx-pending-forks", pendingForks);
    set({ archived: false });
    await openThread(thread.id);
  }
  await loadThreads();
}
function syncArchivedThread(id) {
  pendingForks = pendingForks.filter((value) => value !== id);
  persist("cx-pending-forks", pendingForks);
  if ((state.threadAccess?.threadId || state.current?.id) === id) newChat();
  else if (state.current?.id === id) set({ current: null, items: [] });
  if (localStorage.getItem("cx-current") === id)
    localStorage.removeItem("cx-current");
  const active = { ...state.active };
  delete active[id];
  const unreadCompletions = { ...state.unreadCompletions };
  delete unreadCompletions[id];
  const compactions = { ...state.compactions };
  delete compactions[id];
  set({
    active,
    unreadCompletions,
    compactions,
    threads: state.archived
      ? state.threads
      : state.threads.filter((thread) => thread.id !== id),
    questions: state.questions.filter(
      (question) => question.params?.threadId !== id,
    ),
    modal: state.modal?.thread?.id === id ? null : state.modal,
  });
  loadThreads().catch(() => {});
}
function forgetThread(id) {
  threadOrdering.forget(id);
  threadNames.delete(id);
  deletedThreads.add(id);
  pendingForks = pendingForks.filter((value) => value !== id);
  persist("cx-pending-forks", pendingForks);
  const pins = state.pins.filter((value) => value !== id);
  persist("cx-pins", pins);
  localStorage.removeItem("cx-draft-" + id);
  const undoneFiles = Object.fromEntries(
    Object.entries(state.undoneFiles).filter(
      ([key]) => JSON.parse(key)[0] !== id,
    ),
  );
  persist("cx-undone-files", undoneFiles);
  if (localStorage.getItem("cx-current") === id)
    localStorage.removeItem("cx-current");
  if (state.current?.id === id) newChat();
  const patch = {};
  for (const key of [
    "active",
    "unreadCompletions",
    "compactions",
    "turns",
    "turnTimings",
    "diffs",
    "turnDiffs",
    "plans",
    "tokenUsage",
  ]) {
    patch[key] = { ...state[key] };
    delete patch[key][id];
  }
  set({
    ...patch,
    undoneFiles,
    pins,
    threads: state.threads.filter((thread) => thread.id !== id),
    questions: state.questions.filter(
      (question) => question.params?.threadId !== id,
    ),
    modal: state.modal?.thread?.id === id ? null : state.modal,
  });
}
export async function deleteThread(thread) {
  await rpc("thread/delete", { threadId: thread.id });
  forgetThread(thread.id);
  notice("对话已删除");
  await loadThreads().catch(report);
}
export async function fork(thread = state.current, lastTurnId) {
  const revision = nameRevision;
  const records = [];
  for (const archived of [false, true]) {
    let cursor;
    do {
      const page = await rpc("thread/list", {
        archived,
        limit: 100,
        ...(cursor ? { cursor } : {}),
      });
      records.push(...page.data);
      cursor = page.nextCursor;
    } while (cursor);
  }
  const threads = records.map((record) => preserveThreadName(record, revision));
  const source = threads.find((record) => record.id === thread.id) || thread;
  const name = nextForkTitle(source, threads);
  const r = await rpc("thread/fork", {
    threadId: thread.id,
    excludeTurns: true,
    ...(lastTurnId ? { lastTurnId } : {}),
    ...(thread.threadSource === PROJECTLESS_SOURCE
      ? { threadSource: PROJECTLESS_SOURCE }
      : {}),
  });
  pendingForks = [...new Set([...pendingForks, r.thread.id])];
  persist("cx-pending-forks", pendingForks);
  await rpc("thread/name/set", {
    threadId: r.thread.id,
    name,
  });
  updateThreadName(r.thread.id, name);
  await openThread(r.thread.id);
  await loadThreads();
  notice("已创建对话分支");
}
export async function compact() {
  if (state.busy || state.loading || state.active[state.current?.id])
    throw new Error("请等待当前任务结束后整理上下文。");
  if (isCompacting(state.compactions[state.current?.id]))
    throw new Error("正在整理上下文，完成后可继续发送。");
  if (state.threadAccess && state.threadAccess.status !== "ready")
    throw new Error("请先恢复对话连接，再整理上下文。");
  const t = state.current || (await ensureThread());
  if (isCompacting(state.compactions[t.id]))
    throw new Error("正在整理上下文，完成后可继续发送。");
  const entry = { id: uid(), status: "starting", startedAt: Date.now() / 1000 };
  set({ compactions: { ...state.compactions, [t.id]: entry }, error: "" });
  try {
    await rpc("thread/compact/start", { threadId: t.id });
  } catch (error) {
    const latest = state.compactions[t.id];
    if (latest?.id === entry.id && isCompacting(latest))
      set({
        compactions: {
          ...state.compactions,
          [t.id]: {
            ...latest,
            status: /超时|连接中断/.test(error.message)
              ? "reconnecting"
              : "failed",
            error: error.message,
            ...(!/超时|连接中断/.test(error.message) && {
              completedAt: Date.now() / 1000,
            }),
          },
        },
      });
    if (state.current?.id !== t.id) return false;
    throw error;
  }
}
export function refreshCompaction(threadId = state.current?.id) {
  const entry = state.compactions[threadId];
  if (!state.connected || !isCompacting(entry)) return Promise.resolve(entry);
  if (
    [...pending.values()].some(
      (request) =>
        request.threadId === threadId &&
        request.method === "thread/compact/start",
    )
  )
    return Promise.resolve(entry);
  const existing = checkingCompactions.get(threadId);
  if (existing?.entry === entry && existing.connection === socket)
    return existing.promise;
  const connection = socket;
  const revision = turnRevisions.get(threadId);
  const current = () =>
    socket === connection &&
    state.compactions[threadId] === entry &&
    turnRevisions.get(threadId) === revision;
  const checking = (async () => {
    let recovered;
    let activeFromHistory;
    let readHistory = false;
    if (compactionTracking) {
      try {
        const result = await rpc("lan/compaction/check", { threadId });
        recovered = result.compaction;
      } catch (error) {
        if (error.code !== -32601) throw error;
      }
    }
    if (!recovered && current()) {
      const { thread } = await rpc("thread/read", {
        threadId,
        includeTurns: false,
      });
      const turns = [];
      let cursor;
      do {
        const page = await rpc("thread/turns/list", {
          threadId,
          limit: 100,
          itemsView: "full",
          ...(cursor ? { cursor } : {}),
        });
        if (!current()) return state.compactions[threadId];
        turns.push(...page.data);
        cursor = page.nextCursor;
      } while (cursor);
      recovered = recoverCompaction(entry, thread, turns);
      activeFromHistory = turns.find(
        (turn) => turn.status === "inProgress",
      )?.id;
      readHistory = true;
    }
    if (current() && recovered) {
      const active = { ...state.active };
      if (readHistory && activeFromHistory)
        active[threadId] = activeFromHistory;
      else if (
        readHistory ||
        (!isCompacting(recovered) &&
          recovered.status !== "unconfirmed" &&
          active[threadId] === recovered.turnId)
      )
        delete active[threadId];
      set({
        compactions: { ...state.compactions, [threadId]: recovered },
        active,
      });
    }
    return state.compactions[threadId];
  })().finally(() => {
    if (checkingCompactions.get(threadId)?.promise === checking)
      checkingCompactions.delete(threadId);
  });
  checkingCompactions.set(threadId, { entry, connection, promise: checking });
  return checking;
}
export async function review() {
  if (isCompacting(state.compactions[state.current?.id]))
    throw new Error("正在整理上下文，完成后可继续审查。");
  const t = await ensureThread();
  await rpc("review/start", {
    threadId: t.id,
    target: { type: "uncommittedChanges" },
  });
}
export async function loadSkills() {
  const r = await rpc("skills/list", { cwds: [state.cwd] });
  set({ skills: r.data.flatMap((e) => e.skills || []) });
}
export function pin(id) {
  const pins = state.pins.includes(id)
    ? state.pins.filter((x) => x !== id)
    : [...state.pins, id];
  set({ pins });
  persist("cx-pins", pins);
}
export function addProject(path) {
  if (!state.projects.includes(path)) {
    const projects = [...state.projects, path];
    set({
      projects,
      ...(state.projectOrder && {
        projectOrder: [
          path,
          ...state.projectOrder.filter((value) => value !== path),
        ],
      }),
    });
    persist("cx-projects", projects);
  }
  newChat(path);
}
export function addAttachment(a) {
  set({ attachments: [...state.attachments, a] });
}
export function editUserMessage(item) {
  const parsed = parseUserMessage(item.content);
  const threadId = state.current?.id;
  const annotations = readAnnotationDrafts(threadId);
  for (const [index, entry] of parsed.annotations.entries()) {
    const id = `message-${item.id}-${index}`;
    if (!annotations.some((draft) => draft.id === id))
      annotations.push({ ...entry, id });
  }
  writeAnnotationDrafts(threadId, annotations);
  const attachments = [
    ...parsed.references.map((file) => ({
      name: file.name,
      input: fileReferenceInput(file),
    })),
    ...parsed.attachments.map((input) => ({
      name: input.name || basename(input.path || "") || "图片附件",
      ...(input.type === "image" && { preview: input.url }),
      input,
    })),
  ];
  setDraft(parsed.text);
  set({
    attachments: [
      ...state.attachments,
      ...attachments
        .filter(
          (entry) =>
            !state.attachments.some(
              (current) =>
                JSON.stringify(current.input) === JSON.stringify(entry.input),
            ),
        )
        .map((entry) => ({ ...entry, id: uid() })),
    ],
  });
}
export async function attachFile(file) {
  if (file.type.startsWith("image/")) {
    const url = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    addAttachment({
      id: uid(),
      name: file.name,
      preview: url,
      input: { type: "image", url },
    });
  } else {
    const text = await file.text();
    addAttachment({
      id: uid(),
      name: file.name,
      input: {
        type: "text",
        text: `附件 ${file.name}\n\n${text}`,
        text_elements: [],
      },
    });
  }
}
export function setTheme(theme) {
  set({ theme });
  persist("cx-theme", theme);
}
export async function copy(text) {
  try {
    if (navigator.clipboard?.writeText)
      await navigator.clipboard.writeText(text);
    else {
      const input = document.createElement("textarea");
      input.value = text;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.append(input);
      input.select();
      const ok = document.execCommand("copy");
      input.remove();
      if (!ok) throw new Error("浏览器未允许复制，请长按文本选择复制。");
    }
    notice("已复制");
  } catch (e) {
    report(e);
  }
}
connect();
