import { resumeAfterClose } from "./resume.mjs";
import { createContextExport } from "./context-export.mjs";
import { PROVIDER_PREPARATION_TIMEOUT_MS } from "../../../shared/provider-lifecycle.mjs";

export function createPortableHistory({
  transport,
  subscriptions,
  compactions,
  parameters,
  unload,
  saveContext,
  removeContext,
  resolveSource,
}) {
  const waiting = new Map();
  const exporter = createContextExport(transport);
  async function prepare(threadId, source, target) {
    if (
      source.providerId === target.providerId &&
      target.providerId !== "codex"
    )
      return;
    if (source.providerId !== "codex" && target.providerId !== "codex") return;
    let cursor,
      needsSummary = false,
      summarized = false;
    do {
      let page;
      try {
        page = await transport.call("thread/turns/list", {
          threadId,
          limit: 100,
          itemsView: "full",
          sortDirection: "desc",
          ...(cursor && { cursor }),
        });
      } catch (error) {
        // 首条用户消息前尚无持久历史，可直接使用所选供应商开始轮次。
        if (
          !cursor &&
          error.message ===
            `thread ${threadId} is not materialized yet; thread/turns/list is unavailable before first user message`
        )
          return;
        throw error;
      }
      for (const turn of page.data || []) {
        for (const item of (turn.items || []).toReversed()) {
          if (item.type === "contextCompaction") {
            summarized = true;
            break;
          }
          if (
            item.type === "reasoning" &&
            item.content?.some((text) => text.trim())
          )
            needsSummary = true;
        }
        if (summarized) break;
      }
      cursor = page.nextCursor;
    } while (!needsSummary && !summarized && cursor);
    if (
      source.providerId === "codex" &&
      target.providerId === "codex" &&
      needsSummary
    ) {
      source = await resolveSource(threadId);
      if (!source)
        throw new Error(
          "此对话保留了第三方明文推理，请先选择原供应商整理上下文，再切回 GPT。",
        );
    } else if (source.providerId === "codex")
      needsSummary = summarized && target.providerId !== "codex";
    if (!needsSummary) return;
    await unload(threadId);
    let settings = await parameters(source);
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
        PROVIDER_PREPARATION_TIMEOUT_MS,
      );
      waiting.set(threadId, { resolve, reject });
    });
    completed.catch(() => {});
    try {
      if (source.providerId === "codex") {
        await saveContext(threadId, await exporter.run(threadId, settings));
        await unload(threadId);
        settings = await parameters(target);
        await resumeAfterClose(transport.call, {
          threadId,
          excludeTurns: true,
          ...settings,
        });
        subscriptions.subscriptions.set(threadId, new Set());
      }
      await transport.call("thread/compact/start", { threadId });
      await completed;
      await unload(threadId);
      if (source.providerId === "codex") await removeContext(threadId);
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
      if (exporter.event(message)) return true;
      if (message.method !== "turn/completed") return;
      const waiter = waiting.get(message.params.threadId);
      if (!waiter) return;
      const turn = message.params.turn;
      if (turn.status === "completed") waiter.resolve();
      else
        waiter.reject(new Error(turn.error?.message || "既有对话整理未完成"));
    },
    reset() {
      exporter.reset();
      for (const waiter of waiting.values())
        waiter.reject(new Error("Codex 连接已断开，请重试供应商切换。"));
      waiting.clear();
    },
  };
}
