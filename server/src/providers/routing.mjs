import { createPortableHistory } from "./portable-history.mjs";
import { threadMethods, loadedThreadMethods } from "../bridge/methods.mjs";

export function createProviderRouting({
  registry,
  gateway,
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
  let nativeSettings;
  async function providerParameters(selection) {
    const provider = await registry.get(selection.providerId);
    if (provider.builtin) {
      if (!nativeSettings) {
        const { config } = await transport.call("config/read", {
          includeLayers: false,
        });
        const id = config?.model_provider || "openai";
        const info = config?.model_providers?.[id];
        if (id === "openai" || info) {
          const definition = info || {
            name: "OpenAI",
            requires_openai_auth: true,
            supports_websockets: true,
            include_internal_metadata: true,
            ...(config?.openai_base_url && {
              base_url: config.openai_base_url,
            }),
          };
          nativeSettings = {
            modelProvider: "codex_web_default",
            config: {
              "model_providers.codex_web_default": {
                ...definition,
                capabilities: {
                  ...definition.capabilities,
                  remote_compaction: "unsupported",
                },
              },
            },
          };
        } else nativeSettings = { modelProvider: id };
      }
      return {
        ...nativeSettings,
        ...(selection.model && { model: selection.model }),
      };
    }
    const model = selection.model
      ? provider.models.find((m) => m.id === selection.model)
      : provider.models[0];
    if (!model) throw new Error("供应商未配置此模型，请重新选择模型。");
    const key = "codex_web_" + Buffer.from(provider.id).toString("hex");
    return {
      modelProvider: key,
      model: model.id,
      serviceTier: null,
      config: {
        ["model_providers." + key]: {
          name: provider.name,
          base_url: gateway.url(provider.id),
          wire_api: "responses",
          experimental_bearer_token: gateway.token,
          supports_websockets: false,
          capabilities: { remote_compaction: "unsupported" },
        },
        web_search: "disabled",
        model_context_window: model.contextWindow,
        model_auto_compact_token_limit: Math.floor(model.contextWindow * 0.75),
        model_auto_compact_token_limit_scope: "total",
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
    return {
      providerId: params.providerId || saved?.providerId || "codex",
      model: params.model || saved?.model,
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
      threadId &&
      (loaded.get(threadId) ||
        (await registry.selection(threadId)) || { providerId: "codex" });
    const changes =
      threadId &&
      (previous.providerId !== selection.providerId ||
        (previous.model &&
          selection.model &&
          previous.model !== selection.model) ||
        JSON.stringify(previous.overrides) !==
          JSON.stringify(selection.overrides));
    if (
      changes &&
      (activeTurns.has(threadId) ||
        activeThreads.has(threadId) ||
        compactions.busy(threadId) ||
        [...transport.pending.values()].some(
          (p) =>
            p.threadId === threadId &&
            (threadMethods.has(p.method) || loadedThreadMethods.has(p.method)),
        ))
    )
      throw new Error("请等待当前任务结束后切换供应商。");
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
        threadId &&
        selection.providerId !== "codex" &&
        !(await registry.selection(threadId))
      )
        await portable.prepare(threadId);
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
        const selection = await registry.selection(thread.id);
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
    event: portable.event,
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
      const selection = await registry.selection(threadId);
      return selection ? parameters(selection) : {};
    },
    reset() {
      portable.reset();
      nativeSettings = undefined;
      for (const waiter of closingWaiters.values()) waiter.resolve();
      closingWaiters.clear();
      loaded.clear();
      reserved.clear();
    },
  };
}
