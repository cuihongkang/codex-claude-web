import { once } from "node:events";
import clientModule from "../../../vendor/anyresponses/src/client/openai.js";
import sseModule from "../../../vendor/anyresponses/src/stream/sse.js";
import { collapseSystemMessages } from "../../../vendor/pi-ai/transcript.js";

export function normalizeChatMessages(messages) {
  return collapseSystemMessages({
    messages: messages.map((m) => ({ ...m, timestamp: 0 })),
  }).messages.map(({ timestamp, ...message }) => message);
}

// 转换器复用 AnyResponses；只在发送副本中折叠系统消息、恢复 Codex 工具命名空间。
export async function streamChat({
  input,
  provider,
  model,
  captureUrl,
  token,
  signal,
  response,
}) {
  const names = new Map();
  for (const tool of input.tools || []) {
    if (tool.type === "namespace") {
      for (const member of tool.tools)
        names.set(tool.name + "__" + member.name, {
          name: member.name,
          namespace: tool.name,
          custom: member.type === "custom",
        });
    } else if (tool.type === "custom")
      names.set(tool.name, { name: tool.name, custom: true });
  }
  function restore(item) {
    if (item?.type !== "function_call" || !names.has(item.name)) return;
    const { custom, ...identity } = names.get(item.name);
    Object.assign(item, identity);
    if (custom) {
      item.type = "custom_tool_call";
      item.input = JSON.parse(item.arguments).input;
      delete item.arguments;
    }
  }
  const client = clientModule.createOpenAIChatClient({
    apiKey: token,
    baseUrl: captureUrl,
  });
  const request = { ...input, max_output_tokens: model.maxOutputTokens };
  if (!input.stream) {
    const result = await client.createResponse(request, {
      signal,
      strict: false,
    });
    for (const item of result.output || []) restore(item);
    response
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify(result));
    return;
  }
  async function* events() {
    try {
      for await (const event of client.streamResponse(request, {
        signal,
        strict: false,
      })) {
        restore(event.item);
        for (const item of event.response?.output || []) restore(item);
        yield event;
      }
    } catch (error) {
      yield {
        type: "response.failed",
        sequence_number: 999999,
        response: {
          id: "resp_failed",
          status: "failed",
          output: [],
          error: {
            code: error.code || "upstream_error",
            ...(error.type && { type: error.type }),
            message: provider.name + ": " + error.message.slice(0, 2048),
          },
        },
      };
    }
  }
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
  });
  for await (const bytes of sseModule.eventsToSSE(events())) {
    if (response.destroyed) break;
    if (!response.write(bytes)) await once(response, "drain", { signal });
  }
  response.end();
}
