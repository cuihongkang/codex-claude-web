import { resourceTarget } from "../../../shared/backend-identity.mjs";
import {
  projectGroups,
  PROJECTLESS_SOURCE,
  preserveFailedBackendThreads,
} from "../domain/thread-order.js";
import { nextForkTitle } from "../domain/fork-title.js";
import { saved, persist } from "../infrastructure/storage.js";
import { titleOf } from "../domain/format.js";
export function createThreadCatalog({
  get,
  set,
  rpc,
  records,
  navigation,
  report,
  notice,
}) {
  let listing = 0;
  let listedScope;
  let pendingForks = saved("cx-pending-forks", []);
  const listThreads = (params, options) =>
    records.threadOrdering.list(params, options);
  async function loadThreads() {
    const epoch = ++listing;
    const revision = records.nameRevision;
    const params = {
      archived: get().archived,
      ...(get().search ? { searchTerm: get().search } : {}),
    };
    let errors = [];
    const [loaded, projectless] = await Promise.all([
      listThreads(params, {
        onBackendErrors: (value) => {
          errors = value;
        },
      }),
      rpc("lan/projectless/read").catch(() => ({ directories: {} })),
    ]);
    if (epoch !== listing) return;
    const data = preserveFailedBackendThreads(
      loaded,
      get().threads,
      errors,
      params,
      listedScope,
    );
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
        !records.deletedThreads.has(t.id) &&
        Boolean(t.path?.includes("/archived_sessions/")) === get().archived &&
        (!get().search || titleOf(t).includes(get().search)),
    );
    const threads = [...visible, ...data];
    if (
      get().current &&
      !get().archived &&
      !get().search &&
      !threads.some((t) => t.id === get().current.id)
    )
      threads.unshift(get().current);
    const failed = new Set(errors.map((error) => error.backendId));
    const unique = [
      ...new Map(threads.map((thread) => [thread.id, thread])).values(),
    ].filter((thread) => !records.deletedThreads.has(thread.id));
    const hydrated = [
      ...(await records.threadOrdering.hydrate(
        unique.filter(
          (thread) => !failed.has(resourceTarget(thread.id).backendId),
        ),
      )),
      ...unique.filter((thread) =>
        failed.has(resourceTarget(thread.id).backendId),
      ),
    ];
    if (epoch !== listing) return;
    const sorted = hydrated.map((thread) =>
      records.preserveThreadName(thread, revision),
    );
    listedScope = params;
    set({
      threadListErrors: errors,
      projectlessDirectories: projectless.directories,
      projectOrder: [
        ...projectGroups(
          sorted,
          get().projects,
          get().pins,
          projectless.directories,
          get().projectlessRoot,
        )
          .map(([path]) => path)
          .filter((path) => !get().projectOrder?.includes(path)),
        ...(get().projectOrder || []),
      ],
      threads: sorted.filter((t) => !records.deletedThreads.has(t.id)),
      current: get().current
        ? sorted.find((t) => t.id === get().current.id) || get().current
        : null,
    });
  }
  async function rename(thread, name) {
    await rpc("thread/name/set", { threadId: thread.id, name });
    records.updateThreadName(thread.id, name);
    await loadThreads();
  }
  async function archive(thread) {
    const restoring = get().archived;
    await rpc(restoring ? "thread/unarchive" : "thread/archive", {
      threadId: thread.id,
    });
    if (get().current?.id === thread.id) navigation.newChat();
    if (restoring) {
      pendingForks = [...new Set([...pendingForks, thread.id])];
      persist("cx-pending-forks", pendingForks);
      set({ archived: false });
      await navigation.openThread(thread.id);
    }
    await loadThreads();
  }
  function syncArchivedThread(id) {
    pendingForks = pendingForks.filter((value) => value !== id);
    persist("cx-pending-forks", pendingForks);
    if ((get().threadAccess?.threadId || get().current?.id) === id)
      navigation.newChat();
    else if (get().current?.id === id) set({ current: null, items: [] });
    if (localStorage.getItem("cx-current") === id)
      localStorage.removeItem("cx-current");
    const active = { ...get().active };
    delete active[id];
    const unreadCompletions = { ...get().unreadCompletions };
    delete unreadCompletions[id];
    const compactions = { ...get().compactions };
    delete compactions[id];
    set({
      active,
      unreadCompletions,
      compactions,
      threads: get().archived
        ? get().threads
        : get().threads.filter((thread) => thread.id !== id),
      questions: get().questions.filter(
        (question) => question.params?.threadId !== id,
      ),
      modal: get().modal?.thread?.id === id ? null : get().modal,
    });
    loadThreads().catch(() => {});
  }
  function forgetThread(id) {
    records.forget(id);
    pendingForks = pendingForks.filter((value) => value !== id);
    persist("cx-pending-forks", pendingForks);
    const pins = get().pins.filter((value) => value !== id);
    persist("cx-pins", pins);
    localStorage.removeItem("cx-draft-" + id);
    const undoneFiles = Object.fromEntries(
      Object.entries(get().undoneFiles).filter(
        ([key]) => JSON.parse(key)[0] !== id,
      ),
    );
    persist("cx-undone-files", undoneFiles);
    if (localStorage.getItem("cx-current") === id)
      localStorage.removeItem("cx-current");
    if (get().current?.id === id) navigation.newChat();
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
      patch[key] = { ...get()[key] };
      delete patch[key][id];
    }
    set({
      ...patch,
      undoneFiles,
      pins,
      threads: get().threads.filter((thread) => thread.id !== id),
      questions: get().questions.filter(
        (question) => question.params?.threadId !== id,
      ),
      modal: get().modal?.thread?.id === id ? null : get().modal,
    });
  }
  async function deleteThread(thread) {
    await rpc("thread/delete", { threadId: thread.id });
    forgetThread(thread.id);
    notice("对话已删除");
    await loadThreads().catch(report);
  }
  async function fork(thread = get().current, lastTurnId) {
    const revision = records.nameRevision;
    const family = [];
    for (const archived of [false, true]) {
      let cursor;
      do {
        const page = await rpc("thread/list", {
          archived,
          limit: 100,
          ...(cursor ? { cursor } : {}),
        });
        family.push(...page.data);
        cursor = page.nextCursor;
      } while (cursor);
    }
    const threads = family.map((record) =>
      records.preserveThreadName(record, revision),
    );
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
    records.updateThreadName(r.thread.id, name);
    await navigation.openThread(r.thread.id);
    await loadThreads();
    notice("已创建对话分支");
  }
  function pin(id) {
    const pins = get().pins.includes(id)
      ? get().pins.filter((x) => x !== id)
      : [...get().pins, id];
    set({ pins });
    persist("cx-pins", pins);
  }
  function addProject(path) {
    if (!get().projects.includes(path)) {
      const projects = [...get().projects, path];
      set({
        projects,
        ...(get().projectOrder && {
          projectOrder: [
            path,
            ...get().projectOrder.filter((value) => value !== path),
          ],
        }),
      });
      persist("cx-projects", projects);
    }
    navigation.newChat(path);
  }
  function toggleProjectPin(path) {
    if (!path) return;
    const projects = get().projects.includes(path)
      ? get().projects.filter((value) => value !== path)
      : [...get().projects, path];
    persist("cx-projects", projects);
    set({ projects });
  }
  return {
    listThreads,
    loadThreads,
    rename,
    archive,
    syncArchivedThread,
    forgetThread,
    deleteThread,
    fork,
    pin,
    addProject,
    toggleProjectPin,
  };
}
