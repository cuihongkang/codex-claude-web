const { normalizeResponse } = require("../normalize/response");
const { createOpenAIChatAdapter } = require("../adapters/openai-chat");
const { buildOpenAIChatRequest } = require("../providers/openai/request");
function createOpenAIClient(options = {}) {
  return createOpenAIClientBase({
    ...options,
    provider: options.provider || "openai",
    mode: "responses",
  });
}

function createOpenAIChatClient(options = {}) {
  return createOpenAIClientBase({
    ...options,
    provider: options.provider || "openai-chat",
    mode: "chat",
  });
}

function createOpenAIClientBase(options = {}) {
  const mode = options.mode || "responses";
  const defaultBaseUrl = options.defaultBaseUrl;

  const apiKey = options.apiKey;
  if (!apiKey) {
    throw new Error("Missing OpenAI API key");
  }

  const baseUrl = options.baseUrl || defaultBaseUrl;
  if (!baseUrl) {
    throw new Error("Missing OpenAI base URL");
  }
  const endpointUrl = baseUrl;
  const chatAdapter =
    mode === "chat"
      ? createOpenAIChatAdapter({ provider: options.provider || "openai-chat" })
      : null;

  const fetchImpl = globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is not available");
  }

  async function createResponse(request, requestOptions = {}) {
    const headers = buildHeaders(apiKey, requestOptions.headers);
    const body = buildRequestBody(request, false, mode);
    if (requestOptions.debug) {
      console.log("[anyresponses] OpenAI request url:", endpointUrl);
      console.log(
        "[anyresponses] OpenAI request headers:",
        sanitizeHeaders(headers),
      );
      console.log("[anyresponses] OpenAI request body:", body);
    }
    const response = await fetchImpl(endpointUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: requestOptions.signal,
    });

    if (requestOptions.debug) {
      console.log("[anyresponses] OpenAI response status:", response.status);
    }

    const payload = await parseResponseJson(response);
    if (mode === "chat") {
      return chatAdapter.toOpenResponse(payload, {
        request: requestOptions.requestContext || request,
        strict: requestOptions.strict,
      });
    }
    return normalizeResponse(
      payload,
      requestOptions.requestContext || request,
      {
        strict: requestOptions.strict !== false,
      },
    );
  }

  async function* streamResponse(request, requestOptions = {}) {
    const headers = buildHeaders(apiKey, requestOptions.headers);
    const body = buildRequestBody(request, true, mode);
    if (requestOptions.debug) {
      console.log("[anyresponses] OpenAI stream url:", endpointUrl);
      console.log(
        "[anyresponses] OpenAI stream headers:",
        sanitizeHeaders(headers),
      );
      console.log("[anyresponses] OpenAI stream body:", body);
    }
    const response = await fetchImpl(endpointUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: requestOptions.signal,
    });

    if (!response.ok) {
      const errorPayload = await parseResponseJson(response);
      const detail = errorPayload?.error || {};
      const error = new Error(detail.message || "OpenAI stream failed");
      error.code = detail.code;
      error.type = detail.type;
      error.status = response.status;
      throw error;
    }

    const events = sseToEvents(response.body);
    const streamState = { sequence: 0 };
    if (mode === "chat") {
      yield* chatAdapter.toOpenStream(events, {
        request: requestOptions.requestContext || request,
        strict: requestOptions.strict,
      });
      return;
    }
    for await (const event of events) {
      normalizeResponseEvent(event, streamState);
      if (event && event.response) {
        event.response = normalizeResponse(
          event.response,
          requestOptions.requestContext || request,
          {
            strict: requestOptions.strict !== false,
          },
        );
      }
      yield event;
    }
  }

  return {
    createResponse,
    streamResponse,
  };
}

function buildHeaders(apiKey, extraHeaders) {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
    ...(extraHeaders || {}),
  };
}

