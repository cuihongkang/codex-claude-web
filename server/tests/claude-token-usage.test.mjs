import test from "node:test";
import assert from "node:assert/strict";
import {
  createTokenUsage,
  configuredTokenUsage,
} from "../src/backends/claude/token-usage.mjs";
import { providerRuntimeEnvironment } from "../src/backends/claude/provider-environment.mjs";

test("历史读取采用所属供应商模型的实际配置容量，原生账户保持原生快照", () => {
  const session = {
    model: "custom",
    tokenUsage: { last: { totalTokens: 43938 }, modelContextWindow: 200000 },
  };
  const provider = {
    modelCapabilities: {
      custom: { contextWindow: 196608 },
      other: { contextWindow: 32768 },
    },
  };
  assert.equal(
    configuredTokenUsage(session, provider).modelContextWindow,
    196608,
  );
  assert.equal(
    configuredTokenUsage({ ...session, model: "other" }, provider)
      .modelContextWindow,
    32768,
  );
  assert.equal(configuredTokenUsage(session, null).modelContextWindow, 200000);
  assert.equal(configuredTokenUsage(session, provider).last.totalTokens, 43938);
  assert.equal(session.tokenUsage.modelContextWindow, 200000);
});

test("首次原生assistant用量即展示当前模型容量，恢复和模型切换重新查询", async () => {
  let session = {
    model: "old",
    tokenUsage: { modelContextWindow: 200000 },
  };
  const events = [];
  const usage = createTokenUsage({
    threadId: "thread",
    session,
    save: async (_id, update) => {
      session = update(session);
    },
    emit: (_method, event) => events.push(event),
  });
  let capacity = 196608,
    calls = 0;
  const process = {
    model: "custom",
    query: {
      getContextUsage: async (params) => {
        assert.deepEqual(params, { detail: "summary" });
        calls++;
        return { rawMaxTokens: capacity, totalTokens: 45000 };
      },
    },
  };
  const message = {
    type: "assistant",
    message: { usage: { input_tokens: 43938 } },
  };
  await usage(
    {
      type: "stream_event",
      event: { type: "message_start", message: message.message },
    },
    process,
  );
  assert.equal(session.tokenUsage.modelContextWindow, 196608);
  assert.equal(session.tokenUsage.last.totalTokens, 43938);
  await usage(message, process);
  assert.equal(calls, 1);
  process.model = "different";
  capacity = 32768;
  await usage(message, process);
  assert.equal(session.tokenUsage.modelContextWindow, 32768);
  assert.equal(calls, 2);
  await usage(
    { type: "result", modelUsage: { different: { contextWindow: 32768 } } },
    process,
  );
  assert.equal(session.tokenUsage.last.totalTokens, 45000);
  assert.equal(events.at(-1).tokenUsage.modelContextWindow, 32768);
});

test("原生容量读取失败清除旧模型容量，保留实际用量与读取错误", async () => {
  let session = { tokenUsage: { modelContextWindow: 200000 } };
  const usage = createTokenUsage({
    threadId: "thread",
    session,
    save: async (_id, update) => {
      session = update(session);
    },
    emit() {},
  });
  await usage(
    { type: "assistant", message: { usage: { input_tokens: 20 } } },
    {
      model: "custom",
      query: {
        getContextUsage: async () => {
          throw Error("context unavailable");
        },
      },
    },
  );
  assert.equal(session.tokenUsage.modelContextWindow, undefined);
  assert.equal(session.tokenUsage.last.totalTokens, 20);
  assert.equal(session.tokenUsage.error, "context unavailable");
});

test("模型实际容量配置传给原生CLI，其他模型清除覆盖而原生账户保留环境", () => {
  const provider = {
    models: ["custom"],
    modelCapabilities: { custom: { contextWindow: 196608 } },
  };
  assert.equal(
    providerRuntimeEnvironment(provider, { dataDir: "/isolated" })
      .CLAUDE_CODE_MAX_CONTEXT_TOKENS,
    "196608",
  );
  assert.equal(
    providerRuntimeEnvironment(
      provider,
      { dataDir: "/isolated" },
      { model: "other" },
    ).CLAUDE_CODE_MAX_CONTEXT_TOKENS,
    "",
  );
  assert.equal(
    providerRuntimeEnvironment(null, { dataDir: "/isolated" })
      .CLAUDE_CODE_MAX_CONTEXT_TOKENS,
    process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS,
  );
});
