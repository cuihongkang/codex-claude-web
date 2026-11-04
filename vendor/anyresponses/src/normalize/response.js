const { generateId } = require("../utils/id");
const { nowSeconds } = require("../utils/time");

function normalizeResponse(response, requestContext = {}, options = {}) {
  const strict = options.strict !== false;
  const base = response && typeof response === "object" ? response : {};
  const request = requestContext || {};

  const createdAt = pickNumber(base.created_at, nowSeconds());
  const status = pickValue(base.status, "completed");
  const completedAt = pickNumber(
    base.completed_at,
    status === "completed" ? createdAt : null,
  );

  const normalized = {
    id: pickValue(base.id, generateId("resp")),
    object: "response",
    created_at: createdAt,
    completed_at: completedAt,
    status,
    incomplete_details: normalizeIncompleteDetails(
      base.incomplete_details,
      status,
      strict,
    ),
    model: pickValue(base.model, request.model, "unknown"),
    previous_response_id: pickValue(
      base.previous_response_id,
      request.previous_response_id,
      null,
    ),
    instructions: pickValue(base.instructions, request.instructions, null),
    output: normalizeOutputItems(Array.isArray(base.output) ? base.output : []),
    error: base.error ?? null,
    tools: normalizeTools(base.tools, request.tools, strict),
    tool_choice: normalizeToolChoice(
      base.tool_choice,
      request.tool_choice,
      strict,
    ),
    truncation: pickValue(base.truncation, request.truncation, "disabled"),
    parallel_tool_calls: Boolean(
      base.parallel_tool_calls ?? request.parallel_tool_calls,
    ),
    text: normalizeTextField(base.text, request.text, strict),
    top_p: pickNumber(base.top_p, request.top_p, strict ? 1 : null),
    presence_penalty: pickNumber(
      base.presence_penalty,
      request.presence_penalty,
      strict ? 0 : null,
    ),
    frequency_penalty: pickNumber(
      base.frequency_penalty,
      request.frequency_penalty,
      strict ? 0 : null,
    ),
    top_logprobs: pickNumber(
      base.top_logprobs,
      request.top_logprobs,
      strict ? 0 : null,
    ),
    temperature: pickNumber(
      base.temperature,
      request.temperature,
      strict ? 1 : null,
    ),
    reasoning: normalizeReasoningField(
      base.reasoning,
      request.reasoning,
      strict,
    ),
    usage: normalizeUsage(base.usage),
    max_output_tokens: pickNumber(
      base.max_output_tokens,
      request.max_output_tokens,
      null,
    ),
    max_tool_calls: pickNumber(
      base.max_tool_calls,
      request.max_tool_calls,
      null,
    ),
    store: pickBoolean(base.store, request.store, false),
    background: pickBoolean(base.background, request.background, false),
    service_tier: pickValue(base.service_tier, request.service_tier, "auto"),
    metadata: base.metadata ?? request.metadata ?? null,
    safety_identifier: pickValue(
      base.safety_identifier,
      request.safety_identifier,
      null,
    ),
    prompt_cache_key: pickValue(
      base.prompt_cache_key,
      request.prompt_cache_key,
      null,
    ),
  };

  return normalized;
}

function normalizeIncompleteDetails(details, status, strict) {
  if (details && typeof details === "object") {
    return { reason: details.reason || "unknown" };
  }
  if (status === "incomplete") {
    return { reason: "unknown" };
  }
  if (strict) {
    return { reason: "none" };
  }
  return null;
}

function normalizeTextField(textField, requestText, strict) {
  const format = pickValue(textField?.format, requestText?.format, {
    type: "text",
  });
  const verbosity = pickValue(
    textField?.verbosity,
    requestText?.verbosity,
    strict ? "medium" : null,
  );
  return {
    format,
    ...(verbosity ? { verbosity } : {}),
  };
}

function normalizeReasoningField(reasoningField, requestReasoning, strict) {
  if (reasoningField && typeof reasoningField === "object") {
    return normalizeReasoningObject(reasoningField);
  }
  if (requestReasoning && typeof requestReasoning === "object") {
    return normalizeReasoningObject(requestReasoning);
  }
  if (strict) {
    return { effort: "none", summary: null };
  }
  return null;
}

function normalizeToolChoice(toolChoice, requestToolChoice, strict) {
  if (toolChoice != null) {
    return toolChoice;
  }
  if (requestToolChoice != null) {
    return requestToolChoice;
  }
  return strict ? "auto" : null;
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object") {
    return {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    };
  }

  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const cost =
    typeof usage.cost === "number" && Number.isFinite(usage.cost)
      ? usage.cost
      : null;

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: usage.total_tokens ?? inputTokens + outputTokens,
    input_tokens_details: usage.input_tokens_details || {
      cached_tokens: usage.cached_tokens ?? 0,
    },
    output_tokens_details: usage.output_tokens_details || {
      reasoning_tokens: usage.reasoning_tokens ?? 0,
    },
    ...(cost !== null ? { cost } : {}),
  };
}

function normalizeOutputItems(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  let changed = false;
  const normalized = items.map((item) => {
    if (!item || typeof item !== "object") {
      return item;
    }
    const content = normalizeOutputTextParts(item.content);
    const summary = normalizeOutputTextParts(item.summary);
    if (content === item.content && summary === item.summary) {
      return item;
    }
    changed = true;
    return {
      ...item,
      ...(content !== item.content ? { content } : {}),
      ...(summary !== item.summary ? { summary } : {}),
    };
  });
  return changed ? normalized : items;
}

function normalizeOutputTextParts(parts) {
  if (!Array.isArray(parts)) {
    return parts;
  }
  let changed = false;
  const normalized = parts.map((part) => {
    if (!part || typeof part !== "object") {
      return part;
    }
    if (part.type !== "output_text") {
      return part;
    }
    const annotations = Array.isArray(part.annotations) ? part.annotations : [];
    const logprobs = Array.isArray(part.logprobs) ? part.logprobs : [];
    if (annotations === part.annotations && logprobs === part.logprobs) {
      return part;
    }
    changed = true;
    return {
      ...part,
      annotations,
      logprobs,
    };
  });
  return changed ? normalized : parts;
}

function normalizeTools(primary, fallback, strict) {
  const tools = Array.isArray(primary)
    ? primary
    : Array.isArray(fallback)
      ? fallback
      : [];
  if (!strict) {
    return tools;
  }
  return tools.map((tool) => {
    if (!tool || typeof tool !== "object") {
      return tool;
    }
    if (tool.type !== "function") {
      return tool;
    }
    return {
      type: "function",
      name: tool.name || "",
      description: tool.description || "",
      parameters: tool.parameters || {},
      strict: typeof tool.strict === "boolean" ? tool.strict : true,
    };
  });
}

function pickValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return null;
}

function pickNumber(...values) {
  for (const value of values) {
    if (typeof value === "number" && !Number.isNaN(value)) {
      return value;
    }
  }
  return values.length > 0 ? values[values.length - 1] : null;
}

function pickBoolean(...values) {
  for (const value of values) {
    if (typeof value === "boolean") {
      return value;
    }
  }
  return values.length > 0 ? Boolean(values[values.length - 1]) : false;
}

function normalizeReasoningObject(reasoning) {
  return {
    effort: reasoning.effort ?? null,
    summary: reasoning.summary ?? null,
  };
}

module.exports = {
  normalizeResponse,
};
