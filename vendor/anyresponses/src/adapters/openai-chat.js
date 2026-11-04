const { generateId } = require("../utils/id");
const { nowSeconds } = require("../utils/time");
const { toAsyncIterable } = require("../utils/iter");
const { normalizeResponse } = require("../normalize/response");

function createOpenAIChatAdapter(adapterOptions = {}) {
  const provider = adapterOptions.provider || "openai";

  function toOpenResponse(input, options = {}) {
    if (!input || typeof input !== "object") {
      throw new TypeError("input must be an object");
    }

    const request = options.request || {};
    const choice = pickPrimaryChoice(input.choices);
    const finishReason = choice?.finish_reason || null;
    const status = mapStatus(finishReason, input.error);
    const createdAt = pickTimestamp(
      input.created,
      options.created_at,
      nowSeconds(),
    );
    const completedAt = status === "completed" ? nowSeconds() : null;

    const response = {
      id: input.id || options.response_id || generateId("resp"),
      object: "response",
      created_at: createdAt,
      completed_at: completedAt,
      status,
      incomplete_details:
        status === "incomplete"
          ? { reason: mapIncompleteReason(finishReason) }
          : null,
      model: input.model || request.model || null,
      previous_response_id: request.previous_response_id || null,
      instructions: request.instructions || null,
      output: buildOutputItems(input.choices, status),
      error: input.error || null,
      tools: request.tools || [],
      tool_choice: request.tool_choice || null,
      truncation: request.truncation || "disabled",
      parallel_tool_calls: Boolean(request.parallel_tool_calls),
      text: request.text || null,
      top_p: request.top_p ?? null,
      presence_penalty: request.presence_penalty ?? null,
      frequency_penalty: request.frequency_penalty ?? null,
      top_logprobs: request.top_logprobs ?? null,
      temperature: request.temperature ?? null,
      reasoning: request.reasoning || null,
      usage: buildUsage(input.usage, options.usage),
      max_output_tokens: request.max_output_tokens ?? null,
      max_tool_calls: request.max_tool_calls ?? null,
      store: request.store ?? null,
      background: request.background ?? null,
      service_tier: request.service_tier ?? null,
      metadata: request.metadata ?? null,
      safety_identifier: request.safety_identifier ?? null,
      prompt_cache_key: request.prompt_cache_key ?? null,
    };

    return normalizeResponse(response, request, {
      strict: options.strict !== false,
    });
  }

  async function* toOpenStream(events, options = {}) {
    const iterable = toAsyncIterable(events);
    const state = createStreamState(options);
    const emitCreated = () =>
      makeEvent(
        "response.created",
        {
          response: buildResponseFromState(state, "in_progress"),
        },
        state,
      );
    const ensureMessageAdded = () => {
      if (state.messageAdded) {
        return null;
      }
      state.messageAdded = true;
      state.messageOutputIndex = state.nextOutputIndex++;
      return makeEvent(
        "response.output_item.added",
        {
          output_index: state.messageOutputIndex,
          item: buildMessageItem([], "in_progress", state.messageId),
        },
        state,
      );
    };
    const ensureContentPartAdded = () => {
      if (state.contentPartAdded) {
        return null;
      }
      state.contentPartAdded = true;
      return makeEvent(
        "response.content_part.added",
        {
          item_id: state.messageId,
          output_index: state.messageOutputIndex,
          content_index: state.contentIndex,
          part: buildOutputTextPart(""),
        },
        state,
      );
    };

    for await (const event of iterable) {
      if (!event || typeof event !== "object") {
        continue;
      }
      if (event.usage) {
        state.usage = event.usage;
      }
      if (event.id && !state.responseId) {
        state.responseId = event.id;
      }
      if (event.model) {
        state.model = event.model;
      }

      const choice = pickPrimaryChoice(event.choices);
      if (!choice) {
        continue;
      }
      const delta = choice.delta || {};

      if (!state.responseStarted) {
        state.responseStarted = true;
        yield emitCreated();
        yield makeEvent(
          "response.in_progress",
          {
            response: buildResponseFromState(state, "in_progress"),
          },
          state,
        );
      }

      const reasoning = extractReasoningText(delta);
      if (reasoning) yield* appendReasoning(state, reasoning);
      if (delta.content || delta.tool_calls?.length || delta.function_call)
        yield* finishReasoning(state, "completed");

      if (delta.content) {
        const addedEvent = ensureMessageAdded();
        if (addedEvent) {
          yield addedEvent;
        }
        const partEvent = ensureContentPartAdded();
        if (partEvent) {
          yield partEvent;
        }
        state.messageText += delta.content;
        yield makeEvent(
          "response.output_text.delta",
          {
            item_id: state.messageId,
            output_index: state.messageOutputIndex,
            content_index: state.contentIndex,
            delta: delta.content,
            logprobs: [],
          },
          state,
        );
      }

      if (Array.isArray(delta.tool_calls)) {
        for (const toolCall of delta.tool_calls) {
          updateToolCallState(state, toolCall);
        }
      }

      if (delta.function_call) {
        updateLegacyFunctionCallState(state, delta.function_call);
      }

      if (choice.finish_reason) {
        state.stopReason = choice.finish_reason;
        state.status = mapStopReasonToStatus(state.stopReason);
        state.finished = true;
      }
    }

    if (!state.responseStarted) {
      return;
    }

    const status = state.status || mapStopReasonToStatus(state.stopReason);
    yield* finishReasoning(state, status);

    if (state.messageAdded) {
      if (state.contentPartAdded) {
        yield makeEvent(
          "response.output_text.done",
          {
            item_id: state.messageId,
            output_index: state.messageOutputIndex,
            content_index: state.contentIndex,
            text: state.messageText,
            logprobs: [],
          },
          state,
        );
        yield makeEvent(
          "response.content_part.done",
          {
            item_id: state.messageId,
            output_index: state.messageOutputIndex,
            content_index: state.contentIndex,
            part: buildOutputTextPart(state.messageText),
          },
          state,
        );
      }
      yield makeEvent(
        "response.output_item.done",
        {
          output_index: state.messageOutputIndex,
          item: buildMessageItem(
            state.messageText ? [buildOutputTextPart(state.messageText)] : [],
            status,
            state.messageId,
          ),
        },
        state,
      );
    }

    const toolCalls = finalizeToolCalls(state);
    for (const toolCall of toolCalls) {
      const outputIndex = state.nextOutputIndex;
      state.nextOutputIndex += 1;
      const item = buildFunctionCallItem(toolCall, status);
      yield makeEvent(
        "response.output_item.added",
        {
          output_index: outputIndex,
          item,
        },
        state,
      );
      yield makeEvent(
        "response.output_item.done",
        {
          output_index: outputIndex,
          item,
        },
        state,
      );
    }

    const responseEventType =
      status === "failed" ? "response.failed" : "response.completed";
    yield makeEvent(
      responseEventType,
      {
        response: buildResponseFromState(state, status),
      },
      state,
    );
  }

  return {
    provider,
    toOpenResponse,
    toOpenStream,
    capabilities: {
      streaming: true,
      tool_use: true,
      multimodal: true,
    },
  };
}

