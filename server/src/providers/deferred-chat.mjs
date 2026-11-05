import { Readable } from "node:stream";
import { createToolDiscovery } from "./tool-discovery.mjs";

async function* chunks(response) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const bytes of response.body) {
    buffer += decoder.decode(bytes, { stream: true });
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trimEnd();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data && data !== "[DONE]") yield JSON.parse(data);
    }
  }
}

export async function fetchDeferredChat(url, input, options) {
  const discovery = createToolDiscovery(input);
  if (!discovery) return fetch(url, options);
  const send = () =>
    fetch(url, { ...options, body: JSON.stringify(discovery.request()) });
  let upstream = await send();
  if (!upstream.ok) return upstream;
  if (!input.stream) {
    for (let round = 0; round < 8; round++) {
      const result = await upstream.json();
      const completion = discovery.complete(result.choices[0].message);
      if (completion.done) {
        if (result.choices[0].message.tool_calls)
          result.choices[0].message.tool_calls = completion.calls;
        return Response.json(result);
      }
      upstream = await send();
      if (!upstream.ok) return upstream;
    }
    throw new Error("工具发现次数超过限制，请缩小任务范围后重试。");
  }
  const encode = (value) =>
    Buffer.from("data: " + JSON.stringify(value) + "\n\n");
  async function* stream() {
    for (let round = 0; round < 8; round++) {
      const calls = new Map();
      let text = "",
        reasoning = "",
        final,
        usage;
      for await (const chunk of chunks(upstream)) {
        if (chunk.usage) usage = chunk.usage;
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        final = chunk;
        const delta = choice.delta || {};
        text += delta.content || "";
        reasoning += delta.reasoning_content || delta.reasoning || "";
        for (const part of delta.tool_calls || []) {
          const call = calls.get(part.index) || {
            id: "",
            type: "function",
            function: { name: "", arguments: "" },
          };
          if (part.id) call.id = part.id;
          if (part.function?.name) call.function.name += part.function.name;
          call.function.arguments += part.function?.arguments || "";
          calls.set(part.index, call);
        }
        const { tool_calls, ...visible } = delta;
        if (Object.keys(visible).length)
          yield encode({
            ...chunk,
            choices: [{ ...choice, delta: visible, finish_reason: null }],
          });
      }
      if (!final) throw new Error("供应商未返回有效的流式结果。");
      const message = {
        role: "assistant",
        content: text || null,
        ...(reasoning && { reasoning_content: reasoning }),
        tool_calls: [...calls.values()],
      };
      const completion = discovery.complete(message);
      if (completion.done) {
        if (completion.calls.length)
          yield encode({
            ...final,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: completion.calls.map((call, index) => ({
                    ...call,
                    index,
                  })),
                },
                finish_reason: null,
              },
            ],
          });
        yield encode({
          ...final,
          choices: [
            {
              ...final.choices[0],
              delta: {},
              finish_reason: completion.calls.length
                ? "tool_calls"
                : final.choices[0].finish_reason || "stop",
            },
          ],
          ...(usage && { usage }),
        });
        yield Buffer.from("data: [DONE]\n\n");
        return;
      }
      upstream = await send();
      if (!upstream.ok)
        throw new Error(
          "工具发现请求失败：HTTP " +
            upstream.status +
            " " +
            (await upstream.text()).slice(0, 1000),
        );
    }
    throw new Error("工具发现次数超过限制，请缩小任务范围后重试。");
  }
  return new Response(Readable.toWeb(Readable.from(stream())), {
    headers: { "Content-Type": "text/event-stream" },
  });
}
