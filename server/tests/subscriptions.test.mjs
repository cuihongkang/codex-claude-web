import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { bridge, waitFor, close } from "../../tests/helpers/bridge.mjs";
import { MAX_RPC_MESSAGE_BYTES } from "../src/rpc-transport.mjs";
test("首次提交期间后端断连时返回错误并记录关闭码与请求方法", async (t) => {
  const app = await bridge(t, (request) => request.method === "turn/start");
  const client = await app.connect();
  const { thread } = await app.rpc(client, "thread/start");
  const text = "仅用于测试的首条文字消息";
  const failed = assert.rejects(
    app.rpc(client, "turn/start", {
      threadId: thread.id,
      input: [{ type: "text", text }],
    }),
    /Codex 后端连接中断，请重试/,
  );
  await waitFor(() =>
    app.requests.some((request) => request.method === "turn/start"),
  );
  app.disconnect();
  await failed;
  const record = await waitFor(() =>
    app.logs().match(/App-server disconnected: (\{[^\n]+\})/),
  );
  assert.deepEqual(JSON.parse(record[1]), {
    code: 1006,
    reason: "",
    pendingMethods: ["turn/start"],
  });
  assert.equal(app.logs().includes(text), false);
});

test("超出整条消息上限时保留后端连接及其他页面的发送能力", async (t) => {
  const app = await bridge(t);
  const first = await app.connect();
  const second = await app.connect();
  await assert.rejects(
    app.rpc(first, "turn/start", {
      threadId: "oversized-image",
      input: [{ type: "image", url: "a".repeat(MAX_RPC_MESSAGE_BYTES) }],
    }),
    /单次消息过大.*64 MiB/,
  );
  assert.equal(
    app.requests.some((request) => request.method === "turn/start"),
    false,
  );
  await app.rpc(first, "test/after-oversized-message");
  await app.rpc(second, "test/other-page-still-connected");
  assert.equal(app.logs().includes("App-server disconnected"), false);
});

for (const method of ["thread/start", "thread/resume", "thread/fork"]) {
  test(
    `${method} 在页面保持打开时释放已持久化的空闲对话`,
    { timeout: 10000 },
    async (t) => {
      const app = await bridge(t);
      const client = await app.connect();
      const { thread } = await app.rpc(client, method, {
        threadId: "source",
        config: { model: "fixture-model", thread_unload_delay_secs: 1800 },
      });
      const { "mcp_servers.claudex_references": referenceTool, ...config } =
        app.requests.find((request) => request.method === method).params.config;
      assert.deepEqual(config, {
        model: "fixture-model",
        thread_unload_delay_secs: 0,
      });
      assert.equal(referenceTool.command, process.execPath);
      assert(
        referenceTool.args[0].endsWith("/backends/codex/reference-mcp.mjs"),
      );
      assert.match(
        referenceTool.env.CLAUDEX_REFERENCE_UPSTREAM,
        /^ws:\/\/127\.0\.0\.1:\d+\/?$/,
      );
      assert.equal(referenceTool.enabled, true);
      if (method === "thread/start") {
        assert.equal(app.unsubscribed().length, 0);
        await app.rpc(client, "turn/start", { threadId: thread.id, input: [] });
      }
      const [request] = await waitFor(
        () => app.unsubscribed().length && app.unsubscribed(),
      );
      assert.deepEqual(request.params, { threadId: thread.id });
      await close(client);
      assert.equal(app.unsubscribed().length, 1);
    },
  );

  test(
    `${method} 响应晚于页面关闭时仍释放对话`,
    { timeout: 10000 },
    async (t) => {
      const app = await bridge(t, (request) => request.method === method);
      const client = await app.connect();
      client.send(
        JSON.stringify({ id: 1, method, params: { threadId: "source" } }),
      );
      const request = await waitFor(() =>
        app.requests.find((request) => request.method === method),
      );
      await close(client);
      app.respond(request, {
        thread: { id: "late-thread", status: { type: "idle" } },
      });
      await waitFor(() => app.unsubscribed().length);
      assert.deepEqual(app.unsubscribed()[0].params, {
        threadId: "late-thread",
      });
    },
  );
}

