import { isCompacting, recoverCompaction } from "../domain/compaction.js";
import { uid } from "../domain/format.js";
export function createCompaction({
  get,
  set,
  rpc,
  transport,
  navigation,
  records,
  hasTracking,
}) {
  const checkingCompactions = new Map();
  async function compact() {
    if (get().busy || get().loading || get().active[get().current?.id])
      throw new Error("请等待当前任务结束后整理上下文。");
    if (isCompacting(get().compactions[get().current?.id]))
      throw new Error("正在整理上下文，完成后可继续发送。");
    if (get().threadAccess && get().threadAccess.status !== "ready")
      throw new Error("请先恢复对话连接，再整理上下文。");
    const t = get().current || (await navigation.ensureThread());
    if (isCompacting(get().compactions[t.id]))
      throw new Error("正在整理上下文，完成后可继续发送。");
    const entry = {
      id: uid(),
      status: "starting",
      startedAt: Date.now() / 1000,
    };
    set({ compactions: { ...get().compactions, [t.id]: entry }, error: "" });
    try {
      await rpc("thread/compact/start", { threadId: t.id });
    } catch (error) {
      const latest = get().compactions[t.id];
      if (latest?.id === entry.id && isCompacting(latest))
        set({
          compactions: {
            ...get().compactions,
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
      if (get().current?.id !== t.id) return false;
      throw error;
    }
  }
  function refreshCompaction(threadId = get().current?.id) {
    const entry = get().compactions[threadId];
    if (!get().connected || !isCompacting(entry)) return Promise.resolve(entry);
    if (
      [...transport.pending.values()].some(
        (request) =>
          request.threadId === threadId &&
          request.method === "thread/compact/start",
      )
    )
      return Promise.resolve(entry);
    const existing = checkingCompactions.get(threadId);
    if (
      existing?.entry === entry &&
      existing.connection === transport.connection
    )
      return existing.promise;
    const connection = transport.connection;
    const revision = records.turnRevisions.get(threadId);
    const current = () =>
      transport.connection === connection &&
      get().compactions[threadId] === entry &&
      records.turnRevisions.get(threadId) === revision;
    const checking = (async () => {
      let recovered;
      let activeFromHistory;
      let readHistory = false;
      if (hasTracking()) {
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
          if (!current()) return get().compactions[threadId];
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
        const active = { ...get().active };
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
          compactions: { ...get().compactions, [threadId]: recovered },
          active,
        });
      }
      return get().compactions[threadId];
    })().finally(() => {
      if (checkingCompactions.get(threadId)?.promise === checking)
        checkingCompactions.delete(threadId);
    });
    checkingCompactions.set(threadId, { entry, connection, promise: checking });
    return checking;
  }
  return { compact, refreshCompaction };
}
