import { createThreadOrdering, sortThreads } from "../domain/thread-order.js";
export function createThreadRecords({ get, set, rpc }) {
  const deletedThreads = new Set();
  const turnRevisions = new Map();
  const threadNames = new Map();
  let nameRevision = 0;
  let readingThreadId = null;
  const threadOrdering = createThreadOrdering(rpc);
  function setReadingThread(id) {
    readingThreadId =
      get().current?.id === id &&
      !get().loading &&
      get().threadAccess?.status !== "loadError"
        ? id
        : null;
    if (!readingThreadId || !get().unreadCompletions[id]) return;
    const unreadCompletions = { ...get().unreadCompletions };
    delete unreadCompletions[id];
    set({ unreadCompletions });
  }
  function preserveThreadName(thread, revision) {
    const update = threadNames.get(thread.id);
    return update?.revision > revision
      ? { ...thread, name: update.name }
      : thread;
  }
  function updateThreadName(threadId, name) {
    threadNames.set(threadId, { name, revision: ++nameRevision });
    set({
      threads: get().threads.map((thread) =>
        thread.id === threadId ? { ...thread, name } : thread,
      ),
      current:
        get().current?.id === threadId
          ? { ...get().current, name }
          : get().current,
    });
  }
  function recordTurnTimings(threadId, turns) {
    if (deletedThreads.has(threadId)) return;
    const timings = { ...get().turnTimings[threadId] };
    for (const turn of turns) {
      const previous = timings[turn.id];
      timings[turn.id] = {
        status: turn.status ?? previous?.status,
        startedAt: turn.startedAt ?? previous?.startedAt ?? null,
        completedAt: turn.completedAt ?? previous?.completedAt ?? null,
        durationMs: turn.durationMs ?? previous?.durationMs ?? null,
      };
    }
    set({ turnTimings: { ...get().turnTimings, [threadId]: timings } });
  }
  function recordThreadActivity(threadId, turn) {
    if (deletedThreads.has(threadId)) return;
    threadOrdering.observe(threadId, turn);
    const update = (thread) =>
      thread?.id === threadId ? threadOrdering.apply(thread) : thread;
    set({
      threads: sortThreads(get().threads.map(update)),
      current: update(get().current),
    });
  }
  function forget(id) {
    threadOrdering.forget(id);
    threadNames.delete(id);
    deletedThreads.add(id);
  }

  return {
    deletedThreads,
    turnRevisions,
    threadOrdering,
    setReadingThread,
    preserveThreadName,
    updateThreadName,
    recordTurnTimings,
    recordThreadActivity,
    forget,
    get nameRevision() {
      return nameRevision;
    },
    get readingThreadId() {
      return readingThreadId;
    },
  };
}