test(
  "多个页面共享运行中的对话，完成后在页面保持打开时释放",
  { timeout: 10000 },
  async (t) => {
    const app = await bridge(t, (request, upstream) => {
      if (request.method !== "thread/resume") return false;
      upstream.send(
        JSON.stringify({
          id: request.id,
          result: {
            thread: {
              id: "shared",
              status: { type: "active", activeFlags: [] },
            },
          },
        }),
      );
      return true;
    });
    const first = await app.connect(),
      second = await app.connect();
    await app.rpc(first, "thread/resume", { threadId: "shared" });
    await app.rpc(second, "thread/resume", { threadId: "shared" });
    await app.rpc(first, "thread/unsubscribe", { threadId: "shared" });
    assert.equal(app.unsubscribed().length, 0);
    await close(first);
    await app.rpc(second, "test/barrier");
    assert.equal(app.unsubscribed().length, 0);
    app.notify("thread/status/changed", {
      threadId: "shared",
      status: { type: "idle" },
    });
    await waitFor(() => app.unsubscribed().length === 1);
    await close(second);
    assert.equal(app.unsubscribed().length, 1);
  },
);

test(
  "页面关闭后任务继续，轮次完成时自动释放",
  { timeout: 10000 },
  async (t) => {
    const app = await bridge(t, (request, upstream) => {
      if (request.method !== "turn/start") return false;
      upstream.send(
        JSON.stringify({
          id: request.id,
          result: {
            turn: { id: "turn", status: "inProgress" },
          },
        }),
      );
      return true;
    });
    const client = await app.connect(),
      observer = await app.connect();
    await app.rpc(client, "turn/start", { threadId: "running", input: [] });
    await app.rpc(client, "test/barrier");
    await close(client);
    app.notify("thread/status/changed", {
      threadId: "running",
      status: { type: "idle" },
    });
    await app.rpc(observer, "test/barrier");
    assert.equal(app.unsubscribed().length, 0);
    app.notify("turn/completed", {
      threadId: "running",
      turn: { id: "turn", status: "completed" },
    });
    await waitFor(() => app.unsubscribed().length);
    assert.deepEqual(app.unsubscribed()[0].params, { threadId: "running" });
  },
);

test(
  "取消订阅期间重新打开对话，确认响应后继续等待原生关闭再恢复",
  { timeout: 10000 },
  async (t) => {
    const app = await bridge(
      t,
      (request) => request.method === "thread/unsubscribe",
    );
    const first = await app.connect(),
      second = await app.connect();
    await app.rpc(first, "thread/resume", { threadId: "reopen" });
    await close(first);
    const request = await waitFor(() => app.unsubscribed()[0]);
    const reopened = app.rpc(second, "thread/resume", { threadId: "reopen" });
    await delay(30);
    assert.equal(
      app.requests.filter((request) => request.method === "thread/resume")
        .length,
      1,
    );
    app.respond(request, { status: "unsubscribed" }, { closed: false });
    await app.rpc(second, "test/barrier");
    assert.equal(
      app.requests.filter((request) => request.method === "thread/resume")
        .length,
      1,
      "取消订阅响应尚未确认原生会话结束",
    );
    app.notify("thread/closed", { threadId: "reopen" });
    await reopened;
    await close(second);
    await waitFor(() => app.unsubscribed().length === 2);
  },
);

test(
  "发送请求尚未返回时关闭页面，保留任务直到完成",
  { timeout: 10000 },
  async (t) => {
    const app = await bridge(t, (request) => request.method === "turn/start");
    const client = await app.connect(),
      observer = await app.connect();
    client.send(
      JSON.stringify({
        id: 99,
        method: "turn/start",
        params: { threadId: "starting", input: [] },
      }),
    );
    const request = await waitFor(() =>
      app.requests.find((request) => request.method === "turn/start"),
    );
    await close(client);
    await app.rpc(observer, "test/barrier");
    assert.equal(app.unsubscribed().length, 0);
    app.respond(request, { turn: { id: "new-turn", status: "inProgress" } });
    await app.rpc(observer, "test/barrier");
    assert.equal(app.unsubscribed().length, 0);
    app.notify("turn/completed", {
      threadId: "starting",
      turn: { id: "new-turn", status: "completed" },
    });
    await waitFor(() => app.unsubscribed().length);
  },
);