function buildOutputItems(choices, status) {
  const items = [];
  const list = Array.isArray(choices) ? choices : [];
  for (const choice of list) {
    const message = choice?.message || {};
    const text = extractContentText(message.content);
    const { summaryText, messageText } = splitThinkText(text);
    const reasoning = extractReasoningText(message) || summaryText;
    if (reasoning) {
      items.push(buildReasoningItem(reasoning, status));
    }
    if (messageText) {
      items.push(
        buildMessageItem(
          [buildOutputTextPart(messageText)],
          status,
          generateId("msg"),
        ),
      );
    }
    const toolCalls = collectToolCalls(message);
    for (const toolCall of toolCalls) {
      items.push(buildFunctionCallItem(toolCall, status));
    }
  }
  return items;
}

function collectToolCalls(message) {
  const toolCalls = [];
  const calls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  for (const call of calls) {
    const callId = call.id || generateId("call");
    toolCalls.push({
      id: callId,
      name: call.function?.name || "tool",
      json: call.function?.arguments || "{}",
    });
  }
  if (message?.function_call) {
    toolCalls.push({
      id: generateId("call"),
      name: message.function_call.name || "tool",
      json: message.function_call.arguments || "{}",
    });
  }
  return toolCalls;
}

function extractContentText(content) {
  if (!content) {
    return "";
  }
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const parts = [];
    for (const part of content) {
      if (typeof part === "string") {
        parts.push(part);
        continue;
      }
      if (part?.type === "text" && part.text) {
        parts.push(part.text);
      }
      if (part?.type === "output_text" && part.text) {
        parts.push(part.text);
      }
    }
    return parts.join("");
  }
  return "";
}

function buildMessageItem(content, status, id) {
  return {
    id,
    type: "message",
    role: "assistant",
    status: status || "completed",
    content,
  };
}

function buildOutputTextPart(text) {
  return {
    type: "output_text",
    text,
    annotations: [],
    logprobs: [],
  };
}

function buildFunctionCallItem(toolState, status) {
  const callId = toolState.id || generateId("call");
  return {
    id: callId,
    type: "function_call",
    call_id: callId,
    name: toolState.name || "tool",
    arguments: toolState.json || "{}",
    status: status || "completed",
  };
}

