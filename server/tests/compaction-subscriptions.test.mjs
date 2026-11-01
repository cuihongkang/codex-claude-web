import test from "node:test";
import assert from "node:assert/strict";

import { bridge, waitFor } from "../../tests/helpers/bridge.mjs";

test(
  "整理请求确认后保留订阅并阻止写入，完成后恢复发送",
  { timeout: 10000 },
  async (t) => {
    const app = await bridge(t);
    const first = await app.connect();
    const threadId = "compact-lifecycle";
    await app.rpc(first, "thread/compact/start", { threadId });
    await app.rpc(first, "test/barrier");
    assert.equal(app.unsubscribed().length, 0);
    const second = await app.connect();
    assert.equal(second.initialState.compactions[threadId].status, "starting");
    for (const method of [
      "thread/compact/start",
      "turn/start",
      "turn/steer",
      "review/start",
    ])
      await assert.rejects(
        app.rpc(second, method, { threadId }),
        /正在整理上下文/,
      );
    assert.equal(
      app.requests.filter((r) => r.method === "thread/compact/start").length,
      1,
    );
    await app.rpc(second, "turn/start", { threadId: "other-chat" });
    app.notify("turn/completed", {
      threadId: "other-chat",
      turn: { id: "unrelated", status: "completed" },
    });
    app.notify("turn/started", {
      threadId,
      turn: { id: "compact-turn", status: "inProgress" },
    });
    app.notify("item/started", {
      threadId,
      turnId: "compact-turn",
      item: { id: "compact-item", type: "contextCompaction" },
    });
    app.notify("item/completed", {
      threadId,
      turnId: "compact-turn",
      item: { id: "compact-item", type: "contextCompaction" },
    });
    await app.rpc(first, "test/barrier");
    assert.equal(
      app.unsubscribed().some((r) => r.params.threadId === threadId),
      false,
    );
    app.notify("turn/completed", {
      threadId,
      turn: { id: "compact-turn", status: "completed" },
    });
    await waitFor(() =>
      app.unsubscribed().some((r) => r.params.threadId === threadId),
    );
    const finished = await app.rpc(first, "lan/compaction/check", { threadId });
    assert.equal(finished.compaction.status, "completed");
    await app.rpc(first, "turn/start", { threadId });
  },
);

test("整理完成事件先于请求确认时保留完成结果", async (t) => {
  const app = await bridge(t, (r) => r.method === "thread/compact/start");
  const client = await app.connect();
  const threadId = "compact-before-ack";
  const result = app.rpc(client, "thread/compact/start", { threadId });
  const request = await waitFor(() =>
    app.requests.find((r) => r.method === "thread/compact/start"),
  );
  app.notify("turn/started", {
    threadId,
    turn: { id: "early", status: "inProgress" },
  });
  app.notify("turn/completed", {
    threadId,
    turn: { id: "early", status: "completed" },
  });
  await app.rpc(client, "test/barrier");
  assert.equal(app.unsubscribed().length, 0);
  app.respond(request, {});
  await result;
  await waitFor(() => app.unsubscribed().length);
  assert.equal(
    (await app.rpc(client, "lan/compaction/check", { threadId })).compaction
      .status,
    "completed",
  );
});

for (const status of ["failed", "interrupted"]) {
  test(`整理轮次${status}时显示实际结果并释放订阅`, async (t) => {
    const app = await bridge(t);
    const client = await app.connect();
    const threadId = "compact-" + status;
    await app.rpc(client, "thread/compact/start", { threadId });
    app.notify("turn/started", {
      threadId,
      turn: { id: "ending", status: "inProgress" },
    });
    app.notify("turn/completed", {
      threadId,
      turn: {
        id: "ending",
        status,
        error: status === "failed" ? { message: "模拟整理失败" } : null,
      },
    });
    await waitFor(() => app.unsubscribed().length);
    assert.equal(
      (await app.rpc(client, "lan/compaction/check", { threadId })).compaction
        .status,
      status,
    );
  });
}