function buildRequestBody(request, stream, mode) {
  if (mode === "chat") {
    const payload = buildOpenAIChatRequest(request);
    const body = {
      ...payload,
      stream,
    };
    if (stream) {
      const streamOptions = body.stream_options;
      if (!streamOptions || typeof streamOptions !== "object") {
        body.stream_options = { include_usage: true };
      } else if (streamOptions.include_usage == null) {
        body.stream_options = { ...streamOptions, include_usage: true };
      }
    }
    return body;
  }
  if (!request || typeof request !== "object") {
    throw new TypeError("request must be an object");
  }
  return {
    ...request,
    stream,
  };
}

async function parseResponseJson(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch (err) {
    payload = null;
  }
  if (!response.ok) {
    let rawText = null;
    if (!payload && response.body) {
      try {
        rawText = await response.text();
      } catch (err) {
        rawText = null;
      }
    }
    const message =
      payload?.error?.message || `OpenAI request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    if (rawText) {
      error.raw = rawText;
    }
    throw error;
  }
  return payload;
}

async function* sseToEvents(stream) {
  if (!stream) {
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines = [];

  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line === "") {
        const payload = dataLines.join("\n");
        dataLines = [];
        if (!payload) {
          continue;
        }
        if (payload === "[DONE]") {
          return;
        }
        try {
          yield JSON.parse(payload);
        } catch (err) {
          continue;
        }
        continue;
      }

      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
  }
}

function sanitizeHeaders(headers) {
  if (!headers) {
    return headers;
  }
  const sanitized = { ...headers };
  if (sanitized.authorization) {
    sanitized.authorization = "[redacted]";
  }
  return sanitized;
}

function normalizeResponseEvent(event, state) {
  if (!event || typeof event !== "object") {
    return event;
  }

  if (event.sequence_number == null) {
    state.sequence += 1;
    event.sequence_number = state.sequence;
  } else if (
    typeof event.sequence_number === "number" &&
    event.sequence_number > state.sequence
  ) {
    state.sequence = event.sequence_number;
  }

  if (
    event.type === "response.output_text.delta" ||
    event.type === "response.output_text.done"
  ) {
    if (!Array.isArray(event.logprobs)) {
      event.logprobs = [];
    }
  }

  if (
    event.type === "response.content_part.added" ||
    event.type === "response.content_part.done" ||
    event.type === "response.reasoning_summary_part.added" ||
    event.type === "response.reasoning_summary_part.done"
  ) {
    event.part = normalizeContentPart(event.part);
  }

  if (
    event.type === "response.output_item.added" ||
    event.type === "response.output_item.done"
  ) {
    event.item = normalizeEventItem(event.item);
  }

  return event;
}

function normalizeEventItem(item) {
  if (!item || typeof item !== "object") {
    return item;
  }
  if (item.type === "message") {
    if (!Array.isArray(item.content)) {
      item.content = [];
    }
    if (!item.status) {
      item.status = "in_progress";
    }
  }
  if (item.type === "reasoning") {
    if (!Array.isArray(item.summary)) {
      item.summary = [];
    }
  }
  if (Array.isArray(item.content)) {
    item.content = item.content.map(normalizeContentPart);
  }
  if (Array.isArray(item.summary)) {
    item.summary = item.summary.map(normalizeContentPart);
  }
  return item;
}

function normalizeContentPart(part) {
  if (!part || typeof part !== "object") {
    return part;
  }
  if (part.type !== "output_text") {
    if (part.type === "summary_text") {
      if (typeof part.text !== "string") {
        part.text = "";
      }
    }
    return part;
  }
  if (typeof part.text !== "string") {
    part.text = "";
  }
  if (!Array.isArray(part.annotations)) {
    part.annotations = [];
  }
  if (!Array.isArray(part.logprobs)) {
    part.logprobs = [];
  }
  return part;
}

module.exports = {
  createOpenAIClient,
  createOpenAIChatClient,
};
