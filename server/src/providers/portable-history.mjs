import { resumeAfterClose } from "./resume.mjs";

export function createPortableHistory({
  transport,
  subscriptions,
  compactions,
  parameters,
  unload,
}) {
  const waiting = new Map();
  async function prepare(threadId) {
    const { thread } = await transport.call("thread/read", {
      threadId,
      includeTurns: false,
    });
    if (thread.modelProvider !== "openai") return;
    let cursor,
      compacted = false;
    do {
      const page = await transport.call("thread/turns/list", {
        threadId,
        limit: 100,
        itemsView: "full",
        ...(cursor && { cursor }),
      });
      compacted = page.data?.some((turn) =>
        turn.items?.some((item) => item.type === "contextCompaction"),
      );
      cursor = page.nextCursor;
    } while (!compacted && cursor);
    if (!compacted) return;
    await unload(threadId);
    const settings = await parameters({ providerId: "codex" });
    await resumeAfterClose(transport.call, {
      threadId,
      excludeTurns: true,
      approvalPolicy: "never",
      sandbox: "danger-full-access",
      ...settings,
      config: { ...settings.config, thread_unload_delay_secs: 0 },
    });
    subscriptions.subscriptions.set(threadId, new Set());
    const requestId = "provider-migration-" + transport.nextId();
    compactions.start(threadId, requestId);
    let timer;
    const completed = new Promise((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error("整理既有对话超时，请检查对话状态后重试。")),
        300000,
      );
      waiting.set(threadId, { resolve, reject });
    });
    completed.catch(() => {});
    try {
      await transport.call("thread/compact/start", { threadId });
      await completed;
      await unload(threadId);
    } catch (error) {
      compactions.reject(threadId, requestId, error.message);
      throw error;
    } finally {
      clearTimeout(timer);
      waiting.delete(threadId);
    }
  }
  return {
    prepare,
    event(message) {
      if (message.method !== "turn/completed") return;
      const waiter = waiting.get(message.params.threadId);
      if (!waiter) return;
      const turn = message.params.turn;
      if (turn.status === "completed") waiter.resolve();
      else
        waiter.reject(new Error(turn.error?.message || "既有对话整理未完成"));
    },
    reset() {
      for (const waiter of waiting.values())
        waiter.reject(new Error("Codex 连接已断开，请重试供应商切换。"));
      waiting.clear();
    },
  };
}
