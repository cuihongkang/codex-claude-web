export function createSubscriptions({
  transport,
  compactions,
  activeTurns,
  activeThreads,
}) {
  const subscriptions = new Map(),
    releasing = new Map(),
    resuming = new Map(),
    closing = new Map();
  const unwrittenThreads = new Set();
  async function resumeForWrite(threadId) {
    if (subscriptions.has(threadId)) return;
    if (!resuming.has(threadId)) {
      const resume = transport
        .call("thread/resume", {
          threadId,
          excludeTurns: true,
          approvalPolicy: "never",
          sandbox: "danger-full-access",
          config: { thread_unload_delay_secs: 0 },
        })
        .then(({ thread }) => {
          if (!subscriptions.has(thread.id))
            subscriptions.set(thread.id, new Set());
          if (thread.status?.type === "active") activeThreads.add(thread.id);
        })
        .finally(() => resuming.delete(threadId));
      resuming.set(threadId, resume);
    }
    await resuming.get(threadId);
  }
  function releaseUnusedThreads() {
    for (const [threadId, owners] of subscriptions) {
      if (
        !transport.ready ||
        compactions.busy(threadId) ||
        (unwrittenThreads.has(threadId) && owners.size) ||
        activeTurns.has(threadId) ||
        activeThreads.has(threadId) ||
        resuming.has(threadId) ||
        releasing.has(threadId) ||
        [...transport.pending.values()].some(
          (request) => request.threadId === threadId,
        )
      )
        continue;
      // 取消订阅只确认连接已脱离；原生会话在 thread/closed 后才能重新加载。
      const completion = Promise.withResolvers();
      completion.promise.catch(() => {});
      const timer = setTimeout(
        () => completion.reject(new Error("等待 Codex 对话关闭超时")),
        120000,
      );
      closing.set(threadId, completion);
      const release = transport
        .call(
          "thread/unsubscribe",
          { threadId },
          { trackThread: false, timeoutMessage: "取消对话订阅超时" },
        )
        .then(async (result) => {
          if (result.status === "unsubscribed") await completion.promise;
          if (subscriptions.get(threadId) === owners) {
            subscriptions.delete(threadId);
            unwrittenThreads.delete(threadId);
          }
          return result;
        })
        .catch((error) => {
          console.error("Thread unsubscribe:", error.message);
          throw error;
        })
        .finally(() => {
          clearTimeout(timer);
          if (closing.get(threadId) === completion) closing.delete(threadId);
          if (releasing.get(threadId) === release) releasing.delete(threadId);
        });
      release.catch(() => {});
      releasing.set(threadId, release);
    }
  }
  return {
    subscriptions,
    releasing,
    resuming,
    unwrittenThreads,
    resumeForWrite,
    releaseUnusedThreads,
    threadClosed(threadId) {
      closing.get(threadId)?.resolve();
    },
    releaseClient(client) {
      for (const owners of subscriptions.values()) owners.delete(client);
      releaseUnusedThreads();
    },
    reset() {
      for (const completion of closing.values())
        completion.reject(new Error("Codex 后端连接已关闭"));
      closing.clear();
      subscriptions.clear();
      releasing.clear();
      resuming.clear();
      unwrittenThreads.clear();
    },
  };
}
