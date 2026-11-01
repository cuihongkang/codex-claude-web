import test from "node:test";
import assert from "node:assert/strict";

import { bridge, waitFor } from "../../tests/helpers/bridge.mjs";

for (const method of [
  "turn/start",
  "review/start",
  "thread/goal/get",
  "thread/goal/set",
  "thread/goal/clear",
  "thread/backgroundTerminals/list",
  "thread/backgroundTerminals/clean",
]) {
  test(
    `${method} 在写入前恢复空闲对话，请求完成后释放`,
    { timeout: 10000 },
    async (t) => {
      const app = await bridge(t, (request) => request.method === method);
      const client = await app.connect();
      const result = app.rpc(client, method, {
        threadId: "write-thread",
        input: [],
      });
      const write = await waitFor(() =>
        app.requests.find((request) => request.method === method),
      );
      const resume = app.requests.find(
        (request) => request.method === "thread/resume",
      );
      assert.equal(resume.params.threadId, "write-thread");
      assert.equal(resume.params.approvalPolicy, "never");
      assert.equal(resume.params.sandbox, "danger-full-access");
      assert.equal(app.unsubscribed().length, 0);
      app.respond(write, {});
      await result;
      await waitFor(() => app.unsubscribed().length);
      await app.rpc(client, "test/barrier");
      assert.equal(app.unsubscribed().length, 1);
    },
  );
}

test(
  "另一端持有写入权时保留错误且不发送轮次，释放后可重试",
  { timeout: 10000 },
  async (t) => {
    let locked = true;
    const app = await bridge(t, (request, upstream) => {
      if (request.method !== "thread/resume" || !locked) return false;
      upstream.send(
        JSON.stringify({
          id: request.id,
          error: {
            code: -32000,
            message: "thread fixture already has an active writer",
          },
        }),
      );
      return true;
    });
    const client = await app.connect();
    await assert.rejects(
      app.rpc(client, "turn/start", { threadId: "locked" }),
      /active writer/,
    );
    assert.equal(
      app.requests.filter((request) => request.method === "turn/start").length,
      0,
    );
    assert.equal(app.unsubscribed().length, 0);
    locked = false;
    await app.rpc(client, "turn/start", { threadId: "locked" });
    assert.equal(
      app.requests.filter((request) => request.method === "turn/start").length,
      1,
    );
    await waitFor(() => app.unsubscribed().length);
  },
);

test(
  "并发写入同一空闲对话共用恢复请求，恢复期间保留写入权",
  { timeout: 10000 },
  async (t) => {
    const app = await bridge(
      t,
      (request) =>
        request.method === "thread/resume" || request.method === "turn/start",
    );
    const first = await app.connect(),
      second = await app.connect();
    const writes = [
      app.rpc(first, "turn/start", { threadId: "concurrent" }),
      app.rpc(second, "turn/start", { threadId: "concurrent" }),
    ];
    const resume = await waitFor(() =>
      app.requests.find((request) => request.method === "thread/resume"),
    );
    await app.rpc(first, "test/barrier");
    await app.rpc(second, "test/barrier");
    assert.equal(
      app.requests.filter((request) => request.method === "thread/resume")
        .length,
      1,
    );
    app.respond(resume, {
      thread: { id: "concurrent", status: { type: "idle" } },
    });
    const requests = await waitFor(() => {
      const requests = app.requests.filter(
        (request) => request.method === "turn/start",
      );
      return requests.length === 2 && requests;
    });
    assert.equal(app.unsubscribed().length, 0);
    for (const request of requests) app.respond(request, {});
    await Promise.all(writes);
    await waitFor(() => app.unsubscribed().length);
  },
);

test("目标与后台终端查询保留新建空对话，实际开始轮次后释放", async (t) => {
  const app = await bridge(t);
  const client = await app.connect();
  const { thread } = await app.rpc(client, "thread/start");
  for (const method of [
    "thread/goal/get",
    "thread/goal/set",
    "thread/goal/clear",
    "thread/backgroundTerminals/list",
    "thread/backgroundTerminals/clean",
  ]) {
    await app.rpc(client, method, { threadId: thread.id });
    await app.rpc(client, "test/barrier");
    assert.equal(app.unsubscribed().length, 0, method);
  }
  app.notify("turn/started", {
    threadId: thread.id,
    turn: { id: "goal-turn", status: "inProgress" },
  });
  app.notify("turn/completed", {
    threadId: thread.id,
    turn: { id: "goal-turn", status: "completed" },
  });
  await waitFor(() => app.unsubscribed().length);
  assert.deepEqual(app.unsubscribed()[0].params, { threadId: thread.id });
});