test(
  "恢复已运行的对话后断连，等待空闲状态再释放",
  { timeout: 10000 },
  async (t) => {
    const app = await bridge(t, (request, upstream) => {
      if (request.method !== "thread/resume") return false;
      upstream.send(
        JSON.stringify({
          id: request.id,
          result: {
            thread: {
              id: "resumed-active",
              status: { type: "active", activeFlags: [] },
            },
          },
        }),
      );
      return true;
    });
    const client = await app.connect(),
      observer = await app.connect();
    await app.rpc(client, "thread/resume", { threadId: "resumed-active" });
    await close(client);
    await app.rpc(observer, "test/barrier");
    assert.equal(app.unsubscribed().length, 0);
    app.notify("thread/status/changed", {
      threadId: "resumed-active",
      status: { type: "idle" },
    });
    await waitFor(() => app.unsubscribed().length);
  },
);

test("恢复失败的对话保持原订阅状态", { timeout: 10000 }, async (t) => {
  const app = await bridge(t, (request, upstream) => {
    if (request.method !== "thread/resume") return false;
    upstream.send(
      JSON.stringify({
        id: request.id,
        error: { code: -32000, message: "fixture conflict" },
      }),
    );
    return true;
  });
  const client = await app.connect(),
    observer = await app.connect();
  await assert.rejects(
    app.rpc(client, "thread/resume", { threadId: "failed" }),
    /fixture conflict/,
  );
  await close(client);
  await app.rpc(observer, "test/barrier");
  assert.equal(app.unsubscribed().length, 0);
});

test(
  "新建空对话在首次发送失败后保留，成功发送后释放",
  { timeout: 10000 },
  async (t) => {
    let fails = true;
    const app = await bridge(t, (request, upstream) => {
      if (request.method !== "turn/start" || !fails) return false;
      upstream.send(
        JSON.stringify({
          id: request.id,
          error: { code: -32000, message: "fixture send failure" },
        }),
      );
      return true;
    });
    const client = await app.connect();
    const { thread } = await app.rpc(client, "thread/start");
    await assert.rejects(
      app.rpc(client, "turn/start", { threadId: thread.id }),
      /fixture send failure/,
    );
    assert.equal(app.unsubscribed().length, 0);
    fails = false;
    await app.rpc(client, "turn/start", { threadId: thread.id });
    await waitFor(() => app.unsubscribed().length);
    assert.equal(
      app.requests.filter((request) => request.method === "thread/resume")
        .length,
      0,
    );
  },
);

test("后端重连后恢复空闲对话仍即时释放", { timeout: 10000 }, async (t) => {
  let upstream;
  const app = await bridge(t, (request, socket) => {
    upstream = socket;
    return false;
  });
  const client = await app.connect();
  await app.rpc(client, "thread/resume", { threadId: "reconnected" });
  const reconnected = new Promise((resolve) =>
    client.on("message", (bytes) => {
      const message = JSON.parse(bytes);
      if (message.method === "lan/state" && message.params.ready) resolve();
    }),
  );
  upstream.close();
  await reconnected;
  await app.rpc(client, "thread/resume", { threadId: "reconnected" });
  await close(client);
  await waitFor(() => app.unsubscribed().length);
  assert.equal(app.unsubscribed().length, 2);
});

test(
  "断网由心跳识别，运行任务完成后释放订阅",
  { timeout: 75000 },
  async (t) => {
    const app = await bridge(t, (request, upstream) => {
      if (request.method !== "turn/start") return false;
      upstream.send(
        JSON.stringify({
          id: request.id,
          result: {
            turn: { id: "offline-turn", status: "inProgress" },
          },
        }),
      );
      return true;
    });
    const client = await app.connect();
    await app.rpc(client, "turn/start", { threadId: "offline", input: [] });
    client.pong = () => {};
    await once(client, "close");
    assert.equal(app.unsubscribed().length, 0);
    app.notify("turn/completed", {
      threadId: "offline",
      turn: { id: "offline-turn", status: "completed" },
    });
    await waitFor(() => app.unsubscribed().length);
    assert.deepEqual(app.unsubscribed()[0].params, { threadId: "offline" });
  },
);