function extractReasoningText(message) {
  return (
    [message.reasoning_content, message.reasoning].find(
      (value) => typeof value === "string" && value.length,
    ) || ""
  );
}

function buildReasoningItem(text, status, id = generateId("rsn")) {
  return {
    id,
    type: "reasoning",
    summary: [],
    content: text
      ? [
          {
            type: "reasoning_text",
            text,
          },
        ]
      : [],
    status: status || "completed",
  };
}

function* appendReasoning(state, text) {
  if (!state.activeReasoning) {
    const item = {
      id: generateId("rsn"),
      outputIndex: state.nextOutputIndex++,
      text: "",
    };
    state.activeReasoning = item;
    state.reasoningItems.push(item);
    yield makeEvent(
      "response.output_item.added",
      {
        output_index: item.outputIndex,
        item: buildReasoningItem("", "in_progress", item.id),
      },
      state,
    );
    yield makeEvent(
      "response.content_part.added",
      {
        item_id: item.id,
        output_index: item.outputIndex,
        content_index: 0,
        part: { type: "reasoning_text", text: "" },
      },
      state,
    );
  }
  const item = state.activeReasoning;
  item.text += text;
  yield makeEvent(
    "response.reasoning_text.delta",
    {
      item_id: item.id,
      output_index: item.outputIndex,
      content_index: 0,
      delta: text,
    },
    state,
  );
}

function* finishReasoning(state, status) {
  const item = state.activeReasoning;
  if (!item) return;
  item.status = status;
  const identity = {
    item_id: item.id,
    output_index: item.outputIndex,
    content_index: 0,
  };
  yield makeEvent(
    "response.reasoning_text.done",
    {
      ...identity,
      text: item.text,
    },
    state,
  );
  yield makeEvent(
    "response.content_part.done",
    {
      ...identity,
      part: { type: "reasoning_text", text: item.text },
    },
    state,
  );
  yield makeEvent(
    "response.output_item.done",
    {
      output_index: item.outputIndex,
      item: buildReasoningItem(item.text, status, item.id),
    },
    state,
  );
  state.activeReasoning = null;
}

function buildUsage(usage, fallback) {
  const resolved = usage || fallback || {};
  const inputTokens = resolved.prompt_tokens ?? resolved.input_tokens ?? 0;
  const outputTokens =
    resolved.completion_tokens ?? resolved.output_tokens ?? 0;
  const cost =
    typeof resolved.cost === "number" && Number.isFinite(resolved.cost)
      ? resolved.cost
      : null;
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: resolved.total_tokens ?? inputTokens + outputTokens,
    input_tokens_details: {
      cached_tokens:
        resolved.prompt_tokens_details?.cached_tokens ??
        resolved.input_tokens_details?.cached_tokens ??
        resolved.cached_tokens ??
        0,
    },
    output_tokens_details: {
      reasoning_tokens:
        resolved.completion_tokens_details?.reasoning_tokens ??
        resolved.reasoning_tokens ??
        0,
    },
    ...(cost !== null ? { cost } : {}),
  };
}

function createStreamState(options) {
  const request = options.request || {};
  return {
    sequence: 0,
    responseId: options.response_id || null,
    messageId: options.message_id || generateId("msg"),
    messageOutputIndex: 0,
    nextOutputIndex: 0,
    contentIndex: 0,
    messageAdded: false,
    contentPartAdded: false,
    messageText: "",
    reasoningItems: [],
    activeReasoning: null,
    toolCallStates: new Map(),
    toolCallOrder: [],
    stopReason: null,
    status: "in_progress",
    responseStarted: false,
    finished: false,
    request,
    model: request.model || null,
    createdAt: nowSeconds(),
    usage: null,
    strict: options.strict !== false,
  };
}

function updateToolCallState(state, toolCall) {
  const key = String(toolCall.index ?? toolCall.id ?? "");
  if (!state.toolCallStates.has(key)) {
    state.toolCallStates.set(key, {
      id: toolCall.id || generateId("call"),
      name: toolCall.function?.name || "tool",
      json: "",
    });
    state.toolCallOrder.push(key);
  }
  const entry = state.toolCallStates.get(key);
  if (toolCall.function?.name) {
    entry.name = toolCall.function.name;
  }
  if (toolCall.function?.arguments) {
    entry.json += toolCall.function.arguments;
  }
}

function updateLegacyFunctionCallState(state, functionCall) {
  const key = "function_call";
  if (!state.toolCallStates.has(key)) {
    state.toolCallStates.set(key, {
      id: generateId("call"),
      name: functionCall.name || "tool",
      json: "",
    });
    state.toolCallOrder.push(key);
  }
  const entry = state.toolCallStates.get(key);
  if (functionCall.name) {
    entry.name = functionCall.name;
  }
  if (functionCall.arguments) {
    entry.json += functionCall.arguments;
  }
}

