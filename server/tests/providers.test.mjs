import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { createProviderRegistry } from "../src/providers/registry.mjs";
import { createModelGateway } from "../src/providers/gateway.mjs";
import { bridge } from "../../tests/helpers/bridge.mjs";

const fixture = (baseUrl = "https://example.com/v1") => ({
  id: "fixture",
  name: "示例",
  baseUrl,
  protocol: "chat",
  apiKey: "private-key",
  models: [{ id: "shared-model", contextWindow: 32768, maxOutputTokens: 4096 }],
});

test("供应商凭据仅在受限磁盘保存，更新保留凭据，重新创建后恢复对话选择", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "codex-web-providers-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const registry = createProviderRegistry(home);
  let list = await registry.set(fixture());
  assert.equal(JSON.stringify(list).includes("private-key"), false);
  assert.equal(list[1].hasApiKey, true);
  const { apiKey, ...changed } = fixture();
  await registry.set({ ...changed, name: "更名" });
  assert.equal((await registry.get("fixture")).apiKey, "private-key");
  await registry.remember("thread", {
    providerId: "fixture",
    model: "shared-model",
  });
  assert.deepEqual(await createProviderRegistry(home).selection("thread"), {
    providerId: "fixture",
    model: "shared-model",
  });
  const path = join(home, "codex-web/providers.json");
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.match(await readFile(path, "utf8"), /private-key/);
  await assert.rejects(
    registry.set({
      ...changed,
      models: [{ id: "bad", contextWindow: 4096, maxOutputTokens: 8192 }],
    }),
    /输出/,
  );
  await registry.remove("fixture");
  assert.equal((await registry.list()).length, 1);
  assert.deepEqual(await registry.selection("thread"), {
    providerId: "fixture",
    model: "shared-model",
  });
});

test("Chat 转换保留工具调用与返回、折叠系统消息、流式工具参数与命名空间，凭据分开传输", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "codex-web-gateway-"));
  const requests = [];
  const upstream = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    requests.push({
      path: request.url,
      authorization: request.headers.authorization,
      body: JSON.parse(raw),
    });
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const chunk of [
      {
        id: "chat1",
        choices: [
          {
            index: 0,
            delta: {
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: "call2",
                  type: "function",
                  function: { name: "functions__read", arguments: '{"p":' },
                },
              ],
            },
          },
        ],
      },
      {
        id: "chat1",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index: 0, function: { arguments: "1}" } }],
            },
            finish_reason: "tool_calls",
          },
        ],
      },
      {
        id: "chat1",
        choices: [],
        usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 },
      },
    ])
      response.write("data: " + JSON.stringify(chunk) + "\n\n");
    response.end("data: [DONE]\n\n");
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const registry = createProviderRegistry(home);
  await registry.set(fixture(`http://127.0.0.1:${upstream.address().port}/v1`));
  const gateway = createModelGateway(registry);
  await gateway.start();
  t.after(async () => {
    await gateway.close();
    await new Promise((resolve) => upstream.close(resolve));
    await rm(home, { recursive: true, force: true });
  });
  const url = gateway.url("fixture") + "/responses";
  assert.equal((await fetch(url, { method: "POST", body: "{}" })).status, 401);
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: "Bearer " + gateway.token },
    body: JSON.stringify({
      model: "shared-model",
      stream: true,
      instructions: "system",
      tools: [
        {
          type: "namespace",
          name: "functions",
          tools: [
            { type: "function", name: "read", parameters: { type: "object" } },
          ],
        },
      ],
      input: [
        {
          type: "message",
          role: "developer",
          content: [{ type: "input_text", text: "more system" }],
        },
        { type: "reasoning", encrypted_content: "opaque-secret" },
        {
          type: "function_call",
          namespace: "functions",
          name: "read",
          call_id: "call1",
          arguments: "{}",
        },
        { type: "function_call_output", call_id: "call1", output: "137" },
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "previous" }],
        },
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "continue" }],
        },
      ],
    }),
  });
  const stream = await response.text();
  assert.equal(response.status, 200);
  assert.match(stream, /response.completed/);
  const events = stream
    .split("\n")
    .filter((s) => s.startsWith("data: {"))
    .map((s) => JSON.parse(s.slice(6)));
  const call = events.find(
    (e) =>
      e.type === "response.output_item.done" && e.item.type === "function_call",
  ).item;
  assert.equal(call.name, "read");
  assert.equal(call.namespace, "functions");
  assert.equal(call.arguments, '{"p":1}');
  assert.equal(requests[0].path, "/v1/chat/completions");
  assert.equal(requests[0].authorization, "Bearer private-key");
  assert.equal(
    requests[0].body.messages.filter((m) => m.role === "system").length,
    1,
  );
  assert.equal(
    requests[0].body.messages.find((m) => m.role === "tool").tool_call_id,
    "call1",
  );
  assert.equal(JSON.stringify(requests).includes("opaque-secret"), false);
});

