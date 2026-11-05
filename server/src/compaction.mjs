import { isCompacting } from "../../shared/compaction-state.mjs";
export { isCompacting } from "../../shared/compaction-state.mjs";

// 手动整理的 RPC 响应仅确认提交；轮次结束才释放整理占用。
export function createCompactions(notify, now = () => Date.now() / 1000) {
  const entries = new Map();
  function update(threadId, value) {
    entries.set(threadId, value);
    notify({
      method: "lan/compaction",
      params: { threadId, compaction: value },
    });
    return value;
  }
  function finish(threadId, status, error, completedAt = now()) {
    const entry = entries.get(threadId);
    return update(threadId, { ...entry, status, error, completedAt });
  }
  return {
    entries,
    update,
    finish,
    busy: (threadId) => isCompacting(entries.get(threadId)),
    start(threadId, id) {
      return update(threadId, {
        id: String(id),
        status: "starting",
        startedAt: now(),
      });
    },
    reject(threadId, id, error) {
      const entry = entries.get(threadId);
      if (entry?.id === String(id) && isCompacting(entry))
        finish(threadId, "failed", error);
    },
    event(method, p) {
      const entry = entries.get(p.threadId);
      if (!isCompacting(entry)) return;
      if (
        method === "turn/started" &&
        entry.status === "starting" &&
        !entry.turnId
      )
        update(p.threadId, { ...entry, turnId: p.turn.id, status: "running" });
      if (
        (method === "item/started" || method === "item/completed") &&
        p.item.type === "contextCompaction" &&
        (!entry.turnId || entry.turnId === p.turnId)
      )
        update(p.threadId, { ...entry, turnId: p.turnId, status: "running" });
      if (method === "turn/completed" && entry.turnId === p.turn.id) {
        const status =
          p.turn.status === "completed"
            ? "completed"
            : p.turn.status === "interrupted"
              ? "interrupted"
              : "failed";
        finish(
          p.threadId,
          status,
          p.turn.error?.message,
          p.turn.completedAt ?? now(),
        );
      }
      if (method === "thread/closed")
        update(p.threadId, {
          ...entry,
          status: "reconnecting",
          error: "整理订阅已关闭，需要重新核对任务状态。",
        });
    },
    disconnected() {
      for (const [threadId, entry] of entries)
        if (isCompacting(entry))
          update(threadId, {
            ...entry,
            status: "reconnecting",
            error: "与 Codex 后端的连接中断，正在确认整理结果。",
          });
    },
  };
}
