function nativeUsage(value = {}) {
  const inputTokens = value.input_tokens || 0;
  const outputTokens = value.output_tokens || 0;
  const cachedInputTokens =
    (value.cache_read_input_tokens || 0) +
    (value.cache_creation_input_tokens || 0);
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    totalTokens: inputTokens + outputTokens + cachedInputTokens,
  };
}
function totals(models = {}) {
  const total = {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    totalTokens: 0,
  };
  for (const model of Object.values(models)) {
    total.inputTokens += model.inputTokens || 0;
    total.outputTokens += model.outputTokens || 0;
    total.cachedInputTokens +=
      (model.cacheReadInputTokens || 0) + (model.cacheCreationInputTokens || 0);
  }
  total.totalTokens =
    total.inputTokens + total.outputTokens + total.cachedInputTokens;
  return total;
}
export function configuredTokenUsage(session, provider) {
  const contextWindow =
    provider?.modelCapabilities?.[session.model]?.contextWindow;
  return session.tokenUsage && contextWindow
    ? {
        ...session.tokenUsage,
        model: session.model,
        modelContextWindow: contextWindow,
      }
    : session.tokenUsage;
}
export function createTokenUsage({ threadId, session, save, emit }) {
  let value = session.tokenUsage || null;
  let capacityQuery, capacityModel;
  async function publish(next) {
    value = next;
    await save(threadId, (s) => ({ ...s, tokenUsage: value }));
    emit("thread/tokenUsage/updated", { threadId, tokenUsage: value });
  }
  return async (message, process) => {
    if (message.parent_tool_use_id || message.isReplay) return;
    const apiMessage =
      message.type === "assistant"
        ? message.message
        : message.type === "stream_event" &&
            message.event?.type === "message_start"
          ? message.event.message
          : null;
    if (apiMessage?.usage) {
      const next = {
        ...value,
        model: process.model,
        last: nativeUsage(apiMessage.usage),
      };
      if (capacityQuery !== process.query || capacityModel !== process.model) {
        delete next.modelContextWindow;
        capacityQuery = process.query;
        capacityModel = process.model;
      }
      if (!next.modelContextWindow) await context(next, process);
      await publish(next);
    }
    if (message.type !== "result") return;
    const model = message.modelUsage?.[process.model];
    const next = {
      ...value,
      total: totals(message.modelUsage),
      model: process.model,
      modelContextWindow: model?.contextWindow || value?.modelContextWindow,
    };
    await context(next, process, true);
    await publish(next);
  };
  async function context(next, process, updateTotal = false) {
    try {
      const context = await process.query.getContextUsage({
        detail: "summary",
      });
      if (updateTotal)
        next.last = { ...next.last, totalTokens: context.totalTokens };
      if (context.rawMaxTokens > 0)
        next.modelContextWindow = context.rawMaxTokens;
      delete next.error;
    } catch (error) {
      next.error = error.message;
    }
  }
}
