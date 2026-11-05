import { changesForPath, undoFileChanges } from "../file-undo.mjs";

export function createFileOperations({
  call,
  activeTurns,
  activeThreads,
  broadcast,
}) {
  const undoing = new Set();
  const undoneFiles = new Map();

  async function undo({ threadId, turnId, path }) {
    const key = JSON.stringify([threadId, turnId, path]);
    if (undoneFiles.has(key)) {
      const result = undoneFiles.get(key);
      broadcast({ method: "lan/files/undone", params: result });
      return result;
    }
    const isActive = () =>
      activeTurns.has(threadId) || activeThreads.has(threadId);
    if (isActive()) throw new Error("任务正在运行，请在结束后撤销修改。");
    if (undoing.has(threadId)) throw new Error("正在撤销文件修改，请稍候。");
    undoing.add(threadId);
    try {
      const { thread } = await call("thread/read", {
        threadId,
        includeTurns: true,
      });
      const turn = thread.turns.find((turn) => turn.id === turnId);
      if (!turn || turn.status === "inProgress")
        throw new Error("请重新加载此轮记录后再撤销。");
      await undoFileChanges({
        cwd: thread.cwd,
        changes: changesForPath(turn.items, thread.cwd, path),
        isActive,
      });
      const result = { threadId, turnId, path };
      undoneFiles.set(key, result);
      broadcast({ method: "lan/files/undone", params: result });
      return result;
    } finally {
      undoing.delete(threadId);
    }
  }

  return { undo, undoing, undoneFiles };
}
