import test from "node:test";
import assert from "node:assert/strict";
import { bridge } from "../../tests/helpers/bridge.mjs";

for (const configuredProvider of [undefined, "user-configured-provider"]) {
  test(`原生供应商沿用 Codex 配置 ${configuredProvider || "openai"}，保留认证、传输及整理策略`, async (t) => {
    const app = await bridge(t, (request, socket) => {
      if (request.method !== "config/read") return false;
      socket.send(
        JSON.stringify({
          id: request.id,
          result: {
            config: {
              ...(configuredProvider && { model_provider: configuredProvider }),
              model_providers: {
                [configuredProvider || "openai"]: {
                  name: "User provider",
                  base_url: "https://provider.example.test/v1",
                  requires_openai_auth: true,
                  supports_websockets: true,
                  capabilities: { remote_compaction: "supported" },
                },
              },
            },
          },
        }),
      );
      return true;
    });
    const client = await app.connect();
    await app.rpc(client, "thread/start", {
      providerId: "codex",
      model: "gpt-model",
    });
    const request = app.requests.find((r) => r.method === "thread/start");
    assert.equal(request.params.modelProvider, configuredProvider || "openai");
    assert.deepEqual(request.params.config, { thread_unload_delay_secs: 0 });
    assert.equal(
      app.requests.some(
        (r) =>
          r.method === "config/value/write" || r.method === "config/batchWrite",
      ),
      false,
    );
    assert.equal(JSON.stringify(request).includes("codex_web_default"), false);
  });
}

test("原生配置在账户变化后重新读取，保留 Codex 当前供应商身份", async (t) => {
  let provider = "first";
  const app = await bridge(t, (request, socket) => {
    if (request.method !== "config/read") return false;
    socket.send(
      JSON.stringify({
        id: request.id,
        result: { config: { model_provider: provider } },
      }),
    );
    return true;
  });
  const client = await app.connect();
  await app.rpc(client, "thread/start", {
    providerId: "codex",
    model: "model",
  });
  provider = "second";
  app.notify("account/updated", { authMode: "chatgpt" });
  await app.rpc(client, "thread/start", {
    providerId: "codex",
    model: "model",
  });
  assert.deepEqual(
    app.requests
      .filter((r) => r.method === "thread/start")
      .map((r) => r.params.modelProvider),
    ["first", "second"],
  );
});

test("其他端修改模型后，恢复使用 Codex 当前模型，清除网页旧选择的影响", async (t) => {
  let id;
  const app = await bridge(t, (request, socket) => {
    if (request.method === "thread/read") {
      socket.send(
        JSON.stringify({
          id: request.id,
          result: {
            thread: {
              id,
              modelProvider: "openai",
              model: "native-current-model",
            },
          },
        }),
      );
      return true;
    }
    if (request.method === "thread/unsubscribe") {
      socket.send(
        JSON.stringify({ id: request.id, result: { status: "unsubscribed" } }),
      );
      socket.send(
        JSON.stringify({
          method: "thread/closed",
          params: { threadId: request.params.threadId },
        }),
      );
      return true;
    }
    return false;
  });
  const client = await app.connect();
  const result = await app.rpc(client, "thread/start", {
    providerId: "codex",
    model: "web-old-model",
  });
  id = result.thread.id;
  await app.rpc(client, "thread/resume", { threadId: id });
  assert.equal(
    app.requests.filter((request) => request.method === "thread/resume").at(-1)
      .params.model,
    "native-current-model",
  );
});
