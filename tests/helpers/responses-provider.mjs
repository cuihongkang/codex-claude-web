import { createServer } from "node:http";
import { once } from "node:events";

// 独立模拟供应商实现原生 Responses SSE；生命周期独立于网页桥接。
export async function responsesProvider() {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const bytes of request) body += bytes;
    const input = JSON.parse(body);
    requests.push({ path: request.url, headers: request.headers, input });
    if (request.url.endsWith("/compact")) {
      response.writeHead(404).end();
      return;
    }
    const marker = JSON.stringify(input.input).match(
      /(?:SWITCH|NATIVE)-[a-z0-9]+/i,
    )?.[0];
    const reasoning = {
      id: "rs_fixture",
      type: "reasoning",
      summary: [],
      content: [
        { type: "reasoning_text", text: "Checking the remembered marker." },
      ],
    };
    const message = {
      id: "msg_fixture",
      type: "message",
      role: "assistant",
      status: "completed",
      content: [
        { type: "output_text", text: marker || "323", annotations: [] },
      ],
    };
    const result = {
      id: "resp_fixture",
      object: "response",
      model: input.model,
      status: "completed",
      output: [reasoning, message],
      usage: { input_tokens: 50, output_tokens: 20, total_tokens: 70 },
    };
    if (!input.stream) {
      response
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify(result));
      return;
    }
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    let sequence = 0;
    const emit = (event) =>
      response.write(
        "data: " +
          JSON.stringify({ ...event, sequence_number: sequence++ }) +
          "\n\n",
      );
    emit({
      type: "response.created",
      response: { ...result, status: "in_progress", output: [] },
    });
    emit({
      type: "response.output_item.added",
      output_index: 0,
      item: { ...reasoning, content: [] },
    });
    emit({
      type: "response.reasoning_text.delta",
      item_id: reasoning.id,
      output_index: 0,
      content_index: 0,
      delta: reasoning.content[0].text,
    });
    emit({
      type: "response.output_item.done",
      output_index: 0,
      item: reasoning,
    });
    emit({
      type: "response.output_item.added",
      output_index: 1,
      item: { ...message, status: "in_progress", content: [] },
    });
    emit({
      type: "response.output_text.delta",
      item_id: message.id,
      output_index: 1,
      content_index: 0,
      delta: message.content[0].text,
    });
    emit({ type: "response.output_item.done", output_index: 1, item: message });
    emit({ type: "response.completed", response: result });
    response.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    requests,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