function finalizeToolCalls(state) {
  const calls = [];
  for (const key of state.toolCallOrder) {
    const entry = state.toolCallStates.get(key);
    if (entry) {
      calls.push(entry);
    }
  }
  return calls;
}

function makeEvent(type, payload, state) {
  state.sequence += 1;
  return {
    type,
    sequence_number: state.sequence,
    ...payload,
  };
}

function buildResponseFromState(state, status) {
  const output =
    status === "in_progress" ? [] : buildOutputFromState(state, status);
  const response = {
    id: state.responseId || generateId("resp"),
    object: "response",
    created_at: state.createdAt,
    completed_at: status === "completed" ? nowSeconds() : null,
    status,
    incomplete_details:
      status === "incomplete"
        ? { reason: mapIncompleteReason(state.stopReason) }
        : null,
    model: state.model || "unknown",
    previous_response_id: state.request.previous_response_id || null,
    instructions: state.request.instructions || null,
    output,
    error: null,
    tools: state.request.tools || [],
    tool_choice: state.request.tool_choice || null,
    truncation: state.request.truncation || "disabled",
    parallel_tool_calls: Boolean(state.request.parallel_tool_calls),
    text: state.request.text || null,
    top_p: state.request.top_p ?? null,
    presence_penalty: state.request.presence_penalty ?? null,
    frequency_penalty: state.request.frequency_penalty ?? null,
    top_logprobs: state.request.top_logprobs ?? null,
    temperature: state.request.temperature ?? null,
    reasoning: state.request.reasoning || null,
    usage: state.usage ? buildUsage(state.usage, null) : null,
    max_output_tokens: state.request.max_output_tokens ?? null,
    max_tool_calls: state.request.max_tool_calls ?? null,
  };

  return normalizeResponse(response, state.request, { strict: state.strict });
}

function buildOutputFromState(state, status) {
  const indexed = state.reasoningItems.map((item) => ({
    index: item.outputIndex,
    item: buildReasoningItem(item.text, item.status || status, item.id),
  }));
  if (state.messageAdded) {
    const { summaryText, messageText } = splitThinkText(state.messageText);
    if (summaryText && !state.reasoningItems.length)
      indexed.push({
        index: state.messageOutputIndex - 0.5,
        item: buildReasoningItem(summaryText, status),
      });
    const content = messageText ? [buildOutputTextPart(messageText)] : [];
    indexed.push({
      index: state.messageOutputIndex,
      item: buildMessageItem(content, status, state.messageId),
    });
  }
  const items = indexed
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.item);
  for (const toolCall of finalizeToolCalls(state)) {
    items.push(buildFunctionCallItem(toolCall, status));
  }
  return items;
}

function splitThinkText(text) {
  if (!text || typeof text !== "string") {
    return { summaryText: "", messageText: text || "" };
  }
  const regex = /<think>([\s\S]*?)<\/think>/gi;
  let match = null;
  let lastIndex = 0;
  const summaryParts = [];
  const messageParts = [];
  while ((match = regex.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index);
    if (before) {
      messageParts.push(before);
    }
    const summary = match[1];
    if (summary && summary.trim()) {
      summaryParts.push(summary.trim());
    }
    lastIndex = match.index + match[0].length;
  }
  const after = text.slice(lastIndex);
  if (after) {
    messageParts.push(after);
  }
  return {
    summaryText: summaryParts.join("\n\n"),
    messageText: messageParts.join("").trim(),
  };
}

function pickPrimaryChoice(choices) {
  const list = Array.isArray(choices) ? choices : [];
  if (!list.length) {
    return null;
  }
  const indexed = list.find((choice) => choice && choice.index === 0);
  return indexed || list[0];
}

function mapStatus(finishReason, error) {
  if (error) {
    return "failed";
  }
  if (finishReason === "length") {
    return "incomplete";
  }
  if (finishReason === "content_filter") {
    return "failed";
  }
  return "completed";
}

function mapStopReasonToStatus(stopReason) {
  if (stopReason === "length") {
    return "incomplete";
  }
  if (stopReason === "content_filter") {
    return "failed";
  }
  return "completed";
}

function mapIncompleteReason(finishReason) {
  if (finishReason === "length") {
    return "max_output_tokens";
  }
  return "unknown";
}

function pickTimestamp(primary, fallback, defaultValue) {
  if (typeof primary === "number") {
    return primary;
  }
  if (typeof fallback === "number") {
    return fallback;
  }
  return defaultValue;
}

module.exports = {
  createOpenAIChatAdapter,
};