test("桥接在释放确认与 closed 后切换供应商，运行中拒绝切换并保留历史身份", async (t) => {
  const app = await bridge(t, (request, socket) => {
    if (request.method === "thread/unsubscribe") {
      socket.send(
        JSON.stringify({ id: request.id, result: { status: "unsubscribed" } }),
      );
      setTimeout(
        () =>
          socket.send(
            JSON.stringify({
              method: "thread/closed",
              params: { threadId: request.params.threadId },
            }),
          ),
        10,
      );
      return true;
    }
    if (request.method === "turn/start") {
      socket.send(
        JSON.stringify({
          id: request.id,
          result: { turn: { id: "turn", status: "inProgress" } },
        }),
      );
      return true;
    }
    return false;
  });
  const client = await app.connect();
  await app.rpc(client, "lan/providers/set", fixture());
  const { thread } = await app.rpc(client, "thread/start", {
    providerId: "codex",
    model: "gpt-6-luna",
  });
  await app.rpc(client, "turn/start", {
    threadId: thread.id,
    providerId: "fixture",
    model: "shared-model",
    input: [],
  });
  const resumed = app.requests.find((r) => r.method === "thread/resume");
  assert.equal(resumed.params.model, "shared-model");
  assert.match(resumed.params.modelProvider, /^codex_web_/);
  assert.ok(
    Object.keys(resumed.params.config).some((k) =>
      k.startsWith("model_providers."),
    ),
  );
  await assert.rejects(
    app.rpc(client, "turn/start", {
      threadId: thread.id,
      providerId: "codex",
      model: "gpt-6-luna",
      input: [],
    }),
    /当前任务结束/,
  );
});

test("多个第三方供应商的同名模型、地址与凭据独立，Responses 请求保持原生协议", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "codex-web-vendors-"));
  const requests = [];
  const upstream = createServer(async (request, response) => {
    let body = "";
    for await (const bytes of request) body += bytes;
    requests.push({
      path: request.url,
      key: request.headers.authorization,
      body: JSON.parse(body),
    });
    response
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify({ id: "response", status: "completed", output: [] }));
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const registry = createProviderRegistry(home);
  const base = `http://127.0.0.1:${upstream.address().port}`;
  await registry.set({
    ...fixture(base + "/vendor-a/v1"),
    id: "vendor-a",
    protocol: "responses",
    apiKey: "vendor-a-key",
  });
  await registry.set({
    ...fixture(base + "/vendor-b/v1"),
    id: "vendor-b",
    protocol: "responses",
    apiKey: "vendor-b-key",
  });
  const gateway = createModelGateway(registry);
  await gateway.start();
  t.after(async () => {
    await gateway.close();
    await new Promise((resolve) => upstream.close(resolve));
    await rm(home, { recursive: true, force: true });
  });
  const input = {
    model: "shared-model",
    input: [
      {
        type: "message",
        role: "user",
        content: "same model, distinct vendors",
      },
    ],
  };
  for (const id of ["vendor-a", "vendor-b"]) {
    const response = await fetch(gateway.url(id) + "/responses", {
      method: "POST",
      headers: { Authorization: "Bearer " + gateway.token },
      body: JSON.stringify(input),
    });
    assert.equal(response.status, 200);
  }
  assert.deepEqual(
    requests.map((r) => r.path),
    ["/vendor-a/v1/responses", "/vendor-b/v1/responses"],
  );
  assert.deepEqual(
    requests.map((r) => r.key),
    ["Bearer vendor-a-key", "Bearer vendor-b-key"],
  );
  assert.deepEqual(
    requests.map((r) => r.body),
    [input, input],
  );
  assert.equal(
    JSON.stringify(await registry.list()).includes("vendor-a-key"),
    false,
  );
});

test("对话列表默认包含所有供应商，显式筛选保持生效", async (t) => {
  const app = await bridge(t);
  const client = await app.connect();
  await app.rpc(client, "thread/list", { archived: false });
  assert.deepEqual(
    app.requests.find((r) => r.method === "thread/list").params.modelProviders,
    [],
  );
  await app.rpc(client, "thread/list", {
    modelProviders: ["configured-provider"],
  });
  assert.deepEqual(
    app.requests.filter((r) => r.method === "thread/list").at(-1).params
      .modelProviders,
    ["configured-provider"],
  );
});
