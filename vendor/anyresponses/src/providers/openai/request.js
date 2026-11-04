function buildOpenAIRequest(openRequest = {}) {
  return {
    ...openRequest,
    model: openRequest.model,
  };
}

function buildOpenAIChatRequest(openRequest = {}) {
  if (!openRequest || typeof openRequest !== "object") {
    throw new TypeError("request must be an object");
  }

  const messages = buildMessages(openRequest);
  const payload = {
    model: openRequest.model,
    messages,
  };

  if (openRequest.temperature != null) {
    payload.temperature = openRequest.temperature;
  }
  if (openRequest.top_p != null) {
    payload.top_p = openRequest.top_p;
  }
  if (openRequest.presence_penalty != null) {
    payload.presence_penalty = openRequest.presence_penalty;
  }
  if (openRequest.frequency_penalty != null) {
    payload.frequency_penalty = openRequest.frequency_penalty;
  }
  if (openRequest.max_output_tokens != null) {
    payload.max_tokens = openRequest.max_output_tokens;
  } else if (openRequest.max_tokens != null) {
    payload.max_tokens = openRequest.max_tokens;
  }
  if (openRequest.stream_options != null) {
    payload.stream_options = openRequest.stream_options;
  }

  const format = openRequest.text?.format;
  if (format?.type === "json_schema") {
    const { type, ...schema } = format;
    payload.response_format = { type, json_schema: schema };
  } else if (format?.type === "json_object")
    payload.response_format = { type: "json_object" };

  const additionalTools =
    (openRequest.input || []).flatMap?.((item) =>
      item.type === "additional_tools" ? item.tools || [] : [],
    ) || [];
  const tools = normalizeTools([
    ...(openRequest.tools || []),
    ...additionalTools,
  ]);
  if (tools.length) {
    payload.tools = tools;
  }
  const toolChoice = normalizeToolChoice(openRequest.tool_choice);
  if (toolChoice != null) {
    payload.tool_choice = toolChoice;
  }

  return payload;
}

function buildMessages(openRequest) {
  if (Array.isArray(openRequest.messages)) {
    return openRequest.messages;
  }

  const messages = [];
  if (openRequest.instructions) {
    messages.push({ role: "system", content: openRequest.instructions });
  }

  const input = openRequest.input;
  if (typeof input === "string") {
    messages.push({ role: "user", content: input });
    return messages;
  }

  if (Array.isArray(input)) {
    for (const item of input) {
      if (!item || typeof item !== "object") {
        continue;
      }
      if (item.type === "function_call" || item.type === "custom_tool_call") {
        const call = {
          id: item.call_id,
          type: "function",
          function: {
            name: item.namespace
              ? item.namespace + "__" + item.name
              : item.name,
            arguments:
              item.type === "custom_tool_call"
                ? JSON.stringify({ input: item.input })
                : item.arguments,
          },
        };
        const previous = messages.at(-1);
        if (previous?.role === "assistant" && previous.tool_calls)
          previous.tool_calls.push(call);
        else
          messages.push({
            role: "assistant",
            content: null,
            tool_calls: [call],
          });
        continue;
      }
      if (
        item.type === "function_call_output" ||
        item.type === "custom_tool_call_output"
      ) {
        messages.push({
          role: "tool",
          tool_call_id: item.call_id,
          content:
            typeof item.output === "string"
              ? item.output
              : JSON.stringify(item.output),
        });
        continue;
      }
      if (
        ["reasoning", "additional_tools", "configuration_update"].includes(
          item.type,
        )
      )
        continue;
      if (item.type === "web_search_call") {
        messages.push({
          role: "assistant",
          content:
            "Web search activity: " +
            JSON.stringify({ action: item.action, status: item.status }),
        });
        continue;
      }
      if (item.type && item.type !== "message")
        throw new Error("Unsupported Responses input item: " + item.type);
      const role = item.role === "developer" ? "system" : item.role || "user";
      const content = normalizeContent(item.content);
      messages.push({ role, content });
    }
  }

  return messages;
}

function normalizeContent(content) {
  if (content == null) {
    return "";
  }
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const parts = [];
    for (const part of content) {
      if (!part || typeof part !== "object") {
        continue;
      }
      if (
        part.type === "input_text" ||
        part.type === "output_text" ||
        part.type === "text"
      ) {
        parts.push({ type: "text", text: part.text || "" });
        continue;
      }
      if (part.type === "input_image") {
        const url = normalizeImageUrl(part.image_url);
        if (url) {
          parts.push({ type: "image_url", image_url: { url } });
        }
        continue;
      }
      if (part.type === "image_url") {
        const url = normalizeImageUrl(part.image_url || part.url);
        if (url) {
          parts.push({ type: "image_url", image_url: { url } });
        }
        continue;
      }
      if (part.type === "text" && part.text) {
        parts.push({ type: "text", text: part.text });
      }
    }
    if (parts.length === 1 && parts[0].type === "text") {
      return parts[0].text;
    }
    return parts;
  }
  return String(content);
}

function normalizeImageUrl(imageUrl) {
  if (!imageUrl) {
    return null;
  }
  if (typeof imageUrl === "string") {
    return imageUrl;
  }
  if (typeof imageUrl === "object") {
    return imageUrl.url || null;
  }
  return null;
}

function normalizeTools(tools) {
  const list = (Array.isArray(tools) ? tools : []).flatMap((tool) =>
    tool.type === "namespace"
      ? normalizeTools(tool.tools).map((inner) => ({
          ...inner,
          function: {
            ...inner.function,
            name: tool.name + "__" + inner.function.name,
          },
        }))
      : [tool],
  );
  return list
    .filter((tool) => tool && typeof tool === "object")
    .map((tool) => {
      if (tool.type === "custom")
        return {
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: {
              type: "object",
              properties: {
                input: {
                  type: "string",
                  description: "The complete freeform tool input.",
                },
              },
              required: ["input"],
              additionalProperties: false,
            },
          },
        };
      if (tool.type !== "function") {
        return null;
      }
      return {
        type: "function",
        function: {
          name: tool.name || tool.function?.name,
          description: tool.description || tool.function?.description,
          parameters: tool.parameters || tool.function?.parameters || {},
        },
      };
    })
    .filter(Boolean);
}

function normalizeToolChoice(toolChoice) {
  if (toolChoice == null) {
    return null;
  }
  if (toolChoice === "auto" || toolChoice === "none") {
    return toolChoice;
  }
  if (toolChoice && typeof toolChoice === "object") {
    if (toolChoice.type === "function" && toolChoice.name) {
      return {
        type: "function",
        function: { name: toolChoice.name },
      };
    }
    if (toolChoice.name) {
      return {
        type: "function",
        function: { name: toolChoice.name },
      };
    }
  }
  return null;
}

module.exports = {
  buildOpenAIRequest,
  buildOpenAIChatRequest,
};
