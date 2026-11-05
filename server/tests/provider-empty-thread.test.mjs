import test from "node:test";
import assert from "node:assert/strict";
import { bridge } from "../../tests/helpers/bridge.mjs";
import { createPortableHistory } from "../src/providers/portable-history.mjs";

test("原生供应商新对话首轮跳过尚未落盘的历史并实际提交，后续发送继续检查历史", async (t) => {
  let materialized = false;
  let readError = "模拟历史连接错误";
  const app = await bridge(t, (request, socket) => {
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
    if (request.method === "thread/turns/list") {
      socket.send(
        JSON.stringify({
          id: request.id,
          ...(readError
            ? { error: { code: -32000, message: readError } }
            : materialized
              ? { result: { data: [], nextCursor: null } }
              : {
                  error: {
                    code: -32600,
                    message: `thread ${request.params.threadId} is not materialized yet; thread/turns/list is unavailable before first user message`,
                  },
                }),
        }),
      );
      return true;
    }
    if (request.method === "turn/start") {
      materialized = true;
      socket.send(
        JSON.stringify({
          id: request.id,
          result: { turn: { id: "first-turn", status: "completed" } },
        }),
      );
      return true;
    }
    return false;
  });
  const client = await app.connect();
  const { thread } = await app.rpc(client, "thread/start", {
    providerId: "codex",
    model: "native-model",
  });
  const params = {
    threadId: thread.id,
    providerId: "codex",
    model: "native-model",
    input: [],
  };
  await assert.rejects(
    app.rpc(client, "turn/start", params),
    /模拟历史连接错误/,
  );
  assert.equal(
    app.requests.some((request) => request.method === "turn/start"),
    false,
  );
  readError = null;
  const result = await app.rpc(client, "turn/start", params);
  assert.equal(result.turn.id, "first-turn");
  await app.rpc(client, "turn/start", params);
  assert.equal(
    app.requests.filter((request) => request.method === "turn/start").length,
    2,
  );
  assert.equal(
    app.requests.filter((request) => request.method === "thread/turns/list")
      .length,
    3,
  );
  assert.equal(
    app.requests.some((request) => request.method === "thread/compact/start"),
    false,
  );
});

test("空对话切换到 GPT 或第三方供应商时直接完成历史准备", async () => {
  for (const [source, target] of [
    ["custom", "codex"],
    ["codex", "custom"],
    ["codex", "codex"],
  ]) {
    const calls = [];
    const history = createPortableHistory({
      transport: {
        async call(method, params) {
          calls.push({ method, params });
          throw new Error(
            `thread ${params.threadId} is not materialized yet; thread/turns/list is unavailable before first user message`,
          );
        },
      },
    });
    await history.prepare(
      "empty-thread",
      { providerId: source },
      { providerId: target },
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "thread/turns/list");
  }
});

test("历史准备保留真实错误、其他对话错误及后续分页异常，失败后可重试", async () => {
  const empty = (id) =>
    new Error(
      `thread ${id} is not materialized yet; thread/turns/list is unavailable before first user message`,
    );
  for (const { error, paginate } of [
    { error: new Error("连接已断开") },
    { error: new Error("permission denied") },
    { error: empty("other-thread") },
    { error: new Error("thread empty-thread not found") },
    { error: empty("empty-thread"), paginate: true },
  ]) {
    let failed = true;
    const calls = [];
    const history = createPortableHistory({
      transport: {
        async call(method, params) {
          calls.push({ method, params });
          if (failed) {
            if (paginate && !params.cursor)
              return {
                data: [{ id: "saved-turn", items: [] }],
                nextCursor: "older",
              };
            throw error;
          }
          return { data: [], nextCursor: null };
        },
      },
    });
    const prepare = () =>
      history.prepare(
        "empty-thread",
        { providerId: "codex" },
        { providerId: "codex" },
      );
    await assert.rejects(prepare(), (caught) => caught === error);
    assert.equal(calls.length, paginate ? 2 : 1);
    if (paginate) assert.equal(calls[1].params.cursor, "older");
    failed = false;
    await prepare();
  }
});