test("整理提交失败时清除占用并保留错误", async (t) => {
  const app = await bridge(t, (request, upstream) => {
    if (request.method !== "thread/compact/start") return false;
    upstream.send(
      JSON.stringify({
        id: request.id,
        error: { code: -32000, message: "模拟整理提交失败" },
      }),
    );
    return true;
  });
  const client = await app.connect();
  const threadId = "compact-rejected";
  await assert.rejects(
    app.rpc(client, "thread/compact/start", { threadId }),
    /模拟整理提交失败/,
  );
  await waitFor(() => app.unsubscribed().length);
  const { compaction } = await app.rpc(client, "lan/compaction/check", {
    threadId,
  });
  assert.equal(compaction.status, "failed");
  assert.equal(compaction.error, "模拟整理提交失败");
  await app.rpc(client, "turn/start", { threadId });
});

test("恢复整理时排除后续普通任务，解除遗留整理占用", async (t) => {
  const app = await bridge(t, (request, upstream) => {
    if (!["thread/read", "thread/turns/list"].includes(request.method))
      return false;
    const result =
      request.method === "thread/read"
        ? {
            thread: { id: request.params.threadId, status: { type: "active" } },
          }
        : {
            data: [
              {
                id: "ordinary-task",
                status: "inProgress",
                startedAt: Date.now() / 1000,
                items: [{ type: "userMessage" }, { type: "contextCompaction" }],
              },
            ],
            nextCursor: null,
          };
    upstream.send(JSON.stringify({ id: request.id, result }));
    return true;
  });
  const client = await app.connect();
  const threadId = "compact-orphan-fixture";
  await app.rpc(client, "thread/compact/start", { threadId });
  app.notify("thread/closed", { threadId });
  await app.rpc(client, "test/barrier");
  const { compaction } = await app.rpc(client, "lan/compaction/check", {
    threadId,
  });
  assert.equal(compaction.status, "unconfirmed");
  assert.equal(compaction.turnId, undefined);
  const second = await app.connect();
  assert.equal(second.initialState.compactions[threadId].status, "unconfirmed");
  await app.rpc(second, "turn/steer", {
    threadId,
    expectedTurnId: "ordinary-task",
    input: [],
  });
});

test(
  "整理时重连读取真实分页结果，旧轮次不会解除新整理占用",
  { timeout: 10000 },
  async (t) => {
    let finished = false;
    const app = await bridge(t, (request, upstream) => {
      if (request.method === "thread/read") {
        upstream.send(
          JSON.stringify({
            id: request.id,
            result: {
              thread: {
                id: request.params.threadId,
                status: { type: finished ? "idle" : "active" },
              },
            },
          }),
        );
        return true;
      }
      if (request.method !== "thread/turns/list") return false;
      const page = request.params.cursor
        ? {
            data: [
              {
                id: "recovered",
                status: finished ? "completed" : "inProgress",
                startedAt: Date.now() / 1000,
                items: [{ id: "compact-item", type: "contextCompaction" }],
              },
            ],
            nextCursor: null,
          }
        : {
            data: [{ id: "unrelated-old", status: "completed", startedAt: 1 }],
            nextCursor: "next",
          };
      upstream.send(JSON.stringify({ id: request.id, result: page }));
      return true;
    });
    const client = await app.connect();
    const threadId = "compact-reconnect";
    await app.rpc(client, "thread/compact/start", { threadId });
    app.notify("turn/started", {
      threadId,
      turn: { id: "recovered", status: "inProgress" },
    });
    await app.rpc(client, "test/barrier");
    const reconnected = new Promise((resolve) => {
      function receive(bytes) {
        const message = JSON.parse(bytes);
        if (message.method === "lan/state" && message.params.ready) {
          client.off("message", receive);
          resolve();
        }
      }
      client.on("message", receive);
    });
    app.disconnect();
    await reconnected;
    const second = await app.connect();
    const running = await app.rpc(second, "lan/compaction/check", { threadId });
    assert.equal(running.compaction.status, "running");
    assert(
      app.requests.some(
        (r) => r.method === "thread/turns/list" && r.params.cursor === "next",
      ),
    );
    app.notify("turn/completed", {
      threadId,
      turn: { id: "unrelated-old", status: "completed" },
    });
    await app.rpc(second, "test/barrier");
    await assert.rejects(
      app.rpc(second, "turn/start", { threadId }),
      /正在整理上下文/,
    );
    finished = true;
    const completed = await app.rpc(second, "lan/compaction/check", {
      threadId,
    });
    assert.equal(completed.compaction.status, "completed");
    await waitFor(() =>
      app.unsubscribed().some((r) => r.params.threadId === threadId),
    );
  },
);
