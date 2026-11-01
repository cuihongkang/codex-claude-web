import { compatibleEffort } from "../domain/model-preferences.js";
import { resolveServiceTier } from "../domain/service-tier.js";
import {
  sortThreads,
  threadGroupPath,
  PROJECTLESS_SOURCE,
} from "../domain/thread-order.js";
import { readThreadHistory } from "../domain/thread-history.js";
export function createThreadNavigation({
  get,
  set,
  rpc,
  transport,
  models,
  records,
  getConnectionRevision,
}) {
  let opening = 0;
  function setProjectDirectory(cwd) {
    if (!get().loading) models.rememberModelSelection();
    set({
      cwd,
      projectless: false,
      projectlessCwd: null,
      ...models.projectModelSelection(cwd, false, models.defaults),
    });
  }
  function newChat(
    cwd = get().projectless ? "" : get().cwd,
    { reuseDirectory = false } = {},
  ) {
    const sameProject = (get().projectless ? "" : get().cwd) === (cwd || "");
    const selection =
      get().model && !get().loading
        ? {
            model: get().model,
            effort: compatibleEffort(
              get().effort,
              get().models.find((model) => model.model === get().model),
            ),
          }
        : null;
    if (!get().loading) models.rememberModelSelection();
    const projectlessCwd =
      reuseDirectory &&
      get().projectless &&
      (get().current || get().projectlessCwd)
        ? get().cwd
        : null;
    opening++;
    localStorage.removeItem("cx-current");
    set({
      current: null,
      items: [],
      cwd: cwd || projectlessCwd || get().defaultCwd,
      projectless: !cwd,
      projectlessCwd,
      ...(sameProject && selection
        ? selection
        : models.projectModelSelection(cwd, !cwd, models.defaults)),
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
  async function openThread(id, { preserveServiceTier = false } = {}) {
    if (get().current && !get().loading) models.rememberModelSelection();
    const epoch = ++opening;
    const revision = records.nameRevision;
    set({
      loading: true,
      error: "",
      threadAccess: { threadId: id, status: "loading" },
      sidebar: false,
      ...(get().current?.id !== id && {
        attachments: [],
        contextOpen: false,
        panelFile: null,
      }),
    });
    try {
      const r = await rpc("thread/read", { threadId: id, includeTurns: false });
      if (epoch !== opening || records.deletedThreads.has(id)) return;
      const [hydrated] = await records.threadOrdering.hydrate([r.thread]);
      if (epoch !== opening || records.deletedThreads.has(id)) return;
      const thread = records.preserveThreadName(hydrated, revision);
      const projectless = !threadGroupPath(
        thread,
        get().projects,
        get().projectlessDirectories,
        get().projectlessRoot,
      );
      set({
        threads: get().threads.some((t) => t.id === id)
          ? get().threads.map((t) =>
              t.id === id ? { ...t, name: thread.name } : t,
            )
          : sortThreads([thread, ...get().threads]),
        current: thread,
        cwd: r.cwd || r.thread.cwd,
        projectless,
        projectlessCwd: null,
        ...models.projectModelSelection(r.cwd || thread.cwd, projectless, {
          model: thread.model || models.defaults.model,
          effort: thread.reasoningEffort || "",
        }),
        items: [],
        draft: localStorage.getItem("cx-draft-" + id) || "",
      });
      localStorage.setItem("cx-current", id);
      await loadHistory(epoch);
      if (epoch !== opening || records.deletedThreads.has(id)) return;
      set({ loading: false });
      await refreshThreadAccess({ preserveServiceTier });
    } catch (e) {
      if (epoch === opening)
        set({
          threadAccess: {
            threadId: id,
            status: "loadError",
            message: e.message,
          },
        });
    } finally {
      if (epoch === opening) set({ loading: false });
    }
  }
  async function refreshThreadAccess({
    preserveServiceTier = true,
    background = false,
  } = {}) {
    if (
      get().loading ||
      (get().threadAccess?.status === "checking" && !background)
    )
      return false;
    if (get().threadAccess?.status === "loadError")
      return openThread(get().threadAccess.threadId, { preserveServiceTier });
    const id = get().current?.id;
    if (!id) return false;
    const epoch = opening;
    const connection = transport.connection;
    const revision = getConnectionRevision();
    const turnRevision = records.turnRevisions.get(id);
    const selectionRevision = models.revision;
    const selection = {
      model: get().model,
      effort: get().effort,
      serviceTier: get().serviceTier,
    };
    const checking = {
      threadId: id,
      status: "checking",
      background:
        background &&
        (get().threadAccess?.status === "ready" ||
          get().threadAccess?.background === true),
    };
    const current = () =>
      epoch === opening &&
      connection === transport.connection &&
      revision === getConnectionRevision() &&
      get().connected &&
      get().threadAccess === checking;
    set({ threadAccess: checking, error: "" });
    let resumed = false;
    try {
      const settings = await rpc("thread/resume", {
        threadId: id,
        excludeTurns: true,
      });
      if (!current()) return false;
      resumed = true;
      const modelSelection = models.projectModelSelection(
        get().cwd,
        get().projectless,
        {
          model: settings.model || get().model,
          effort: settings.reasoningEffort || "",
        },
      );
      set({
        threadAccess: { threadId: id, status: "ready" },
        ...(selectionRevision === models.revision &&
          get().model === selection.model &&
          get().effort === selection.effort &&
          modelSelection),
        ...(!preserveServiceTier &&
          get().serviceTier === selection.serviceTier && {
            serviceTier: settings.serviceTier ?? null,
          }),
      });
    } catch (error) {
      if (!current()) return false;
      set({
        threadAccess: {
          threadId: id,
          status:
            records.turnRevisions.get(id) !== turnRevision
              ? "ready"
              : /already has an active writer/i.test(error.message)
                ? "blocked"
                : "error",
          message: error.message,
        },
      });
    }
    const access = get().threadAccess;
    rpc("thread/turns/list", { threadId: id, limit: 20, itemsView: "summary" })
      .then((page) => {
        if (
          epoch !== opening ||
          connection !== transport.connection ||
          revision !== getConnectionRevision() ||
          !get().connected ||
          get().threadAccess !== access
        )
          return;
        const active = { ...get().active };
        const running = page.data.find((t) => t.status === "inProgress");
        if (records.turnRevisions.get(id) === turnRevision) {
          if (resumed && running) active[id] = running.id;
          else delete active[id];
        }
        set({ turns: { ...get().turns, [id]: page.data }, active });
      })
      .catch(() => {});
    return access.status === "ready";
  }
  async function loadHistory(epoch = opening) {
    if (!get().current) return;
    const id = get().current.id;
    const connection = transport.connection;
    const revision = getConnectionRevision();
    const previous = new Map(get().items.map((item) => [item.id, item]));
    const current = () =>
      epoch === opening &&
      get().current?.id === id &&
      connection === transport.connection &&
      revision === getConnectionRevision() &&
      get().connected;
    const history = await readThreadHistory(rpc, id, { current });
    if (!current()) return;
    const map = new Map(history.map((item) => [item.id, item]));
    // 历史补齐断线期间的更新，读取期间收到的实时记录继续优先。
    for (const item of get().items)
      if (!map.has(item.id) || previous.get(item.id) !== item)
        map.set(item.id, item);
    set({ items: [...map.values()] });
  }
  async function ensureThread() {
    if (get().current) return get().current;
    const epoch = opening;
    const { projectless, model, serviceTier } = get();
    let cwd = get().cwd;
    if (projectless) {
      if (!get().projectlessCwd) {
        const workspace = await rpc("lan/projectless/prepare");
        if (epoch !== opening)
          throw new Error("对话已切换，请在当前对话重新发送消息。");
        set({
          cwd: workspace.cwd,
          projectlessCwd: workspace.cwd,
          projectlessRoot: workspace.root,
        });
      }
      cwd = get().projectlessCwd;
    }
    const r = await rpc("thread/start", {
      cwd,
      model: model || undefined,
      serviceTier: resolveServiceTier(
        serviceTier,
        get().models.find((m) => m.model === model),
      ),
      ...(projectless ? { threadSource: PROJECTLESS_SOURCE } : {}),
    });
    if (epoch !== opening)
      throw new Error("对话已切换，请在当前对话重新发送消息。");
    localStorage.setItem("cx-draft-" + r.thread.id, get().draft);
    localStorage.removeItem("cx-draft-new");
    set({ current: r.thread });
    localStorage.setItem("cx-current", r.thread.id);
    return r.thread;
  }
  return {
    setProjectDirectory,
    newChat,
    openThread,
    refreshThreadAccess,
    loadHistory,
    ensureThread,
    get opening() {
      return opening;
    },
  };
}
