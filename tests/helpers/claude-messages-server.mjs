import http from "node:http";
import { randomUUID } from "node:crypto";
export async function messagesServer(
  respond = () => [{ type: "text", text: "双后端验证通过" }],
) {
  const requests = [];
  const responses = [];
  const prefix = randomUUID();
  let sequence = 0;
  const server = http.createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const input = body ? JSON.parse(body) : {};
    if (request.url.includes("count_tokens")) {
      response
        .writeHead(200, { "content-type": "application/json" })
        .end('{"input_tokens":100}');
      return;
    }
    if (!request.url.startsWith("/v1/messages")) {
      response.writeHead(404).end();
      return;
    }
    requests.push(input);
    const answer = await respond(input, requests);
    if (answer?.status) {
      responses.push({ status: answer.status, body: answer.body });
      response
        .writeHead(answer.status, {
          "content-type": "application/json",
          ...answer.headers,
        })
        .end(JSON.stringify(answer.body));
      return;
    }
    const content = answer?.content || answer;
    responses.push({ status: 200, content });
    const stop = content.some((c) => c.type === "tool_use")
      ? "tool_use"
      : "end_turn";
    const message = {
      id: `msg_fixture_${prefix}_${++sequence}`,
      type: "message",
      role: "assistant",
      model: input.model,
      content,
      stop_reason: stop,
      stop_sequence: null,
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    };
    if (!input.stream) {
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify(message));
      return;
    }
    response.writeHead(200, { "content-type": "text/event-stream" });
    const send = (event) =>
      response.write(
        `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
      );
    send({
      type: "message_start",
      message: { ...message, content: [], stop_reason: null },
    });
    content.forEach((block, index) => {
      send({
        type: "content_block_start",
        index,
        content_block:
          block.type === "tool_use"
            ? { ...block, input: {} }
            : block.type === "thinking"
              ? { type: "thinking", thinking: "", signature: "" }
              : block.type === "redacted_thinking"
                ? block
                : { type: "text", text: "" },
      });
      if (block.type !== "redacted_thinking")
        send({
          type: "content_block_delta",
          index,
          delta:
            block.type === "tool_use"
              ? {
                  type: "input_json_delta",
                  partial_json: JSON.stringify(block.input),
                }
              : block.type === "thinking"
                ? { type: "thinking_delta", thinking: block.thinking }
                : { type: "text_delta", text: block.text },
        });
      if (block.type === "thinking" && block.signature)
        send({
          type: "content_block_delta",
          index,
          delta: { type: "signature_delta", signature: block.signature },
        });
      send({ type: "content_block_stop", index });
    });
    send({
      type: "message_delta",
      delta: { stop_reason: stop, stop_sequence: null },
      usage: { output_tokens: 20 },
    });
    send({ type: "message_stop" });
    response.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    responses,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
