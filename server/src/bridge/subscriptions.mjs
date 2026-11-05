export function createSubscriptions({
  transport,
  compactions,
  activeTurns,
  activeThreads,
}) {
  const subscriptions = new Map(),
    releasing = new Map(),
    resuming = new Map();
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
      const release = transport
        .call(
          "thread/unsubscribe",
          { threadId },
          { trackThread: false, timeoutMessage: "取消对话订阅超时" },
        )
        .then((result) => {
          if (subscriptions.get(threadId) === owners) {
            subscriptions.delete(threadId);
            unwrittenThreads.delete(threadId);
          }
          return result;
        })
        .catch((error) => console.error("Thread unsubscribe:", error.message))
        .finally(() => {
          if (releasing.get(threadId) === release) releasing.delete(threadId);
        });
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
    reset() {
      subscriptions.clear();
      releasing.clear();
      resuming.clear();
      unwrittenThreads.clear();
    },
  };
}
