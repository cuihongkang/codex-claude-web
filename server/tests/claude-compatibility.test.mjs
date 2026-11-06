import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createProviderTransport } from "../src/backends/claude/provider-transport.mjs";
import { convertMessage } from "../src/backends/claude/messages.mjs";

test("首次供应商请求使用合法消息结构，保留系统指令、工具和全部上下文", async (t) => {
  const seen = [];
  const server = http.createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const value = JSON.parse(body);
    seen.push(value);
    if (value.messages.some((m) => m.role === "system"))
      response.writeHead(500).end(
        JSON.stringify({
          error: { message: "System message must be at the beginning." },
        }),
      );
    else
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ content: [{ type: "text", text: "恢复成功" }] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const proxy = await createProviderTransport({
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    apiKey: "fixture",
    compatibility: {},
  });
  t.after(() => proxy.close());
  const body = {
    system: [{ type: "text", text: "规则" }],
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "任务" },
          { type: "tool_result", tool_use_id: "t", content: "结果" },
        ],
      },
      { role: "system", content: [{ type: "text", text: "工具发生变化" }] },
    ],
    tools: [{ name: "Read", input_schema: { type: "object" } }],
  };
  const call = () =>
    fetch(proxy.url + "/v1/messages", {
      method: "POST",
      headers: { "x-api-key": proxy.token },
      body: JSON.stringify(body),
    });
  assert.equal((await call()).status, 200);
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].messages[0], body.messages[0]);
  assert.deepEqual(seen[0].tools, body.tools);
  assert.deepEqual(seen[0].system, [
    ...body.system,
    ...body.messages[1].content,
  ]);
  assert.equal(seen[0].messages.length, 1);
  assert.equal((await call()).status, 200);
  assert.equal(seen.length, 2);
  assert.equal(body.messages[1].role, "system");
});

test("原生 API 失败记录保持为失败状态，正文与历史省去伪助手回复", () => {
  assert.deepEqual(
    convertMessage(
      {
        type: "assistant",
        error: "server_error",
        isApiErrorMessage: true,
        message: { content: [{ type: "text", text: "API Error: 500" }] },
      },
      "turn",
    ),
    [],
  );
  assert.equal(
    convertMessage(
      {
        type: "assistant",
        uuid: "m",
        message: {
          content: [{ type: "text", text: "API Error 这个词是正文" }],
        },
      },
      "turn",
    )[0].text,
    "API Error 这个词是正文",
  );
});
