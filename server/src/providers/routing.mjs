import { createPortableHistory } from "./portable-history.mjs";
import { reasoningSource } from "./reasoning-source.mjs";
import { threadMethods, loadedThreadMethods } from "../bridge/methods.mjs";

export function createProviderRouting({
  registry,
  transport,
  subscriptions,
  activeTurns,
  activeThreads,
  compactions,
  onSelection = () => {},
}) {
  const loaded = new Map();
  const closing = new Map();
  const reserved = new Set();
  const closingWaiters = new Map();
  async function providerParameters(selection) {
    const provider = await registry.get(selection.providerId);
    if (provider.builtin) {
      const config = await registry.readConfig();
      return {
        modelProvider: config.model_provider || "openai",
        ...(selection.model && { model: selection.model }),
      };
    }
    const model = selection.model
      ? provider.models.find((m) => m.id === selection.model)
      : null;
    return {
      modelProvider: provider.id,
      ...(selection.model && { model: selection.model }),
      serviceTier: null,
      config: {
        ...(model && { model_context_window: model.contextWindow }),
        thread_unload_delay_secs: 0,
      },
    };
  }
  async function parameters(selection) {
    const settings = await providerParameters(selection);
    return {
      ...settings,
      config: { ...settings.config, ...selection.overrides },
    };
  }
  async function unload(threadId) {
    if (closing.has(threadId)) {
      await closing.get(threadId);
      return;
    }
    if (!subscriptions.subscriptions.has(threadId) && !loaded.has(threadId))
      return;
    const wait = trackClosing(threadId);
    await transport.call(
      "thread/unsubscribe",
      { threadId },
      { trackThread: false },
    );
    await wait;
  }
  const portable = createPortableHistory({
    transport,
    subscriptions,
    compactions,
    parameters,
    unload,
    saveContext: registry.saveContext,
    removeContext: registry.removeContext,
    async resolveSource(threadId) {
      const { thread } = await transport.call("thread/read", {
        threadId,
        includeTurns: false,
      });
      return reasoningSource(thread.path, await registry.list(), async (id) => {
        const { thread: parent } = await transport.call("thread/read", {
          threadId: id,
          includeTurns: false,
        });
        return parent.path;
      });
    },
  });
  function closed(threadId) {
    loaded.delete(threadId);
    closingWaiters.get(threadId)?.resolve();
    closingWaiters.delete(threadId);
  }
  function trackClosing(threadId) {
    if (closing.has(threadId)) return closing.get(threadId);
    let timer;
    const task = new Promise((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error("等待 Codex 释放对话超时，请重试。")),
        30000,
      );
      closingWaiters.set(threadId, { resolve });
    }).finally(() => {
      clearTimeout(timer);
      closingWaiters.delete(threadId);
      closing.delete(threadId);
    });
    // 自动释放可能没有等待者，错误由下一次使用该对话时报告。
    task.catch(() => {});
    closing.set(threadId, task);
    return task;
  }
  async function selectionFor(threadId, params = {}) {
    const saved = threadId && (await registry.selection(threadId));
    let actual, actualModel;
    if (threadId) {
      const { thread } = await transport.call("thread/read", {
        threadId,
        includeTurns: false,
      });
      actualModel = thread?.model;
      if (thread?.modelProvider) {
        const config = await registry.readConfig();
        actual =
          thread.modelProvider === (config.model_provider || "openai")
            ? "codex"
            : await registry.resolveId(thread.modelProvider);
      }
    }
    return {
      providerId: params.providerId || actual || saved?.providerId || "codex",
      model:
        params.model ||
        actualModel ||
        (actual === saved?.providerId && saved?.model),
      ...((saved?.overrides || params.config) && {
        overrides: { ...saved?.overrides, ...params.config },
      }),
    };
  }
  async function prepare(message) {
    const { method } = message;
    const params = message.params || {};
    const threadId = params.threadId;
    const relevant =
      threadMethods.has(method) || loadedThreadMethods.has(method);
    if (!relevant) return { message };
    const selection = await selectionFor(threadId, params);
    const manages = Boolean(
      params.providerId || (threadId && (await registry.selection(threadId))),
    );
    if (!manages) return { message };
    if (threadId && reserved.has(threadId))
      throw new Error("对话正在更新供应商，请稍后重试。");
    const previous =
      threadId && (loaded.get(threadId) || (await selectionFor(threadId)));
    const changes =
      threadId &&
      (previous.providerId !== selection.providerId ||
        (previous.model &&
          selection.model &&
          previous.model !== selection.model) ||
        JSON.stringify(previous.overrides) !==
          JSON.stringify(selection.overrides));
    const busy =
      activeTurns.has(threadId) ||
      activeThreads.has(threadId) ||
      compactions.busy(threadId) ||
      [...transport.pending.values()].some(
        (p) =>
          p.threadId === threadId &&
          (threadMethods.has(p.method) || loadedThreadMethods.has(p.method)),
      );
    if (changes && busy) throw new Error("请等待当前任务结束后切换供应商。");
    if (threadId) reserved.add(threadId);
    const release = () => {
      if (threadId) reserved.delete(threadId);
    };
    try {
      if (changes && subscriptions.subscriptions.has(threadId)) {
        const wait = trackClosing(threadId);
        await transport.call(
          "thread/unsubscribe",
          { threadId },
          { trackThread: false },
        );
        await wait;
      } else if (threadId && closing.has(threadId)) await closing.get(threadId);
      if (
        changes ||
        (threadId &&
          !busy &&
          selection.providerId === "codex" &&
          ["thread/resume", "turn/start"].includes(method))
      )
        await portable.prepare(threadId, previous, selection);
      const settings = await parameters(selection);
      selection.model ||= settings.model;
      const clean = { ...params };
      delete clean.providerId;
      if (method === "thread/resume" && threadId)
        await subscriptions.resumeForWrite(threadId, settings);
      if (threadMethods.has(method)) {
        Object.assign(clean, settings, {
          config: {
            ...settings.config,
            ...params.config,
            thread_unload_delay_secs: 0,
          },
        });
      } else if (threadId) {
        await subscriptions.resumeForWrite(threadId, settings);
        if (method === "turn/start") {
          clean.model = settings.model || clean.model;
          if (selection.providerId !== "codex") {
            clean.serviceTier = null;
            clean.effort = null;
            if (clean.collaborationMode?.settings)
              clean.collaborationMode = {
                ...clean.collaborationMode,
                settings: {
                  ...clean.collaborationMode.settings,
                  model: clean.model,
                  reasoning_effort: null,
                },
              };
          }
        }
      }
      return { message: { ...message, params: clean }, selection, release };
    } catch (error) {
      release();
      throw error;
    }
  }
  async function response(request, message) {
    try {
      if (!message.error && request.providerSelection) {
        const id = message.result?.thread?.id || request.threadId;
        if (id) {
          loaded.set(id, request.providerSelection);
          const previous = await registry.selection(id);
          await registry.remember(id, request.providerSelection);
          if (
            previous?.providerId !== request.providerSelection.providerId ||
            previous?.model !== request.providerSelection.model
          )
            onSelection({
              threadId: id,
              providerId: request.providerSelection.providerId,
              model: request.providerSelection.model,
            });
        }
      }
      if (!message.error && message.result?.thread) {
        const thread = message.result.thread;
        const saved = await registry.selection(thread.id);
        const config = await registry.readConfig();
        const providerId = thread.modelProvider
          ? thread.modelProvider === (config.model_provider || "openai")
            ? "codex"
            : await registry.resolveId(thread.modelProvider)
          : saved?.providerId;
        const selection = providerId && {
          providerId,
          model:
            message.result.model ||
            thread.model ||
            (saved?.providerId === providerId ? saved?.model : undefined),
        };
        if (selection || thread.modelProvider) {
          Object.assign(
            thread,
            selection
              ? { providerId: selection.providerId, model: selection.model }
              : { providerId: "codex" },
          );
          message.result.providerId = thread.providerId;
        }
      }
    } finally {
      request.releaseProvider?.();
    }
  }
  return {
    prepare,
    response,
    event(message) {
      return portable.event(message);
    },
    isReserved: (id) => reserved.has(id),
    async providerBusy(id) {
      if (
        [...transport.pending.values()].some(
          (p) => p.providerSelection?.providerId === id,
        )
      )
        return true;
      for (const threadId of new Set([
        ...activeTurns.keys(),
        ...activeThreads,
        ...reserved,
      ])) {
        if (
          (loaded.get(threadId) || (await registry.selection(threadId)))
            ?.providerId === id
        )
          return true;
      }
      return false;
    },
    closed,
    trackClosing,
    async resumeParameters(threadId) {
      const saved = await registry.selection(threadId);
      return saved ? parameters(await selectionFor(threadId)) : {};
    },
    reset() {
      portable.reset();
      for (const waiter of closingWaiters.values()) waiter.resolve();
      closingWaiters.clear();
      loaded.clear();
      reserved.clear();
    },
  };
}
