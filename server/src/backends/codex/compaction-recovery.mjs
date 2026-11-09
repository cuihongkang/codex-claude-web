import {
  findCompactionTurn,
  recoverCompaction,
} from "../../../../shared/compaction-state.mjs";
export function createCompactionRecovery({
  transport,
  compactions,
  resumeForWrite,
  releaseUnusedThreads,
}) {
  const checkingCompactions = new Map();
  function checkCompaction(threadId) {
    if (checkingCompactions.has(threadId))
      return checkingCompactions.get(threadId);
    const entry = compactions.entries.get(threadId);
    if (!compactions.busy(threadId)) return Promise.resolve(entry);
    if (
      [...transport.pending.values()].some(
        (request) =>
          request.threadId === threadId &&
          request.method === "thread/compact/start",
      )
    )
      return Promise.resolve(entry);
    const current = () =>
      compactions.entries.get(threadId)?.id === entry.id &&
      compactions.busy(threadId);
    const checking = (async () => {
      try {
        const { thread } = await transport.call("thread/read", {
          threadId,
          includeTurns: false,
        });
        let cursor;
        const turns = [];
        do {
          const page = await transport.call("thread/turns/list", {
            threadId,
            limit: 100,
            itemsView: "full",
            ...(cursor ? { cursor } : {}),
          });
          if (!current()) return compactions.entries.get(threadId);
          turns.push(...page.data);
          cursor = page.nextCursor;
        } while (
          !findCompactionTurn(compactions.entries.get(threadId), turns) &&
          cursor
        );
        if (!current()) return compactions.entries.get(threadId);
        const recovered = recoverCompaction(
          compactions.entries.get(threadId),
          thread,
          turns,
        );
        if (recovered.status === "running") {
          await resumeForWrite(threadId);
        }
        if (current()) compactions.update(threadId, recovered);
        return compactions.entries.get(threadId);
      } catch (error) {
        if (current())
          compactions.update(threadId, {
            ...compactions.entries.get(threadId),
            status: "reconnecting",
            error: error.message,
          });
        throw error;
      } finally {
        checkingCompactions.delete(threadId);
        releaseUnusedThreads();
      }
    })();
    checkingCompactions.set(threadId, checking);
    return checking;
  }
  return checkCompaction;
}
