import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProviderRegistry } from "../src/providers/registry.mjs";
import { bridge } from "../../tests/helpers/bridge.mjs";

const fixture = (id = "fixture") => ({
  id,
  name: "示例供应商",
  baseUrl: "https://example.com/v1",
  protocol: "responses",
  apiKey: "private-key",
  models: [{ id: "shared-model", contextWindow: 32768, maxOutputTokens: 4096 }],
});

test("配置与凭据写入 Codex，网页只保存模型选项；原生外部修改优先", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "codex-web-providers-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const config = { model_providers: {} };
  const registry = createProviderRegistry(home);
  registry.connect(async (method, params) => {
    if (method === "config/read") return { config };
    assert.equal(method, "config/value/write");
    const id = params.keyPath.slice("model_providers.".length);
    if (params.value === null) delete config.model_providers[id];
    else config.model_providers[id] = params.value;
    return { status: "ok" };
  });
  const list = await registry.set(fixture());
  assert.equal(JSON.stringify(list).includes("private-key"), false);
  assert.equal(
    config.model_providers.fixture.experimental_bearer_token,
    "private-key",
  );
  assert.equal(config.model_providers.fixture.base_url, fixture().baseUrl);
  const { apiKey, ...edit } = fixture();
  await registry.set({ ...edit, name: "更名" });
  assert.equal(
    config.model_providers.fixture.experimental_bearer_token,
    "private-key",
  );
  config.model_providers.fixture.name = "Codex 外部修改";
  assert.equal((await registry.get("fixture")).name, "Codex 外部修改");
  const path = join(home, "codex-web/providers.json");
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal((await readFile(path, "utf8")).includes("private-key"), false);
  await assert.rejects(registry.set({ ...edit, id: "openai" }), /标识/);
  await registry.remove("fixture");
  assert.equal(config.model_providers.fixture, undefined);
  assert.equal((await registry.list()).length, 1);
});

test("Codex 中独立定义的同名模型保持身份、地址和凭据隔离", async (t) => {
  const app = await bridge(t);
  const client = await app.connect();
  await app.rpc(client, "lan/providers/set", fixture("first"));
  await app.rpc(client, "lan/providers/set", {
    ...fixture("second"),
    baseUrl: "https://second.example.com/v1",
    apiKey: "second-key",
  });
  const { providers } = await app.rpc(client, "lan/providers/read");
  assert.equal(providers.length, 3);
  assert.equal(providers[1].models[0].id, providers[2].models[0].id);
  assert.equal(JSON.stringify(providers).includes("second-key"), false);
  assert.equal(
    app.nativeConfig.model_providers.first.base_url,
    "https://example.com/v1",
  );
  assert.equal(
    app.nativeConfig.model_providers.second.base_url,
    "https://second.example.com/v1",
  );
});

test("切换供应商等待 Codex 释放，使用配置中的真实身份，运行中拒绝再次切换", async (t) => {
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
    model: "gpt-model",
  });
  await app.rpc(client, "turn/start", {
    threadId: thread.id,
    providerId: "fixture",
    model: "shared-model",
    input: [],
  });
  const resumed = app.requests.find((r) => r.method === "thread/resume");
  assert.equal(resumed.params.modelProvider, "fixture");
  assert.equal(resumed.params.model, "shared-model");
  assert.equal(
    Object.keys(resumed.params.config).some((k) =>
      k.startsWith("model_providers."),
    ),
    false,
  );
  await assert.rejects(
    app.rpc(client, "turn/start", {
      threadId: thread.id,
      providerId: "codex",
      model: "gpt-model",
      input: [],
    }),
    /当前任务结束/,
  );
});

test("对话列表包含 Codex 的全部供应商，显式筛选继续生效", async (t) => {
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
